import { describe, it, expect } from 'vitest'
import { createRollup, seedRollup, rollup, flush } from '../../src/narrative/rollup'
import { readFrames } from '../../src/replay/replay'
import type { Frame } from '../../src/api/sse'
import type { Beat } from '../../src/narrative/types'

const f = (type: string, data: unknown = {}, extra: Partial<Frame> = {}): Frame =>
  ({ type, data, ...extra })

const run = (frames: Frame[]) => frames.reduce((acc, fr) => {
  const r = rollup(acc, fr)
  acc = r.state
  return acc
}, createRollup())

describe('dedupe — a reconnect replays frames we have already seen', () => {
  it('drops a frame whose id has been seen', () => {
    const s = createRollup()
    const a = rollup(s, f('session.created', { sessionID: 's1' }, { id: 'e1' }))
    const b = rollup(a.state, f('session.created', { sessionID: 's1' }, { id: 'e1' }))
    expect(b.beats).toEqual([])
  })

  it('does not double-count deltas when a run is replayed', () => {
    const frames = [
      f('execution.started', { sessionID: 's1' }, { id: 'a' }),
      f('reasoning.started', { sessionID: 's1' }, { id: 'b' }),
      f('reasoning.delta', { sessionID: 's1' }, { id: 'c' }),
      f('reasoning.ended', { sessionID: 's1' }, { id: 'd' }),
      f('reasoning.started', { sessionID: 's1' }, { id: 'b' }),
      f('reasoning.delta', { sessionID: 's1' }, { id: 'c' }),
    ]
    let s = createRollup()
    const emitted: string[] = []
    for (const fr of frames) { const r = rollup(s, fr); s = r.state; emitted.push(...r.beats.map(x => x.id)) }
    expect(emitted).toEqual(['b:b'])
    expect(flush(s)).toEqual([])
  })

  it('knows a session is a root from session.created without a parent', () => {
    let s = createRollup()
    const created = rollup(s, f('session.created', { sessionID: 'r' }, { id: 'a' }))
    const asked = rollup(created.state, f('inbox.enqueued', { sessionID: 'r', item: { type: 'user' } }, { id: 'b' }))
    expect(asked.beats.map(x => x.kind)).toEqual(['human-asks'])
  })

  it('produces no beat for the frame types §4.1 absorbs and that nothing here handles', () => {
    const absorbed = [
      'step.started', 'step.ended', 'step.streamed', 'usage.updated',
      'inbox.delivered', 'instructions.updated', 'project.updated',
      'provider.updated', 'model.updated', 'server.connected',
    ]
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    for (const type of absorbed) {
      expect(rollup(s, f(type, { sessionID: 'x' }, { id: `evt-${type}` })).beats).toEqual([])
    }
  })
})

describe('seeding — joining a session mid-stream still gives it a root, a parent and a cast', () => {
  it('knows a session that was created before we connected', () => {
    const s = seedRollup(createRollup(), {
      sessions: [{ id: 'root', agent: 'plan' }, { id: 'child', parentID: 'root', agent: 'build' }],
      permissions: [],
    })
    const r = rollup(s, f('text.started', { sessionID: 'child' }))
    expect(r.beats[0].sessionID).toBe('child')
  })

  it('raises episode-opens for a root session we joined, not one per frame', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'root' }], permissions: [] })
    const a = rollup(s, f('execution.started', { sessionID: 'root' }))
    const b = rollup(a.state, f('text.started', { sessionID: 'root' }))
    expect(a.beats.concat(b.beats).filter(x => x.kind === 'episode-opens')).toHaveLength(1)
  })
})

describe('the beats that need no history', () => {
  it('human-asks on a root session inbox, briefing on a child', () => {
    const s = seedRollup(createRollup(), {
      sessions: [{ id: 'root' }, { id: 'child', parentID: 'root' }], permissions: [],
    })
    const a = rollup(s, f('inbox.enqueued', { sessionID: 'root', item: { type: 'user' } }))
    const b = rollup(a.state, f('inbox.enqueued', { sessionID: 'child', item: { type: 'user' } }))
    expect(a.beats.map(x => x.kind)).toEqual(['human-asks'])
    expect(b.beats.map(x => x.kind)).toEqual(['briefing'])
  })

  it('ignores an inbox item that is not the user speaking', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'root' }], permissions: [] })
    const r = rollup(s, f('inbox.enqueued', { sessionID: 'root', item: { type: 'synthetic' } }))
    expect(r.beats).toEqual([])
  })

  it('knocks and answered, carrying the request id and the reply', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const a = rollup(s, f('permission.asked', { sessionID: 'x', id: 'p1' }))
    const b = rollup(a.state, f('permission.replied', { sessionID: 'x', requestID: 'p1', reply: 'once' }))
    expect(a.beats[0].kind).toBe('knocks')
    expect(a.beats[0].detail).toEqual({ kind: 'knocks', requestID: 'p1' })
    expect(b.beats[0].detail).toEqual({ kind: 'answered', reply: 'once' })
  })

  it('retry carries the attempt, memory-wipe opens and closes, wrap and cut end', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const seq = [
      f('retry.scheduled', { sessionID: 'x', attempt: 2 }),
      f('compaction.started', { sessionID: 'x' }),
      f('compaction.ended', { sessionID: 'x' }),
      f('execution.succeeded', { sessionID: 'x' }),
      f('execution.failed', { sessionID: 'x', reason: 'boom' }),
    ]
    const kinds: string[] = []
    let st = s
    for (const fr of seq) { const r = rollup(st, fr); st = r.state; kinds.push(...r.beats.map(b => b.kind)) }
    expect(kinds).toEqual(['retry', 'memory-wipe', 'wrap', 'cut'])
  })

  it('treats a shutdown interruption as a cut, not a failure', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const r = rollup(s, f('execution.interrupted', { sessionID: 'x', reason: 'shutdown' }))
    expect(r.beats.map(b => b.kind)).toEqual(['cut'])
  })

  it('ignores an unknown frame type', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    expect(rollup(s, f('some.future.event', { sessionID: 'x' })).beats).toEqual([])
  })
})

describe('beat identity', () => {
  it('derives the id from the first event id, so a re-run is identical', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const a = rollup(s, f('permission.asked', { sessionID: 'x', id: 'p1' }, { id: 'evt1' }))
    const b = rollup(seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] }),
      f('permission.asked', { sessionID: 'x', id: 'p1' }, { id: 'evt1' }))
    expect(a.beats[0].id).toBe('b:evt1')
    expect(a.beats[0].id).toBe(b.beats[0].id)
  })

  it('records every event id of the beat', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const r = rollup(s, f('permission.asked', { sessionID: 'x', id: 'p1' }, { id: 'evt1', created: 1000 }))
    expect(r.beats[0].eventIDs).toEqual(['evt1'])
    expect(r.beats[0].at).toBe(1000)
  })
})

describe('no clock', () => {
  it('uses only the frame created value for time', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const r = rollup(s, f('permission.asked', { sessionID: 'x', id: 'p1' }, { created: 42 }))
    expect(r.beats[0].at).toBe(42)
  })
})

describe('the rules the tests above leave implicit', () => {
  it('counts an id-less delta into an open run but cannot cite it', () => {
    let s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    s = rollup(s, f('reasoning.started', { sessionID: 'x' }, { id: 'a' })).state
    const r = rollup(s, f('reasoning.delta', { sessionID: 'x' }))
    expect(r.beats).toEqual([])
    expect(flush(r.state)).toEqual([{
      id: 'b:a', at: 0, eventIDs: ['a'], kind: 'thinks', sessionID: 'x',
      detail: { kind: 'thinks', deltas: 1 },
    }])
  })

  it('never lets a frame with no id start a run', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const r = rollup(s, f('reasoning.started', { sessionID: 'x' }))
    expect(r.beats).toEqual([])
    expect(flush(r.state)).toEqual([])
  })

  it('gives a memory-wipe one beat — compaction.ended closes it silently', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const r = rollup(s, f('compaction.ended', { sessionID: 'x' }, { id: 'evt1' }))
    expect(r.beats).toEqual([])
  })

  it('arrives a guest we joined on the first frame of its own we see', () => {
    const s = seedRollup(createRollup(), {
      sessions: [{ id: 'root' }, { id: 'child', parentID: 'root' }], permissions: [],
    })
    const r = rollup(s, f('inbox.enqueued', { sessionID: 'child', item: { type: 'synthetic' } }, { id: 'evt1' }))
    expect(r.beats.map(b => b.kind)).toEqual(['guest-arrives'])
    expect(r.beats[0].detail).toEqual({ kind: 'guest-arrives', childSessionID: 'child' })
  })

  // Finding 1: a beat is named by its FIRST event, and for a run that is the frame that
  // opened the run — never the frame that closed it, and nothing outside the run.
  it('names a run where it started, never where it closed', () => {
    let s = createRollup()
    const out: Beat[] = []
    for (const fr of [
      f('execution.started', { sessionID: 'x' }, { id: 'a', created: 100 }),
      f('reasoning.started', { sessionID: 'x' }, { id: 'b', created: 200 }),
      f('reasoning.delta', { sessionID: 'x' }, { id: 'c', created: 300 }),
      f('reasoning.ended', { sessionID: 'x' }, { id: 'd', created: 400 }),
    ]) { const r = rollup(s, fr); s = r.state; out.push(...r.beats) }
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b:b')                  // 'b:d' would be naming the closing frame
    expect(out[0].at).toBe(200)                    // the run's own first event
    expect(out[0].eventIDs).toEqual(['b', 'c', 'd']) // 'a' is not part of this run
  })

  it('names a run at its own first frame', () => {
    let s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const out: Beat[] = []
    for (const fr of [
      f('reasoning.started', { sessionID: 'x' }, { id: 'a', created: 100 }),
      f('reasoning.ended', { sessionID: 'x' }, { id: 'd', created: 400 }),
    ]) { const r = rollup(s, fr); s = r.state; out.push(...r.beats) }
    expect(out[0].id).toBe('b:a')
    expect(out[0].eventIDs).toEqual(['a', 'd'])
  })

  // Finding 2: no bare 'b:' — a stable fallback, and the beat is never dropped.
  it('falls back to a stable id when the first event carries no id', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const r = rollup(s, f('permission.asked', { sessionID: 'x', id: 'p1' }, { created: 7 }))
    expect(r.beats[0].id).toBe('b:knocks:x:7')
    expect(r.beats[0].eventIDs).toEqual([])
  })

  it('does the same for a session we joined with an id-less first frame', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'root' }], permissions: [] })
    const r = rollup(s, f('execution.started', { sessionID: 'root' }))
    expect(r.beats.map(b => b.kind)).toEqual(['episode-opens'])
    expect(r.beats[0].id).toBe('b:episode-opens:root:0')
  })
})

describe('a recording replays to the same beats', () => {
  // fixtures/sample.jsonl carries real OpenCode frame types (`session.execution.started`),
  // so this also holds the one-prefix rule: `session.created` is still the session
  // being created, and `execution.started` is still the frame that opens its episode.
  const pass = (): Beat[] => {
    const beats: Beat[] = []
    let state = seedRollup(createRollup(), { sessions: [], permissions: [] })
    for (const frame of readFrames('fixtures/sample.jsonl')) {
      const r = rollup(state, frame)
      state = r.state
      beats.push(...r.beats)
    }
    return beats.concat(flush(state))
  }

  it('is byte-identical on a second pass', () => {
    const first = pass()
    expect(JSON.stringify(pass())).toEqual(JSON.stringify(first))
    expect(first.map(b => b.kind)).toContain('episode-opens')
  })
})

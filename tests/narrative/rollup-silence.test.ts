import { describe, it, expect } from 'vitest'
import { createRollup, seedRollup, rollup, flush } from '../../src/narrative/rollup'
import type { Frame } from '../../src/api/sse'

const seeded = () => seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
const f = (type: string, data: unknown = {}, extra: Partial<Frame> = {}): Frame => ({ type, data, ...extra })
const drive = (frames: Frame[]) => {
  let st = seeded(); const beats: any[] = []
  for (const fr of frames) { const r = rollup(st, fr); st = r.state; beats.push(...r.beats) }
  return { state: st, beats }
}

describe('silence', () => {
  it('raises once a working session has been quiet for 30s, citing both bounding frames', () => {
    const { beats } = drive([
      f('execution.started', { sessionID: 'x' }, { id: 'a', created: 0 }),
      f('text.started', { sessionID: 'x' }, { id: 'b', created: 1000 }),
      f('text.delta', { sessionID: 'x' }, { id: 'c', created: 2000 }),
      f('text.ended', { sessionID: 'x' }, { id: 'd', created: 3000 }),
      f('text.started', { sessionID: 'x' }, { id: 'e', created: 40000 }),
    ])
    const silence = beats.find(b => b.kind === 'silence')
    expect(silence).toBeDefined()
    expect(silence!.detail).toEqual({ kind: 'silence', fromEventID: 'd', toEventID: 'e', ms: 37000 })
  })

  it('does not raise for a gap under 30s', () => {
    const { beats } = drive([
      f('execution.started', { sessionID: 'x' }, { id: 'a', created: 0 }),
      f('text.started', { sessionID: 'x' }, { id: 'b', created: 1000 }),
      f('text.ended', { sessionID: 'x' }, { id: 'c', created: 2000 }),
      f('text.started', { sessionID: 'x' }, { id: 'd', created: 20000 }),
    ])
    expect(beats.some(b => b.kind === 'silence')).toBe(false)
  })

  it('does not raise for a session waiting on the audience', () => {
    const { beats } = drive([
      f('execution.started', { sessionID: 'x' }, { id: 'a', created: 0 }),
      f('permission.asked', { sessionID: 'x', id: 'p1' }, { id: 'b', created: 1000 }),
      f('text.started', { sessionID: 'x' }, { id: 'c', created: 90000 }),
    ])
    expect(beats.some(b => b.kind === 'silence')).toBe(false)
  })

  it('does not raise for a session whose open request came from the seed, not from a frame we saw', () => {
    const seededWaiting = seedRollup(createRollup(), {
      sessions: [{ id: 'x' }], permissions: [{ requestID: 'p1', sessionID: 'x' }],
    })
    const r = rollup(seededWaiting, f('text.started', { sessionID: 'x' }, { id: 'c', created: 90000 }))
    expect(r.beats.some(x => x.kind === 'silence')).toBe(false)
  })

  it('is ended only by that session’s own next frame', () => {
    const { beats } = drive([
      f('execution.started', { sessionID: 'x' }, { id: 'a', created: 0 }),
      f('text.started', { sessionID: 'x' }, { id: 'b', created: 1000 }),
      f('text.ended', { sessionID: 'x' }, { id: 'c', created: 2000 }),
      f('execution.started', { sessionID: 'y' }, { id: 'z', created: 50000 }),
      f('text.started', { sessionID: 'x' }, { id: 'd', created: 60000 }),
    ])
    const silence = beats.find(b => b.kind === 'silence')
    expect(silence!.detail).toEqual({ kind: 'silence', fromEventID: 'c', toEventID: 'd', ms: 58000 })
  })

  it('does not share its id with the beat the ending frame itself raises', () => {
    // A silence named by the ending frame's id would collide with the beat that
    // frame may itself raise. Here the ending frame is a `permission.asked` —
    // it raises a `knocks` beat — and the silence must keep its own id so the
    // two are distinct. (§4.1: "an opener and its beat must never share an id";
    // that rule generalises to every pair of beats.)
    const { beats } = drive([
      f('execution.started', { sessionID: 'x' }, { id: 'a', created: 0 }),
      f('text.started', { sessionID: 'x' }, { id: 'b', created: 1000 }),
      f('text.ended', { sessionID: 'x' }, { id: 'c', created: 2000 }),
      f('permission.asked', { sessionID: 'x', id: 'p1' }, { id: 'd', created: 40000 }),
    ])
    const kinds = beats.map(b => b.kind)
    expect(kinds).toContain('silence')
    expect(kinds).toContain('knocks')
    const ids = beats.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    const silence = beats.find(b => b.kind === 'silence')!
    const knocks = beats.find(b => b.kind === 'knocks')!
    expect(silence.id).not.toBe(knocks.id)
  })

  it('does the same when the ending frame is a wrap', () => {
    // Same collision check via a different beat-raising frame type: `wrap`.
    const { beats } = drive([
      f('execution.started', { sessionID: 'x' }, { id: 'a', created: 0 }),
      f('text.started', { sessionID: 'x' }, { id: 'b', created: 1000 }),
      f('text.ended', { sessionID: 'x' }, { id: 'c', created: 2000 }),
      f('execution.succeeded', { sessionID: 'x' }, { id: 'd', created: 40000 }),
    ])
    const kinds = beats.map(b => b.kind)
    expect(kinds).toContain('silence')
    expect(kinds).toContain('wrap')
    const ids = beats.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('does not narrate a pre-start gap for a session we watched from created', () => {
    // A `session.created` we saw is not "joined" — the session is not working
    // until its `execution.started`. A 45 s gap from `created` to a non-start
    // frame must not raise a silence.
    const { beats } = drive([
      f('session.created', { sessionID: 'x' }, { id: 'a', created: 0 }),
      f('inbox.enqueued', { sessionID: 'x', item: { type: 'user' } }, { id: 'b', created: 45000 }),
    ])
    expect(beats.some(b => b.kind === 'silence')).toBe(false)
  })
})

describe('flush', () => {
  it('produces no beat for a call that never succeeded', () => {
    const { state } = drive([
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'read' }, { id: 'a' }),
      f('tool.called', { sessionID: 'x', id: 'c1' }, { id: 'b' }),
    ])
    expect(flush(state).filter(b => b.kind === 'uses-tool' || b.kind === 'tool-fails')).toEqual([])
  })
})

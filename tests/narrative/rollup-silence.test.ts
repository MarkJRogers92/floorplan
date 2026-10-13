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
    expect(silence!.detail).toEqual({ kind: 'silence', fromEventID: 'd', toEventID: 'e' })
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
    expect(silence!.detail).toEqual({ kind: 'silence', fromEventID: 'c', toEventID: 'd' })
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

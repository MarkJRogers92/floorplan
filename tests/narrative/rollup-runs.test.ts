import { describe, it, expect } from 'vitest'
import { createRollup, seedRollup, rollup, flush } from '../../src/narrative/rollup'
import type { Frame } from '../../src/api/sse'

const seeded = (sessions: { id: string; parentID?: string }[] = [{ id: 'x' }]) =>
  // The episode's opener is spent here, so each test's expectations are about its own
  // subject rather than about the opener. The opener riding a run or call beat is
  // Task 1's behaviour and is tested there.
  rollup(
    seedRollup(createRollup(), { sessions, permissions: [] }),
    { type: 'session.created', data: { sessionID: sessions[0].id }, id: `open-${sessions[0].id}` },
  ).state
const f = (type: string, data: unknown = {}, extra: Partial<Frame> = {}): Frame => ({ type, data, ...extra })
const drive = (st: any, frames: Frame[]) => {
  const beats: any[] = []
  for (const fr of frames) { const r = rollup(st, fr); st = r.state; beats.push(...r.beats) }
  return { state: st, beats }
}

describe('thinks and says are runs', () => {
  it('opens a run on the first delta when we joined mid-run — no started frame — and names it there', () => {
    const { beats } = drive(seeded(), [
      f('reasoning.delta', { sessionID: 'x' }, { id: 'd1' }),
      f('reasoning.delta', { sessionID: 'x' }, { id: 'd2' }),
      f('reasoning.ended', { sessionID: 'x' }, { id: 'd3' }),
    ])
    expect(beats.map(b => b.kind)).toEqual(['thinks'])
    expect(beats[0].id).toBe('b:d1')
    expect(beats[0].detail).toEqual({ kind: 'thinks', deltas: 2, endedEventID: 'd3' })
  })

  it('carries the delta count on close, and zero when there were none', () => {
    const { beats } = drive(seeded(), [
      f('reasoning.started', { sessionID: 'x' }, { id: 'a' }),
      f('reasoning.delta', { sessionID: 'x' }, { id: 'b' }),
      f('reasoning.delta', { sessionID: 'x' }, { id: 'c' }),
      f('reasoning.ended', { sessionID: 'x' }, { id: 'd' }),
    ])
    expect(beats).toHaveLength(1)
    expect(beats[0].detail).toEqual({ kind: 'thinks', deltas: 2, endedEventID: 'd' })
    expect(beats[0].eventIDs).toEqual(['a', 'b', 'c', 'd'])
  })

  it('gives a says beat its own delta count and ending frame', () => {
    const { beats } = drive(seeded(), [
      f('text.started', { sessionID: 'x' }, { id: 'a' }),
      f('text.delta', { sessionID: 'x' }, { id: 'b' }),
      f('text.ended', { sessionID: 'x' }, { id: 'c' }),
    ])
    expect(beats[0].kind).toBe('says')
    expect(beats[0].detail).toEqual({ kind: 'says', deltas: 1, endedEventID: 'c' })
  })

  it('captures the verbatim text from a text.ended or reasoning.ended frame', () => {
    const { beats } = drive(seeded(), [
      f('text.started', { sessionID: 'x' }, { id: 'a' }),
      f('text.ended', { sessionID: 'x', text: 'We are finished.' }, { id: 'b' }),
      f('reasoning.started', { sessionID: 'x' }, { id: 'c' }),
      f('reasoning.ended', { sessionID: 'x', text: 123 }, { id: 'd' }),
    ])
    expect(beats[0].detail).toEqual({ kind: 'says', deltas: 0, text: 'We are finished.', endedEventID: 'b' })
    expect(beats[1].detail).toEqual({ kind: 'thinks', deltas: 0, endedEventID: 'd' })
  })

  it('closes an open run at stream end rather than losing it', () => {
    const { state, beats } = drive(seeded(), [
      f('text.started', { sessionID: 'x' }, { id: 'a' }),
      f('text.delta', { sessionID: 'x' }, { id: 'b' }),
    ])
    expect(beats).toEqual([])
    const closed = flush(state)
    expect(closed.map(b => b.kind)).toEqual(['says'])
    expect(closed[0].detail).toEqual({ kind: 'says', deltas: 1 })
  })
})

describe('calls join by id', () => {
  it('joins input.started, called and progress into one uses-tool beat', () => {
    const { beats } = drive(seeded(), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'read' }, { id: 'a' }),
      f('tool.called', { sessionID: 'x', id: 'c1' }, { id: 'b' }),
      f('tool.success', { sessionID: 'x', id: 'c1' }, { id: 'c' }),
    ])
    expect(beats).toHaveLength(1)
    expect(beats[0].kind).toBe('uses-tool')
    expect(beats[0].detail).toEqual({ kind: 'uses-tool', tool: 'read', callID: 'c1' })
    expect(beats[0].eventIDs).toEqual(['a', 'b', 'c'])
  })

  it('names the tool unknown when we joined mid-call', () => {
    const { beats } = drive(seeded(), [f('tool.success', { sessionID: 'x', id: 'c1' }, { id: 'c' })])
    expect(beats[0].detail).toEqual({ kind: 'uses-tool', tool: 'unknown', callID: 'c1' })
  })

  it('raises tool-fails immediately', () => {
    const { beats } = drive(seeded(), [f('tool.failed', { sessionID: 'x', id: 'c1', name: 'write' }, { id: 'z' })])
    expect(beats[0].kind).toBe('tool-fails')
    expect(beats[0].detail).toEqual({ kind: 'tool-fails', tool: 'write', callID: 'c1' })
  })

  it('joins a non-zero shell exit onto the call as tool-fails, carrying the code', () => {
    // §4.1 amended by the Task 4 recording: OpenCode reports a non-zero exit as a
    // tool.success, never a tool.failed. The exit is on the success itself.
    const { beats } = drive(seeded(), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'bash' }, { id: 'a' }),
      f('tool.progress', { sessionID: 'x', id: 'c1', metadata: { shellID: 'sh1' } }, { id: 'b' }),
      f('shell.exited', { sessionID: 'x', id: 'sh1', exit: 2 }, { id: 'c' }),
      f('tool.success', { sessionID: 'x', id: 'c1' }, { id: 'd' }),
    ])
    expect(beats.map(b => b.kind)).toEqual(['tool-fails'])
    expect(beats[0].detail).toEqual({ kind: 'tool-fails', tool: 'bash', callID: 'c1', exit: 2 })
    expect(beats[0].eventIDs).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does not create a call or emit a beat when called or progress arrive without input.started', () => {
    const { state, beats } = drive(seeded(), [
      f('tool.called', { sessionID: 'x', id: 'c1' }, { id: 'a' }),
      f('tool.progress', { sessionID: 'x', id: 'c1', metadata: { shellID: 'sh1' } }, { id: 'b' }),
    ])
    expect(beats).toEqual([])
    expect(flush(state)).toEqual([])
  })

  it('still attaches a shell exit code when unrelated frames arrive in between', () => {
    const { beats } = drive(seeded(), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'bash' }, { id: 'a' }),
      f('tool.progress', { sessionID: 'x', id: 'c1', metadata: { shellID: 'sh1' } }, { id: 'b' }),
      f('text.started', { sessionID: 'x' }, { id: 'noise1' }),
      f('text.delta', { sessionID: 'x' }, { id: 'noise2' }),
      f('text.ended', { sessionID: 'x' }, { id: 'noise3' }),
      f('shell.exited', { sessionID: 'x', id: 'sh1', exit: 3 }, { id: 'c' }),
      f('tool.success', { sessionID: 'x', id: 'c1' }, { id: 'd' }),
    ])
    const toolBeat = beats.find(b => b.kind === 'tool-fails')
    expect(toolBeat).toBeDefined()
    expect(toolBeat!.detail).toMatchObject({ tool: 'bash', exit: 3 })
    expect(toolBeat!.eventIDs).toEqual(['a', 'b', 'c', 'd'])
  })

  it('raises tool-fails from the success frame’s own exit when shell.exited arrives late', () => {
    // The recorded fixture: tool.success carried metadata.exit 3, and its shell.exited
    // frame arrived 22 ms after the success. The joined exit alone would miss it.
    const { beats } = drive(seeded(), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'shell' }, { id: 'a' }),
      f('tool.progress', { sessionID: 'x', id: 'c1', metadata: { shellID: 'sh1' } }, { id: 'b' }),
      f('tool.success', { sessionID: 'x', id: 'c1', metadata: { exit: 3 } }, { id: 'c' }),
      f('shell.exited', { id: 'sh1', exit: 3 }, { id: 'd' }),
    ])
    expect(beats.map(b => b.kind)).toEqual(['tool-fails'])
    expect(beats[0].detail).toEqual({ kind: 'tool-fails', tool: 'shell', callID: 'c1', exit: 3 })
  })

  it('keeps a zero-exit success a uses-tool, carrying exit 0 from the join', () => {
    const { beats } = drive(seeded(), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'shell' }, { id: 'a' }),
      f('tool.progress', { sessionID: 'x', id: 'c1', metadata: { shellID: 'sh1' } }, { id: 'b' }),
      f('shell.exited', { id: 'sh1', exit: 0 }, { id: 'c' }),
      f('tool.success', { sessionID: 'x', id: 'c1' }, { id: 'd' }),
    ])
    expect(beats.map(b => b.kind)).toEqual(['uses-tool'])
    expect(beats[0].detail).toMatchObject({ tool: 'shell', exit: 0 })
  })

  it('raises tool-fails for a failed frame that carries no call id', () => {
    const { beats } = drive(seeded(), [f('tool.failed', { sessionID: 'x', name: 'write' }, { id: 'z' })])
    expect(beats.map(b => b.kind)).toEqual(['tool-fails'])
    expect(beats[0].detail).toEqual({ kind: 'tool-fails', tool: 'write' })
  })

  it('raises uses-tool for a successful frame that carries no call id', () => {
    const { beats } = drive(seeded(), [f('tool.success', { sessionID: 'x', name: 'read' }, { id: 'z' })])
    expect(beats.map(b => b.kind)).toEqual(['uses-tool'])
    expect(beats[0].detail).toEqual({ kind: 'uses-tool', tool: 'read' })
  })
})

describe('a subagent call is a guest, never a tool use', () => {
  it('raises guest-leaves instead of uses-tool for a subagent success', () => {
    const { beats } = drive(seeded([{ id: 'x' }, { id: 'kid', parentID: 'x' }]), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'subagent', input: { sessionID: 'kid' } }, { id: 'a' }),
      f('tool.success', { sessionID: 'x', id: 'c1', metadata: { sessionID: 'kid' } }, { id: 'b' }),
    ])
    expect(beats.map(b => b.kind)).toEqual(['guest-leaves'])
    expect(beats[0].detail).toEqual({ kind: 'guest-leaves', childSessionID: 'kid', callID: 'c1' })
  })

  it('links a guest-arrives to the subagent call whose input names the child, not to an unrelated open call', () => {
    const { beats } = drive(seeded([{ id: 'x' }, { id: 'kid', parentID: 'x' }]), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'subagent', input: { sessionID: 'kid' } }, { id: 'b' }),
      f('session.created', { sessionID: 'kid', parentID: 'x' }, { id: 'a' }),
      f('tool.input.started', { sessionID: 'x', id: 'c9', name: 'other' }, { id: 'c' }),
    ])
    expect(beats.map(b => b.kind)).toEqual(['guest-arrives'])
    expect(beats[0].detail).toEqual({ kind: 'guest-arrives', childSessionID: 'kid', callID: 'c1' })
  })

  it('lets a returning guest leave twice and arrive once', () => {
    const { beats } = drive(seeded([{ id: 'x' }, { id: 'kid', parentID: 'x' }]), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'subagent', input: { sessionID: 'kid' } }, { id: 'a' }),
      f('session.created', { sessionID: 'kid', parentID: 'x' }, { id: 'b' }),
      f('tool.success', { sessionID: 'x', id: 'c1', metadata: { sessionID: 'kid' } }, { id: 'c' }),
      f('tool.input.started', { sessionID: 'x', id: 'c2', name: 'subagent', input: { sessionID: 'kid' } }, { id: 'd' }),
      f('tool.success', { sessionID: 'x', id: 'c2', metadata: { sessionID: 'kid' } }, { id: 'e' }),
    ])
    const kinds = beats.map(b => b.kind)
    expect(kinds.filter(k => k === 'guest-arrives')).toHaveLength(1)
    expect(kinds.filter(k => k === 'guest-leaves')).toHaveLength(2)
    expect(kinds).not.toContain('uses-tool')
  })

  it('keeps a non-subagent tool success as uses-tool even when it carries metadata.sessionID', () => {
    const { beats } = drive(seeded([{ id: 'x' }, { id: 'kid', parentID: 'x' }]), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'read' }, { id: 'a' }),
      f('tool.success', { sessionID: 'x', id: 'c1', metadata: { sessionID: 'kid' } }, { id: 'b' }),
    ])
    expect(beats.map(b => b.kind)).toEqual(['uses-tool'])
    expect(beats[0].detail).toEqual({ kind: 'uses-tool', tool: 'read', callID: 'c1' })
  })

  it('degrades a subagent success with no child id to an unknown tool use', () => {
    const { beats } = drive(seeded([{ id: 'x' }, { id: 'kid', parentID: 'x' }]), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'subagent', input: { sessionID: 'kid' } }, { id: 'a' }),
      f('tool.success', { sessionID: 'x', id: 'c1' }, { id: 'b' }),
    ])
    expect(beats.map(b => b.kind)).toEqual(['uses-tool'])
    expect(beats[0].detail).toEqual({ kind: 'uses-tool', tool: 'unknown', callID: 'c1' })
  })
})

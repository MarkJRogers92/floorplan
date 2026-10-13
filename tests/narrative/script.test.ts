import { describe, it, expect } from 'vitest'
import { assembleScript, sceneHeadingFor } from '../../src/narrative/script'
import type { Beat } from '../../src/narrative/types'

const b = (id: string, kind: any, detail: any, at = 0, sessionID = 'x'): Beat =>
  ({ id, at, eventIDs: [id.slice(2)], kind, sessionID, detail })
const ctx = { cast: () => 'build', beats: [] as Beat[] }

describe('assembleScript', () => {
  it('emits one readable line per beat, in order, each citing that beat', () => {
    const beats = [
      b('b:1', 'human-asks', { kind: 'human-asks' }, 0),
      b('b:2', 'uses-tool', { kind: 'uses-tool', tool: 'read', callID: 'c1' }, 1000),
    ]
    const out = assembleScript(beats, ctx)
    expect(out.map(l => l.beatIDs)).toEqual([['b:1'], ['b:2']])
    expect(out.every(l => l.text.length > 0)).toBe(true)
  })

  it('drops a rejected line, so no beat is narrated by something untrue', () => {
    const beats = [b('b:1', 'says', { kind: 'says', deltas: 0 })]
    const out = assembleScript(beats, ctx, () => ({ id: 'l', speaker: 'narrator', template: 'It ran 3 times.', cites: ['b:1'] }))
    expect(out).toEqual([])
  })

  it('carries the beat ids through so a reader can trace a line back to its events', () => {
    const beats = [b('b:1', 'knocks', { kind: 'knocks', requestID: 'p1' }, 5000)]
    const [only] = assembleScript(beats, ctx)
    expect(only.beatIDs).toEqual(['b:1'])
  })

  it('carries delivery through, so the page can render real speech differently', () => {
    // The brief's fixture was a `knocks` beat here, but §5.1's proof for `{quote:}` is
    // "the `text.ended` / `reasoning.ended` text of a `says`/`thinks` beat", so a knock
    // cannot be quoted: `renderLine` rejects it and `assembleScript` drops it, which is
    // the design. A `says` beat carries the same intent and can prove the slot.
    const beats = [b('b:1', 'says', { kind: 'says', deltas: 0 }, 0)]
    const [only] = assembleScript(beats, ctx, () => ({ id: 'l', speaker: 'build', template: '{quote:b:1}', cites: ['b:1'] }))
    expect(only.delivery).toBe('real-speech')
  })

  it('drops only the line that cannot be proved, keeping its neighbours in order', () => {
    const beats = [
      b('b:1', 'human-asks', { kind: 'human-asks' }, 0),
      b('b:2', 'uses-tool', { kind: 'uses-tool', tool: 'read', callID: 'c1' }, 1000),
      b('b:3', 'knocks', { kind: 'knocks', requestID: 'p1' }, 2000),
    ]
    const out = assembleScript(beats, ctx, beat =>
      beat.id === 'b:2'
        ? { id: 'bad', speaker: 'narrator', template: 'It ran 3 times.', cites: [beat.id] }
        : { id: `ok-${beat.id}`, speaker: 'narrator', template: 'Something happened.', cites: [beat.id] })
    expect(out.map(l => l.beatIDs)).toEqual([['b:1'], ['b:3']])
  })
})

describe('sceneHeadingFor', () => {
  it('names the location from the scene’s own first beat, through the checker', () => {
    const beat = b('b:1', 'uses-tool', { kind: 'uses-tool', tool: 'read' }, 0, 's1')
    const heading = sceneHeadingFor(beat, { cast: () => 'build', beats: [beat] })
    expect(heading.text).toBe('build')
    expect(heading.beatIDs).toEqual(['b:1'])
    expect(heading.delivery).toBe('narration')
  })
})

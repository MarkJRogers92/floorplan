import { describe, it, expect } from 'vitest'
import { createRollup, seedRollup, rollup, flush } from '../../src/narrative/rollup'
import { renderLine, type Line } from '../../src/narrative/line'
import { assembleScript } from '../../src/narrative/script'
import type { Frame } from '../../src/api/sse'
import type { Beat, RollupState } from '../../src/narrative/types'

const f = (id: string, type: string, created: number, data: unknown = { sessionID: 'x' }): Frame =>
  ({ id, type, created, data })
const seeded = () => rollup(seedRollup(createRollup(), {
  sessions: [{ id: 'x', agent: 'build' }], permissions: [],
}), f('open', 'execution.started', 0)).state
const drive = (frames: Frame[]) => {
  let state: RollupState = seeded()
  const beats: Beat[] = []
  for (const frame of frames) {
    const result = rollup(state, frame)
    state = result.state
    beats.push(...result.beats)
  }
  return { state, beats }
}
const tool = (id = 'b:1', at = 0): Beat => ({
  id, at, endAt: at, eventIDs: [id], sessionID: 'x', kind: 'uses-tool',
  detail: { kind: 'uses-tool', tool: 'read' },
})
const line = (template: string, cites = ['b:1']): Line => ({ id: 'l', speaker: 'narrator', template, cites })
const render = (template: string, beats: Beat[], closed?: boolean) => renderLine(
  line(template, beats.map(b => b.id)), new Map(beats.map(b => [b.id, b])),
  { cast: () => 'build', beats, closed },
)

describe('beats retain their final timestamp', () => {
  it('a run ends at its closing frame, not its start', () => {
    const { beats } = drive([f('a', 'reasoning.started', 1000), f('b', 'reasoning.delta', 2000), f('c', 'reasoning.ended', 9000)])
    expect(beats[0]).toMatchObject({ at: 1000, endAt: 9000 })
  })
  it('flush retains the last run frame rather than an unrelated session frame', () => {
    const { state } = drive([f('a', 'text.started', 1000), f('b', 'text.delta', 8000), f('c', 'step.started', 9000)])
    expect(flush(state)[0]).toMatchObject({ at: 1000, endAt: 8000 })
  })
  it('an immediate beat ends where it starts', () => {
    expect(drive([f('a', 'permission.asked', 500, { sessionID: 'x', id: 'p' })]).beats[0])
      .toMatchObject({ at: 500, endAt: 500 })
  })
  it('calls end at their outcome and retain the success metadata exit', () => {
    const { beats } = drive([
      f('a', 'tool.input.started', 1000, { sessionID: 'x', id: 'c', name: 'shell' }),
      f('b', 'tool.success', 9000, { sessionID: 'x', id: 'c', metadata: { exit: 0 } }),
    ])
    expect(beats[0]).toMatchObject({ at: 1000, endAt: 9000, detail: { exit: 0 } })
  })
  it('silences end at their to-bound', () => {
    const { beats } = drive([f('a', 'step.started', 40_000)])
    expect(beats.find(b => b.kind === 'silence')).toMatchObject({ endAt: 40_000 })
  })
  it('duration measures to the last event with existing five-second rounding', () => {
    expect(render('It took {dur:b:1..b:2}.', [tool(), { ...tool('b:2', 2000), endAt: 9000 }]))
      .toEqual({ text: 'It took five seconds.', delivery: 'narration' })
  })
})

describe('slots reject unsupported claims', () => {
  it('never requires a closed context and scans the whole episode', () => {
    expect(render('It {never:wrap}.', [tool()])).toHaveProperty('rejected')
    expect(render('It {never:wrap}.', [tool()], true)).toHaveProperty('text')
    expect(render('It {never:wrap}.', [tool(), {
      ...tool('b:2'), kind: 'wrap', detail: { kind: 'wrap' },
    }], true)).toHaveProperty('rejected')
  })
  it.each(['{ordinal:read,b:1}', '{first:read,b:1}', '{last:read,b:1}', '{never:wrap}', '{count:read,b:1..b:2}'])
    ('rejects incomplete evidence without throwing: %s', template => {
      const beats = [tool(), tool('b:2')]
      const result = () => renderLine(line(template, ['b:1', 'b:2']), new Map([['b:1', beats[0]]]), {
        cast: () => 'build', beats, closed: true,
      })
      expect(result).not.toThrow()
      expect(result()).toHaveProperty('rejected')
    })
  it('rejects a plain line citing nonexistent footage', () => {
    expect(renderLine(line('It happened.'), new Map(), { cast: () => 'build', beats: [] })).toHaveProperty('rejected')
  })
  it('clamps a non-finite gap without changing rounding wording', () => {
    expect(render('{gap:b:1}', [{ ...tool(), kind: 'silence', detail: {
      kind: 'silence', fromEventID: 'a', toEventID: 'b', ms: NaN,
    } }])).toEqual({ text: 'a moment', delivery: 'narration' })
  })
  it('rejects empty outcomes while the template remains visible', () => {
    const beat: Beat = { ...tool(), kind: 'answered', detail: { kind: 'answered', reply: '' } }
    expect(render('{outcome:b:1}', [beat])).toHaveProperty('rejected')
    expect(assembleScript([beat], { cast: () => 'build', beats: [beat] })[0].text).not.toContain(': .')
  })
  it('zero-delta says has nonempty narration without none parts', () => {
    const beat: Beat = { ...tool(), kind: 'says', detail: { kind: 'says', deltas: 0 } }
    const script = assembleScript([beat], { cast: () => 'build', beats: [beat] })
    expect(script[0]).toMatchObject({ delivery: 'narration', beatIDs: ['b:1'] })
    expect(script[0].text).toBeTruthy()
    expect(script[0].text).not.toMatch(/\b(?:none|0)\b/)
  })
})

it('re-seed preserves stream-learned parent and agent when fields are undefined', () => {
  const original = seedRollup(createRollup(), { sessions: [{ id: 'x', parentID: 'p', agent: 'build' }], permissions: [] })
  const state = seedRollup(original, { sessions: [{ id: 'x', parentID: undefined, agent: undefined }], permissions: [] })
  expect(state.sessions.get('x')).toMatchObject({ parentID: 'p', agent: 'build' })
  expect(state.roots.has('x')).toBe(false)
  expect(original.sessions.get('x')).toMatchObject({ parentID: 'p', agent: 'build' })
})

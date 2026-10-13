import { describe, it, expect, beforeEach } from 'vitest'
import { renderLine, type Line, type Rendered } from '../../src/narrative/line'
import type { Beat } from '../../src/narrative/types'

const beats = new Map<string, Beat>()
const b = (id: string, kind: any, detail: any, at = 0, sessionID = 'x'): Beat =>
  ({ id, at, eventIDs: [id.slice(2)], kind, sessionID, detail })

beforeEach(() => {
  beats.clear()
  beats.set('b:1', b('b:1', 'uses-tool', { kind: 'uses-tool', tool: 'read', callID: 'c1', path: 'src/a.ts' }, 0))
  beats.set('b:2', b('b:2', 'uses-tool', { kind: 'uses-tool', tool: 'read', callID: 'c2' }, 1000))
  beats.set('b:3', b('b:3', 'thinks', { kind: 'thinks', deltas: 317 }, 2000))
  beats.set('b:4', b('b:4', 'tool-fails', { kind: 'tool-fails', tool: 'bash', callID: 'c3', exit: 2 }, 3000))
  ctx = { cast: () => 'build', beats: [...beats.values()] }
})
let ctx: { cast: () => 'build'; beats: Beat[] }
const line = (template: string, cites: string[]): Line => ({ id: 'l1', speaker: 'narrator', template, cites })

describe('slots render from their cites, and only from them', () => {
  it('fills tool, path, count and outcome', () => {
    expect(renderLine(line('{agent:b:1} runs {tool:b:1} on {path:b:1}.', ['b:1']), beats, ctx))
      .toEqual({ text: 'build runs read on src/a.ts.', delivery: 'narration' })
    expect(renderLine(line('{count:uses-tool,b:1..b:2} calls.', ['b:1', 'b:2']), beats, ctx))
      .toEqual({ text: '2 calls.', delivery: 'narration' })
    expect(renderLine(line('that {outcome:b:4}.', ['b:4']), beats, ctx))
      .toEqual({ text: 'that exit 2.', delivery: 'narration' })
  })

  it('rejects a slot whose cite cannot prove it', () => {
    const r = renderLine(line('{tool:b:3} failed.', ['b:3']), beats, ctx)
    expect(r).toHaveProperty('rejected')
  })

  it('rejects a slot citing a beat its own line does not cite', () => {
    const r = renderLine(line('{tool:b:1} twice.', ['b:2']), beats, ctx)
    expect(r).toHaveProperty('rejected')
  })

  it('rejects a line with no cites', () => {
    expect(renderLine(line('Nothing happened.', []), beats, ctx)).toHaveProperty('rejected')
  })
})

describe('delivery — the viewer can always tell real words from written ones', () => {
  const as = (speaker: Line['speaker'], template: string): Line =>
    ({ id: 'l', speaker, template, cites: ['b:3'] })

  it('marks a template that is exactly one quote slot as real speech', () => {
    expect((renderLine(as('build', '{quote:b:3}'), beats, ctx) as Rendered).delivery).toBe('real-speech')
  })

  it('marks anything else a character says as dramatised', () => {
    expect((renderLine(as('build', 'Well. That happened.'), beats, ctx) as Rendered).delivery).toBe('dramatised')
  })

  it('marks the narrator as narration', () => {
    expect((renderLine(line('It could have let the dot go.', ['b:1']), beats, ctx) as Rendered).delivery).toBe('narration')
  })

  it('never lets a quote slot pass for real speech when it is embedded in a longer line', () => {
    expect((renderLine(as('build', 'It said {quote:b:3} and left.'), beats, ctx) as Rendered).delivery).toBe('dramatised')
  })
})

describe('free text is linted, not trusted', () => {
  it.each([
    'It ran 3 times.',
    'It ran twice.',
    'It still has not run.',
    'It never ran the tests.',
    'It read the file again.',
    'It only ran bash.',
    'It wrote src/thing.ts.',
  ])('rejects %s', (template) => {
    expect(renderLine(line(template, ['b:1']), beats, ctx)).toHaveProperty('rejected')
  })

  it('accepts story text that asserts no work', () => {
    const r = renderLine(line('It could have let the dot go. Instead, it gave the dot a name.', ['b:1']), beats, ctx)
    expect(r).toHaveProperty('text')
  })
})

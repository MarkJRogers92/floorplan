// tests/replay/replay.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFrames, replay } from '../../src/replay/replay'
import { ingestAll, desks } from '../../src/state/registry'

const write = (body: string) => {
  const f = join(mkdtempSync(join(tmpdir(), 'rp-')), 'events.jsonl')
  writeFileSync(f, body)
  return f
}

describe('readFrames', () => {
  it('reads frames in order', () => {
    const f = write(['{"type":"a","data":{}}', '{"type":"b","data":{}}'].join('\n') + '\n')
    expect(readFrames(f).map(x => x.type)).toEqual(['a', 'b'])
  })

  it('skips a partial final line left by a kill mid-write', () => {
    const f = write('{"type":"a","data":{}}\n{"type":"b","da')
    expect(readFrames(f).map(x => x.type)).toEqual(['a'])
  })

  it('skips blank lines and lines with no type', () => {
    const f = write('\n{"data":{}}\n{"type":"real","data":{}}\n')
    expect(readFrames(f).map(x => x.type)).toEqual(['real'])
  })

  it('returns an empty array for an empty file', () => {
    expect(readFrames(write(''))).toEqual([])
  })
})

describe('replay feeds the same registry as the live stream', () => {
  it('produces the expected final desk states from the committed fixture', () => {
    const frames = readFrames('fixtures/sample.jsonl')
    const final = desks(ingestAll(new Map(), frames))
    const byId = Object.fromEntries(final.map(d => [d.sessionID, d.status]))
    expect(byId).toEqual({
      'sess-alpha': 'working',
      'sess-beta': 'waiting-on-you',
      'sess-gamma': 'idle',
    })
  })
})

describe('replay', () => {
  it('emits every frame in order', async () => {
    const f = write(['{"type":"a","data":{}}', '{"type":"b","data":{}}'].join('\n') + '\n')
    const seen: string[] = []
    await replay(f, x => seen.push(x.type), 0)
    expect(seen).toEqual(['a', 'b'])
  })

  it('stops emitting once its signal aborts', async () => {
    const f = write(['{"type":"a","data":{}}', '{"type":"b","data":{}}', '{"type":"c","data":{}}'].join('\n'))
    const abort = new AbortController()
    const seen: string[] = []
    await replay(f, x => { seen.push(x.type); abort.abort() }, 1, abort.signal)
    expect(seen).toEqual(['a'])
  })
})

describe('replay — abort during the step delay (review fix 2)', () => {
  it('resolves promptly when aborted mid-delay', async () => {
    const f = write(['{"type":"a","data":{}}', '{"type":"b","data":{}}'].join('\n'))
    const abort = new AbortController()
    const seen: string[] = []
    const start = Date.now()
    setTimeout(() => abort.abort(), 10)
    await replay(f, x => seen.push(x.type), 1000, abort.signal)
    expect(Date.now() - start).toBeLessThan(200)
    expect(seen).toEqual(['a'])
  })
})

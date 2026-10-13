// tests/record/recorder.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecorder } from '../../src/record/recorder'

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'rec-')), 'events.jsonl')

describe('createRecorder', () => {
  it('writes one JSON object per line, in order', () => {
    const f = tmpFile()
    const write = createRecorder(f)
    write({ type: 'a', data: { n: 1 } })
    write({ type: 'b', data: { n: 2 } })
    const lines = readFileSync(f, 'utf8').trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines.map(l => JSON.parse(l).type)).toEqual(['a', 'b'])
  })

  it('appends to an existing file rather than truncating it', () => {
    const f = tmpFile()
    writeFileSync(f, JSON.stringify({ type: 'first' }) + '\n')
    createRecorder(f)({ type: 'second', data: {} })
    const types = readFileSync(f, 'utf8').trimEnd().split('\n').map(l => JSON.parse(l).type)
    expect(types).toEqual(['first', 'second'])
  })
})

describe('createRecorder — created and location', () => {
  it('records created and location when the frame has them, and omits them when it does not', () => {
    const f = tmpFile()
    const write = createRecorder(f)
    write({ id: 'e1', created: 5, type: 'a', location: { directory: '/x' }, data: {} })
    write({ type: 'b', data: {} })
    const [one, two] = readFileSync(f, 'utf8').trimEnd().split('\n').map(l => JSON.parse(l))
    expect(one).toEqual({ id: 'e1', created: 5, type: 'a', location: { directory: '/x' }, data: {} })
    expect(two).toEqual({ type: 'b', data: {} })
  })
})

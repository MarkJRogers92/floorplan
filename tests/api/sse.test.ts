// tests/api/sse.test.ts
import { describe, it, expect } from 'vitest'
import { parseFrames } from '../../src/api/sse'

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`

describe('parseFrames', () => {
  it('parses a single complete frame', () => {
    const { frames, rest } = parseFrames(frame({ id: 'e1', type: 'session.created', data: { a: 1 } }))
    expect(frames).toEqual([{ id: 'e1', type: 'session.created', data: { a: 1 } }])
    expect(rest).toBe('')
  })

  it('parses two frames arriving in one chunk', () => {
    const { frames } = parseFrames(frame({ type: 'a' }) + frame({ type: 'b' }))
    expect(frames.map(f => f.type)).toEqual(['a', 'b'])
  })

  it('carries a partial frame over to the next chunk', () => {
    const whole = frame({ type: 'big', data: { x: 42 } })
    const first = parseFrames(whole.slice(0, 18))
    expect(first.frames).toEqual([])
    const second = parseFrames(first.rest + whole.slice(18))
    expect(second.frames).toEqual([{ type: 'big', data: { x: 42 } }])
  })

  it('ignores heartbeat comments', () => {
    const { frames } = parseFrames(': heartbeat\n\n' + frame({ type: 'real' }))
    expect(frames.map(f => f.type)).toEqual(['real'])
  })

  it('skips a frame whose payload is not JSON rather than throwing', () => {
    const { frames } = parseFrames('data: {not json\n\n' + frame({ type: 'ok' }))
    expect(frames.map(f => f.type)).toEqual(['ok'])
  })

  it('skips a well-formed frame with no type', () => {
    const { frames } = parseFrames(frame({ id: 'e1', data: {} }))
    expect(frames).toEqual([])
  })
})

describe('parseFrames — created and location (owner-approved, for the narrative layer)', () => {
  it('keeps a numeric created and a location with a string directory', () => {
    const p = JSON.stringify({ id: 'e1', created: 1700000000000, type: 't', location: { directory: '/x' }, data: {} })
    const { frames } = parseFrames(`data: ${p}\n\n`)
    expect(frames[0]).toEqual({ id: 'e1', created: 1700000000000, type: 't', location: { directory: '/x' }, data: {} })
  })
  it('omits them when absent or malformed, so old frames look exactly as before', () => {
    const p = JSON.stringify({ created: 'soon', type: 't', location: 'here', data: {} })
    expect(parseFrames(`data: ${p}\n\n`).frames[0]).toEqual({ type: 't', data: {} })
  })
})

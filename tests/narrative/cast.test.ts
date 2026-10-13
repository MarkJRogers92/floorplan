import { describe, it, expect } from 'vitest'
import { castFor } from '../../src/narrative/cast'

describe('castFor', () => {
  it('names a session after its agent', () => {
    expect(castFor([{ id: 's1', agent: 'plan' }])('s1')).toBe('plan')
  })

  it('suffixes a second session running the same agent in one episode', () => {
    const cast = castFor([{ id: 's1', agent: 'plan' }, { id: 's2', agent: 'plan' }])
    expect(cast('s1')).toBe('plan')
    expect(cast('s2')).toBe('plan·2')
  })

  it('says unidentified rather than guessing', () => {
    expect(castFor([{ id: 's1' }])('s1')).toBe('unidentified')
    expect(castFor([])('gone')).toBe('unidentified')
  })

  it('never suffixes an unidentified session', () => {
    const cast = castFor([{ id: 's1' }, { id: 's2' }])
    expect(cast('s1')).toBe('unidentified')
    expect(cast('s2')).toBe('unidentified')
  })
})

import { describe, it, expect } from 'vitest'
import { statusColour } from '../../src/room/room'

describe('statusColour', () => {
  it('gives every status its own colour', () => {
    const all = ['idle', 'working', 'waiting-on-you', 'waiting-on-worker', 'success', 'failure'] as const
    const colours = all.map(statusColour)
    expect(new Set(colours).size).toBe(all.length)
  })

  it('gives waiting-on-you and waiting-on-worker visibly different colours', () => {
    expect(statusColour('waiting-on-you')).not.toBe(statusColour('waiting-on-worker'))
  })

  it('is stable for the same input', () => {
    expect(statusColour('working')).toBe(statusColour('working'))
  })
})

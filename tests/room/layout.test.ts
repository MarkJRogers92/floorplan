import { describe, it, expect } from 'vitest'
import { layout } from '../../src/room/layout'

const bounds = { w: 200, h: 200 }

describe('layout', () => {
  it('returns nothing for no desks', () => {
    expect(layout(0, bounds)).toEqual([])
  })

  it('places the first desk at the top-left inside the padding', () => {
    expect(layout(1, bounds, 50)[0]).toEqual({ x: 8, y: 8, w: 50, h: 50 })
  })

  it('fills a row before wrapping', () => {
    const r = layout(3, bounds, 50)
    expect(r.map(p => p.x)).toEqual([8, 62, 116])
    expect(r.every(p => p.y === 8)).toBe(true)
  })

  it('wraps to the next row when the row is full', () => {
    const r = layout(4, bounds, 50)
    expect(r[3]).toEqual({ x: 8, y: 62, w: 50, h: 50 })
  })

  it('is deterministic', () => {
    expect(layout(7, bounds, 44)).toEqual(layout(7, bounds, 44))
  })

  it('keeps every rect inside the bounds for a sensible cell size', () => {
    for (const p of layout(9, bounds, 48)) {
      expect(p.x + p.w).toBeLessThanOrEqual(bounds.w)
      expect(p.y + p.h).toBeLessThanOrEqual(bounds.h)
    }
  })
})

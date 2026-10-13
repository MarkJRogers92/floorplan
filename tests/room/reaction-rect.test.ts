import { it, expect } from 'vitest'
import { reactionRect } from '../../src/room/room'
import type { StageFrame } from '../../src/room/stage'

const rect = { x: 8, y: 8, w: 48, h: 48 }
const frame = (dx: number, dy: number): StageFrame => ({ sessionID: 'actor', beatID: 'real', kind: 'tool-fails', pose: 'recoil', dx, dy })
it('keeps a reaction inside its own desk cell even at motion extremes', () => {
  expect(reactionRect(rect, frame(-3, 3))).toEqual({ x: 9, y: 15, w: 40, h: 40 })
  expect(reactionRect(rect, frame(3, -3))).toEqual({ x: 15, y: 9, w: 40, h: 40 })
  expect(reactionRect(rect)).toEqual({ x: 12, y: 12, w: 40, h: 40 })
})
it('invalid offsets cannot make canvas geometry NaN or escape a cell', () => {
  expect(reactionRect(rect, frame(Infinity, NaN))).toEqual({ x: 12, y: 12, w: 40, h: 40 })
  expect(reactionRect(rect, frame(-100, 100))).toEqual({ x: 9, y: 15, w: 40, h: 40 })
})

import type { Desk, DeskStatus } from '../state/desk'
import { layout } from './layout'

// Each status gets its own hue. waiting-on-you (amber) and waiting-on-worker (violet)
// must never look alike: "needs you" and "blocked on a sibling" are different situations.
const COLOURS: Record<DeskStatus, string> = {
  idle: '#6b7280',
  working: '#3b82f6',
  'waiting-on-you': '#f59e0b',
  'waiting-on-worker': '#a855f7',
  success: '#22c55e',
  failure: '#ef4444',
}

const RADIUS = 6
const DOT = 6
const DOT_FILL = '#2b2d3a'

export function statusColour(status: DeskStatus): string {
  return COLOURS[status]
}

// Draws desks as coloured rectangles. No text, no sprites: art is deliberately absent.
export function createRoom(canvas: HTMLCanvasElement): { draw(desks: Desk[]): void } {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  return {
    draw(desks: Desk[]) {
      const bounds = { w: canvas.width, h: canvas.height }
      ctx.clearRect(0, 0, bounds.w, bounds.h)
      const rects = layout(desks.length, bounds)
      desks.forEach((desk, i) => {
        const r = rects[i]
        // Desks past the last visible row are not drawn (see layout's shortcut note).
        if (r.y + r.h > bounds.h) return
        ctx.fillStyle = statusColour(desk.status)
        ctx.beginPath()
        ctx.roundRect(r.x, r.y, r.w, r.h, RADIUS)
        ctx.fill()
        ctx.fillStyle = DOT_FILL
        ctx.beginPath()
        ctx.arc(r.x + r.w - DOT, r.y + DOT, DOT / 2, 0, Math.PI * 2)
        ctx.fill()
      })
    },
  }
}

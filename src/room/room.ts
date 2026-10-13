import type { Desk, DeskStatus } from '../state/desk'
import { layout, type Rect } from './layout'
import type { StageFrame, StagePose } from './stage'

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

export function statusColour(status: DeskStatus): string {
  return COLOURS[status]
}

export function reactionRect(rect: Rect, frame?: StageFrame): Rect {
  const offset = (value?: number) => Number.isFinite(value) ? Math.round(Math.max(-3, Math.min(3, value!))) : 0
  return { x: rect.x + 4 + offset(frame?.dx), y: rect.y + 4 + offset(frame?.dy), w: rect.w - 8, h: rect.h - 8 }
}
const POSE_FRAME: Record<StagePose, number> = {
  idle: 0, think: 1, speak: 2, work: 3, recoil: 4, alert: 2, arrive: 0, leave: 0, wrap: 0, cut: 4, forget: 1, retry: 3,
}

// Status stays factual; the worker pose is an explicitly dramatised reaction to footage.
export function createRoom(canvas: HTMLCanvasElement, worker?: HTMLImageElement): {
  draw(desks: Desk[], frames?: ReadonlyMap<string, StageFrame>): void
} {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  return {
    draw(desks: Desk[], frames?: ReadonlyMap<string, StageFrame>) {
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
        const cue = frames?.get(desk.sessionID)
        const actor = reactionRect(r, cue)
        if (worker?.complete && worker.naturalWidth === 80 && worker.naturalHeight === 20) {
          ctx.imageSmoothingEnabled = false
          const pose = cue ? POSE_FRAME[cue.pose] : 0
          ctx.drawImage(worker, pose * 16, 0, 16, 20, actor.x + 4, actor.y, 32, 40)
        } else if (cue) {
          ctx.strokeStyle = '#e5e7eb'
          ctx.strokeRect(actor.x, actor.y, actor.w, actor.h)
        }
      })
    },
  }
}

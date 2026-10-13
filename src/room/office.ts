/**
 * The office (Task 1, office-experiment): one constant logical world drawn with integer
 * `fillRect` primitives, scaled by an integer factor so the pixels stay square and the
 * scene letterboxes inside any canvas.
 *
 * Drawing is a pure function of desks, stage frames and names — no clock, no DOM, no
 * image loading. The approved 80x20 worker sheet is reused unchanged (five 16x20 poses);
 * nothing here writes sprite files or reaches a tool. A real desk always shows its real
 * status and label, whether or not the sheet is loaded.
 */
import type { Desk, DeskStatus } from '../state/desk'
import type { Rect } from './layout'
import type { StageFrame, StagePose } from './stage'

/** The scene's fixed logical size, in its own pixels ("320x200-ish"). */
export const WORLD = { w: 320, h: 200 } as const

/** Where workers sit. Only the first STATIONS.length desks are real, seated actors. */
const STATIONS: readonly Rect[] = [
  { x: 12, y: 112, w: 88, h: 42 },
  { x: 112, y: 112, w: 88, h: 42 },
  { x: 212, y: 112, w: 88, h: 42 },
  { x: 12, y: 156, w: 88, h: 42 },
  { x: 112, y: 156, w: 88, h: 42 },
  { x: 212, y: 156, w: 88, h: 42 },
]

export type OfficeLayout = {
  /** The fixed logical world, in its own pixels. */
  world: { w: number; h: number }
  /** Integer zoom: one logical pixel maps to exactly this many device pixels. */
  scale: number
  /** Integer device offset that centres the scaled world (letterbox bars). */
  offset: { x: number; y: number }
  /** One bounded logical rectangle per seated worker, first six only. */
  stations: Rect[]
  /** Desks past the sixth: counted, never seated and never invented. */
  overflow: number
}

/** Pure, DOM-free geometry — what `draw` uses, testable on its own. */
export function officeLayout(count: number, bounds: { w: number; h: number }): OfficeLayout {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  const w = Number.isFinite(bounds.w) ? bounds.w : 0
  const h = Number.isFinite(bounds.h) ? bounds.h : 0
  const fit = Math.min(w / WORLD.w, h / WORLD.h)
  const scale = Math.max(1, Number.isFinite(fit) ? Math.floor(fit) : 1)
  return {
    world: { ...WORLD },
    scale,
    offset: {
      x: Math.max(0, Math.floor((w - WORLD.w * scale) / 2)),
      y: Math.max(0, Math.floor((h - WORLD.h * scale) / 2)),
    },
    stations: STATIONS.slice(0, n).map(s => ({ ...s })),
    overflow: Math.max(0, n - STATIONS.length),
  }
}

// ---------------------------------------------------------------------------
// Palette. Flat pixel-art colours only: no gradients, no alpha, no off-grid values.
// ---------------------------------------------------------------------------
const INK = '#2b241c'
const WALL = '#f3e6c8'
const WALL_TOP = '#e6d5ad'
const BASEBOARD = '#a8794a'
const FLOOR = '#c98a4b'
const FLOOR_SEAM = '#a4682f'
const FLOOR_LIGHT = '#d79a5b'
const RUG_EDGE = '#1f6f68'
const RUG = '#2f8f86'
const RUG_PALE = '#57b3a8'
const WOOD = '#8a5a2b'
const WOOD_LIGHT = '#a9743c'
const WOOD_DARK = '#6b411d'
const GLASS = '#bde3f0'
const FRAME = '#fffaf0'
const LEAF = '#3f8f4f'
const LEAF_DARK = '#2c6b39'
const POT = '#b5623c'
const CHAIR = '#5b6b7a'
const CHAIR_DARK = '#3f4b57'
const SCREEN = '#22303a'
const NEUTRAL = '#e5e7eb'
const BOOKS = ['#c94f4f', '#4f7fc9', '#4fc98a', '#c9a24f']

// Each status keeps its own hue. waiting-on-you (amber) and waiting-on-worker (violet)
// must never look alike: "needs you" and "blocked on a sibling" are different situations.
const COLOURS: Record<DeskStatus, string> = {
  idle: '#6b7280',
  working: '#3b82f6',
  'waiting-on-you': '#f59e0b',
  'waiting-on-worker': '#a855f7',
  success: '#22c55e',
  failure: '#ef4444',
}

export function statusColour(status: DeskStatus): string {
  return COLOURS[status]
}

/** Short, readable words: the status is shown as text, never by colour alone. */
const STATUS_TEXT: Record<DeskStatus, string> = {
  idle: 'idle',
  working: 'working',
  'waiting-on-you': 'needs you',
  'waiting-on-worker': 'waiting',
  success: 'done',
  failure: 'failed',
}

/** Status stays factual; the pose is the dramatised reaction the stage runtime supplies. */
const POSE_FRAME: Record<StagePose, number> = {
  idle: 0, think: 1, speak: 2, work: 3, recoil: 4, alert: 2, arrive: 0, leave: 0, wrap: 0, cut: 4, forget: 1, retry: 3,
}

const LABEL_PX = 7 // 7 logical px at scale 2 is the ~14px readable label the spec asks for
const NAME_CHARS = 10
const CHAR_PX = 4 // monospace advance at LABEL_PX, for right-aligning the status word

type Ctx = Pick<CanvasRenderingContext2D,
  'clearRect' | 'fillRect' | 'strokeRect' | 'fillText' | 'drawImage' | 'setTransform' |
  'fillStyle' | 'strokeStyle' | 'font' | 'textBaseline' | 'imageSmoothingEnabled'>

function fill(ctx: Ctx, colour: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = colour
  ctx.fillRect(x, y, w, h)
}

function label(ctx: Ctx, text: string, x: number, y: number): void {
  ctx.font = `${LABEL_PX}px monospace`
  ctx.textBaseline = 'top'
  ctx.fillStyle = INK
  ctx.fillText(text, x, y)
}

/** Session ids are opaque: clip them with an ellipsis, never dress them up as a name. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Actor placement: the stage offset moves an actor up to ±3 logical px, always inside its
 * own station. Kept for its existing callers and tests; `draw` uses it for the same job.
 */
export function reactionRect(rect: Rect, frame?: StageFrame): Rect {
  const offset = (value?: number) => Number.isFinite(value) ? Math.round(Math.max(-3, Math.min(3, value!))) : 0
  return { x: rect.x + 4 + offset(frame?.dx), y: rect.y + 4 + offset(frame?.dy), w: rect.w - 8, h: rect.h - 8 }
}

// ---------------------------------------------------------------------------
// The room itself: wall, window, coffee nook, bookshelf, meeting rug and plants.
// ---------------------------------------------------------------------------
function drawWindow(ctx: Ctx): void {
  fill(ctx, FRAME, 16, 8, 96, 36)
  fill(ctx, GLASS, 20, 12, 88, 28)
  fill(ctx, FRAME, 60, 12, 4, 28)
  fill(ctx, FRAME, 20, 24, 88, 3)
  fill(ctx, FRAME, 26, 16, 14, 5)
  fill(ctx, '#e8f3f7', 30, 20, 16, 4)
  fill(ctx, '#fff8e3', 12, 44, 104, 3) // daylight spilling down the wall
  fill(ctx, FLOOR_LIGHT, 20, 50, 100, 12)
}

function drawNook(ctx: Ctx): void {
  fill(ctx, WOOD_DARK, 124, 30, 52, 14)
  fill(ctx, WOOD, 126, 32, 48, 10)
  fill(ctx, '#d9d2c4', 128, 14, 12, 16) // coffee machine
  fill(ctx, INK, 129, 12, 10, 3)
  fill(ctx, FRAME, 146, 22, 6, 6) // mugs
  fill(ctx, FRAME, 156, 22, 6, 6)
}

function drawShelf(ctx: Ctx): void {
  fill(ctx, WOOD_DARK, 232, 6, 72, 38)
  fill(ctx, '#3a2716', 236, 10, 64, 30)
  fill(ctx, WOOD_DARK, 236, 22, 64, 2)
  fill(ctx, WOOD_DARK, 236, 34, 64, 2)
  BOOKS.forEach((colour, i) => {
    fill(ctx, colour, 238 + i * 9, 12, 6, 9)
    fill(ctx, colour, 238 + i * 9, 24, 6, 9)
  })
}

function drawRug(ctx: Ctx): void {
  fill(ctx, RUG_EDGE, 108, 54, 104, 54)
  fill(ctx, RUG, 112, 58, 96, 46)
  fill(ctx, RUG_PALE, 122, 66, 76, 30)
  fill(ctx, WOOD, 134, 70, 52, 28) // meeting table
  fill(ctx, WOOD_LIGHT, 136, 72, 48, 8)
  fill(ctx, WOOD_DARK, 138, 96, 4, 6)
  fill(ctx, WOOD_DARK, 178, 96, 4, 6)
  fill(ctx, CHAIR_DARK, 122, 76, 8, 16)
  fill(ctx, CHAIR_DARK, 190, 76, 8, 16)
}

function drawPlants(ctx: Ctx): void {
  fill(ctx, POT, 6, 92, 20, 14)
  fill(ctx, LEAF_DARK, 4, 74, 24, 20)
  fill(ctx, LEAF, 8, 68, 16, 18)
  fill(ctx, POT, 294, 92, 20, 14)
  fill(ctx, LEAF_DARK, 292, 76, 24, 18)
  fill(ctx, LEAF, 296, 70, 16, 16)
}

function drawScene(ctx: Ctx): void {
  fill(ctx, WALL, 0, 0, WORLD.w, 46)
  fill(ctx, WALL_TOP, 0, 0, WORLD.w, 4)
  fill(ctx, BASEBOARD, 0, 43, WORLD.w, 3)
  fill(ctx, FLOOR, 0, 46, WORLD.w, WORLD.h - 46)
  for (let y = 60, row = 0; y < WORLD.h; y += 14, row++) {
    fill(ctx, FLOOR_SEAM, 0, y, WORLD.w, 1)
    fill(ctx, FLOOR_LIGHT, 0, y + 1, WORLD.w, 1)
    for (let x = row % 2 ? 0 : 24; x < WORLD.w; x += 48) fill(ctx, FLOOR_SEAM, x, y + 1, 1, 13)
  }
  drawWindow(ctx)
  drawNook(ctx)
  drawShelf(ctx)
  drawRug(ctx)
  drawPlants(ctx)
}

/** One real desk, its worker (or the neutral fallback) and its status-coloured surfaces. */
function drawStation(ctx: Ctx, st: Rect, desk: Desk, cue: StageFrame | undefined, name: string | undefined, sheet: HTMLImageElement | undefined): void {
  const led = statusColour(desk.status)
  fill(ctx, CHAIR, st.x + 28, st.y, 30, 6) // chair back, behind the worker
  fill(ctx, CHAIR_DARK, st.x + 28, st.y + 5, 30, 2)
  const spot = reactionRect({ x: st.x + 30, y: st.y + 2, w: 24, h: 24 }, cue)
  if (sheet) {
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(sheet, (cue ? POSE_FRAME[cue.pose] : 0) * 16, 0, 16, 20, spot.x, spot.y, 16, 20)
  } else {
    // No usable sheet: a neutral outline body, so the worker's desk is never hidden.
    ctx.strokeStyle = NEUTRAL
    ctx.strokeRect(spot.x, spot.y, 16, 20)
  }
  fill(ctx, WOOD, st.x + 2, st.y + 20, st.w - 4, 14) // desk top, in front so they read as seated
  fill(ctx, WOOD_LIGHT, st.x + 2, st.y + 20, st.w - 4, 3)
  fill(ctx, WOOD_DARK, st.x + 2, st.y + 32, st.w - 4, 2)
  fill(ctx, WOOD_DARK, st.x + 4, st.y + 34, 3, 8)
  fill(ctx, WOOD_DARK, st.x + st.w - 7, st.y + 34, 3, 8)
  fill(ctx, SCREEN, st.x + 58, st.y + 6, 24, 14) // monitor, to the worker's side
  fill(ctx, led, st.x + 60, st.y + 8, 20, 10)
  fill(ctx, led, st.x + 6, st.y + 28, st.w - 12, 2) // the desk's status LED strip
  fill(ctx, BOOKS[hash(desk.sessionID) % BOOKS.length], st.x + 6, st.y + 21, 6, 5) // desk badge: decorative, never the status
  label(ctx, clip(name ?? desk.sessionID, NAME_CHARS), st.x + 2, st.y + 35)
  const word = STATUS_TEXT[desk.status]
  label(ctx, word, st.x + st.w - 2 - word.length * CHAR_PX, st.y + 35)
}

/** Overflow is counted on the canvas and shown as a note — never as an invented worker. */
function drawOverflow(ctx: Ctx, n: number): void {
  const text = `+${n} more`
  label(ctx, text, 230 - text.length * CHAR_PX, 2)
}

export function createRoom(canvas: HTMLCanvasElement, worker?: HTMLImageElement): {
  draw(desks: Desk[], frames?: ReadonlyMap<string, StageFrame>, names?: ReadonlyMap<string, string>): void
} {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  return {
    draw(desks: Desk[], frames?: ReadonlyMap<string, StageFrame>, names?: ReadonlyMap<string, string>) {
      const bounds = { w: canvas.width, h: canvas.height }
      const layout = officeLayout(desks.length, bounds)
      // The dataset owns the overflow count: an honest number, not an extra character.
      if (canvas.dataset) canvas.dataset.overflow = String(layout.overflow)
      ctx.clearRect(0, 0, bounds.w, bounds.h)
      ctx.imageSmoothingEnabled = false
      ctx.setTransform(layout.scale, 0, 0, layout.scale, layout.offset.x, layout.offset.y)
      drawScene(ctx)
      // A sheet is only trusted when it is the shipped 80x20 art, fully loaded.
      const sheet = worker?.complete && worker.naturalWidth === 80 && worker.naturalHeight === 20 ? worker : undefined
      layout.stations.forEach((st, i) => {
        const desk = desks[i]!
        drawStation(ctx, st, desk, frames?.get(desk.sessionID), names?.get(desk.sessionID), sheet)
      })
      if (layout.overflow > 0) drawOverflow(ctx, layout.overflow)
    },
  }
}

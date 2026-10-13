/**
 * Task 1 (office-experiment): the office's pure geometry and its bounded behaviour.
 *
 * `officeLayout` is DOM-free, so its letterbox/scale/overflow contract is pinned directly.
 * The `draw` checks here are the ones that prove the world is bounded: a ninth desk is
 * counted, never seated; an empty floor is furniture only; the same desks draw the same
 * pixels. The per-station drawing contract lives in room-draw.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { createRoom, officeLayout } from '../../src/room/office'
import type { Desk } from '../../src/state/desk'

const WORLD = { w: 320, h: 200 }

type Call = { op: string; args: unknown[]; fillStyle?: string; smoothing?: boolean }

function recorder() {
  const calls: Call[] = []
  const ctx = {
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', imageSmoothingEnabled: true,
    clearRect(...a: number[]) { calls.push({ op: 'clearRect', args: a }) },
    setTransform(...a: number[]) { calls.push({ op: 'setTransform', args: a }) },
    fillRect(...a: number[]) { calls.push({ op: 'fillRect', args: a, fillStyle: ctx.fillStyle }) },
    strokeRect(...a: number[]) { calls.push({ op: 'strokeRect', args: a }) },
    fillText(text: string, ...a: number[]) { calls.push({ op: 'fillText', args: [text, ...a] }) },
    drawImage(...a: unknown[]) { calls.push({ op: 'drawImage', args: a, smoothing: ctx.imageSmoothingEnabled }) },
  }
  return { ctx, calls }
}

/** The canvas stub owns `dataset`: that is where draw must report the overflow count. */
function canvasOf(w: number, h: number, ctx: object) {
  const dataset: Record<string, string> = {}
  const canvas = { width: w, height: h, dataset, getContext: () => ctx }
  return { canvas: canvas as unknown as HTMLCanvasElement, dataset }
}

const sheet = () => ({ complete: true, naturalWidth: 80, naturalHeight: 20 }) as unknown as HTMLImageElement
const desk = (sessionID: string): Desk =>
  ({ sessionID, status: 'working', caption: '', openPermissions: [], waitingOnSibling: false })
const ids = (n: number) => Array.from({ length: n }, (_, i) => desk(`ses_${i}`))
const ops = (calls: Call[], op: string) => calls.filter(call => call.op === op)
const styles = (calls: Call[]) => ops(calls, 'fillRect').map(call => call.fillStyle)
const inWorld = (r: { x: number; y: number; w: number; h: number }) =>
  Number.isInteger(r.x) && Number.isInteger(r.y) && r.x >= 0 && r.y >= 0 &&
  r.x + r.w <= WORLD.w && r.y + r.h <= WORLD.h

describe('officeLayout', () => {
  it('letterboxes a constant logical world with an integer zoom', () => {
    const double = officeLayout(3, { w: 640, h: 400 })
    expect(double.world).toEqual(WORLD)
    expect(double.scale).toBe(2)
    expect(double.offset).toEqual({ x: 0, y: 0 })
    // A wide, short canvas fits once and letterboxes on the long axis.
    const once = officeLayout(3, { w: 800, h: 200 })
    expect(once.scale).toBe(1)
    expect(once.offset).toEqual({ x: 240, y: 0 })
    for (const l of [double, once]) {
      expect(Number.isInteger(l.scale)).toBe(true)
      expect(Number.isInteger(l.offset.x)).toBe(true)
      expect(Number.isInteger(l.offset.y)).toBe(true)
      expect(l.scale).toBeLessThanOrEqual(Math.floor(Math.min(640 / WORLD.w, 400 / WORLD.h)) + 99)
    }
  })

  it('stays 1x with a non-negative offset on a tiny canvas: no NaN, no crop of the origin', () => {
    for (const bounds of [{ w: 30, h: 20 }, { w: 0, h: 0 }, { w: 319, h: 199 }]) {
      const l = officeLayout(6, bounds)
      expect(l.scale, JSON.stringify(bounds)).toBe(1)
      expect(l.offset.x).toBeGreaterThanOrEqual(0)
      expect(l.offset.y).toBeGreaterThanOrEqual(0)
      expect([l.scale, l.offset.x, l.offset.y].every(Number.isInteger)).toBe(true)
      expect(l.stations.every(inWorld)).toBe(true)
    }
  })

  it('seats at most six and counts the rest as overflow', () => {
    const l = officeLayout(9, { w: 640, h: 400 })
    expect(l.stations).toHaveLength(6)
    expect(l.overflow).toBe(3)
    expect(l.stations.every(inWorld)).toBe(true)
    // Six distinct stations, none sharing a cell.
    expect(new Set(l.stations.map(s => `${s.x},${s.y}`)).size).toBe(6)
    expect(officeLayout(2, { w: 640, h: 400 }).overflow).toBe(0)
    expect(officeLayout(0, { w: 640, h: 400 })).toEqual({ world: WORLD, scale: 2, offset: { x: 0, y: 0 }, stations: [], overflow: 0 })
  })

  it('sanitises a nonsensical desk count instead of returning NaN geometry', () => {
    expect(officeLayout(NaN, { w: 640, h: 400 }).stations).toHaveLength(0)
    expect(officeLayout(-4, { w: 640, h: 400 })).toMatchObject({ stations: [], overflow: 0 })
    expect(officeLayout(2.9, { w: 640, h: 400 }).stations).toHaveLength(2)
  })
})

describe('createRoom with the office world', () => {
  it('counts desks past the sixth on the canvas, never as ghost actors', () => {
    const { ctx, calls } = recorder()
    const { canvas, dataset } = canvasOf(640, 400, ctx)
    createRoom(canvas).draw(ids(9))
    expect(dataset.overflow).toBe('3')
    expect(ops(calls, 'drawImage')).toHaveLength(0)
  })

  it('reports zero overflow for six or fewer desks', () => {
    const { ctx } = recorder()
    const { canvas, dataset } = canvasOf(640, 400, ctx)
    const room = createRoom(canvas)
    room.draw(ids(6))
    expect(dataset.overflow).toBe('0')
    room.draw([])
    expect(dataset.overflow).toBe('0')
  })

  it('draws an empty floor as furniture only, never invented characters', () => {
    const empty = recorder()
    const { canvas } = canvasOf(640, 400, empty.ctx)
    createRoom(canvas, sheet()).draw([])
    expect(ops(empty.calls, 'drawImage')).toHaveLength(0)
    expect(ops(empty.calls, 'fillText')).toHaveLength(0)
    // Real set dressing: warm floor, cream wall and the teal meeting rug — not a blank canvas.
    const decor = new Set(styles(empty.calls))
    expect(decor).toContain('#c98a4b')
    expect(decor).toContain('#f3e6c8')
    expect(decor).toContain('#2f8f86')

    const full = recorder()
    createRoom(canvasOf(640, 400, full.ctx).canvas, sheet()).draw(ids(2))
    expect(ops(full.calls, 'drawImage').length).toBeGreaterThan(0)
    expect(styles(full.calls)).toContain('#3b82f6') // working's status colour, from statusColour
  })

  it('ignores a frame whose actor has no desk', () => {
    const { ctx, calls } = recorder()
    const { canvas } = canvasOf(640, 400, ctx)
    createRoom(canvas, sheet()).draw(
      [desk('ses_0')],
      new Map([['ghost', { sessionID: 'ghost', beatID: 'b:1', kind: 'says', pose: 'recoil', dx: 0, dy: 0 }]]),
    )
    // Only the real desk is drawn, and it rests: the ghost's recoil cell (4) is never cropped.
    expect(ops(calls, 'drawImage')).toHaveLength(1)
    expect(ops(calls, 'drawImage')[0]!.args[1]).toBe(0)
  })

  it('is deterministic: the same desks draw byte-for-byte the same calls', () => {
    const a = recorder()
    const b = recorder()
    createRoom(canvasOf(640, 400, a.ctx).canvas, sheet()).draw(ids(3))
    createRoom(canvasOf(640, 400, b.ctx).canvas, sheet()).draw(ids(3))
    expect(b.calls).toEqual(a.calls)
  })
})

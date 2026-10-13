/**
 * Committed canvas evidence for the room renderer (review finding 3: crop/drawImage, status
 * colours and desk deletion were only ever checked by the ignored scratch harness). Node
 * environment, so the canvas is a stub that records every 2D call and the style values in
 * force when the call happened. The assertions pin the real drawing contract — crop cell,
 * destination size, smoothing, cell bounds — not a re-implementation of `draw`.
 */
import { describe, expect, it } from 'vitest'
import { createRoom, statusColour } from '../../src/room/room'
import type { StageFrame, StagePose } from '../../src/room/stage'
import type { Desk, DeskStatus } from '../../src/state/desk'

type Call = { op: string; args: unknown[]; fillStyle?: string; smoothing?: boolean }
type Ctx = {
  fillStyle: string
  strokeStyle: string
  imageSmoothingEnabled: boolean
  clearRect(...a: number[]): void
  beginPath(): void
  roundRect(...a: number[]): void
  fill(): void
  strokeRect(...a: number[]): void
  drawImage(...a: unknown[]): void
}

function recorder(): { ctx: Ctx; calls: Call[] } {
  const calls: Call[] = []
  const ctx: Ctx = {
    fillStyle: '', strokeStyle: '', imageSmoothingEnabled: true,
    clearRect(...a) { calls.push({ op: 'clearRect', args: a }) },
    beginPath() { calls.push({ op: 'beginPath', args: [] }) },
    roundRect(...a) { calls.push({ op: 'roundRect', args: a }) },
    fill() { calls.push({ op: 'fill', args: [], fillStyle: ctx.fillStyle }) },
    strokeRect(...a) { calls.push({ op: 'strokeRect', args: a }) },
    drawImage(...a) { calls.push({ op: 'drawImage', args: a, smoothing: ctx.imageSmoothingEnabled }) },
  }
  return { ctx, calls }
}

const canvasOf = (w: number, h: number, ctx: Ctx) => ({ width: w, height: h, getContext: () => ctx }) as unknown as HTMLCanvasElement
/** The shipped art is a layered 80x20 sheet: five 16x20 poses, left to right. */
const sheet = (w = 80, h = 20) => ({ complete: true, naturalWidth: w, naturalHeight: h }) as unknown as HTMLImageElement
const desk = (sessionID: string, status: DeskStatus = 'working'): Desk =>
  ({ sessionID, status, caption: '', openPermissions: [], waitingOnSibling: false })
const frame = (sessionID: string, pose: StagePose, dx = 0, dy = 0): StageFrame =>
  ({ sessionID, beatID: `b:${sessionID}`, kind: 'says', pose, dx, dy })
const ops = (calls: Call[], op: string): Call[] => calls.filter(call => call.op === op)

describe('createRoom draw', () => {
  it('refuses a canvas with no 2D context instead of silently drawing nowhere', () => {
    expect(() => createRoom({ getContext: () => null } as unknown as HTMLCanvasElement))
      .toThrow('2D canvas context unavailable')
  })

  it('clears the whole canvas and fills each desk in its own status colour', () => {
    const { ctx, calls } = recorder()
    const statuses: DeskStatus[] = ['idle', 'working', 'waiting-on-you', 'waiting-on-worker', 'success', 'failure']
    createRoom(canvasOf(800, 200, ctx)).draw(statuses.map((status, i) => desk(`ses_${i}`, status)))
    expect(ops(calls, 'clearRect')[0]!.args).toEqual([0, 0, 800, 200])
    expect(ops(calls, 'fill').map(call => call.fillStyle)).toEqual(statuses.map(statusColour))
    // Rounded cell at the layout's own first two positions: 8px pad, 48px cell, 6px radius.
    expect(ops(calls, 'roundRect').map(call => call.args).slice(0, 2)).toEqual([[8, 8, 48, 48, 6], [60, 8, 48, 48, 6]])
  })

  it('crops one 16x20 pose and draws it 32x40 with image smoothing off', () => {
    const worker = sheet()
    const poses: [StagePose, number][] = [['idle', 0], ['think', 1], ['speak', 2], ['work', 3], ['recoil', 4], ['alert', 2]]
    for (const [pose, cell] of poses) {
      const { ctx, calls } = recorder()
      createRoom(canvasOf(800, 200, ctx), worker).draw([desk('ses_0')], new Map([['ses_0', frame('ses_0', pose)]]))
      const draw = ops(calls, 'drawImage')[0]!
      expect(draw.args, pose).toEqual([worker, cell * 16, 0, 16, 20, 16, 12, 32, 40])
      expect(draw.smoothing, pose).toBe(false)
    }
    // No cue at all still draws the resting frame rather than nothing.
    const { ctx, calls } = recorder()
    createRoom(canvasOf(800, 200, ctx), worker).draw([desk('ses_0')])
    expect(ops(calls, 'drawImage')[0]!.args).toEqual([worker, 0, 0, 16, 20, 16, 12, 32, 40])
  })

  it('honours a zero-offset (reduced-motion) frame and rounds fractional offsets', () => {
    const worker = sheet()
    const { ctx, calls } = recorder()
    createRoom(canvasOf(800, 200, ctx), worker)
      .draw([desk('ses_0')], new Map([['ses_0', frame('ses_0', 'work', 0, 0)]]))
    // Reduced motion must not read as "no cue": pose 3 is still the work cell, not idle.
    expect(ops(calls, 'drawImage')[0]!.args).toEqual([worker, 48, 0, 16, 20, 16, 12, 32, 40])
    const rounded = recorder()
    createRoom(canvasOf(800, 200, rounded.ctx), worker)
      .draw([desk('ses_0')], new Map([['ses_0', frame('ses_0', 'work', 2.6, 0.4)]]))
    expect(ops(rounded.calls, 'drawImage')[0]!.args).toEqual([worker, 48, 0, 16, 20, 19, 12, 32, 40])
  })

  it('keeps every reaction inside its own desk cell at the motion extremes', () => {
    const worker = sheet()
    const { ctx, calls } = recorder()
    createRoom(canvasOf(800, 200, ctx), worker).draw(
      [desk('ses_0'), desk('ses_1'), desk('ses_2')],
      new Map([
        ['ses_0', frame('ses_0', 'recoil', -3, 3)],
        ['ses_1', frame('ses_1', 'work', 3, -3)],
        ['ses_2', frame('ses_2', 'work', 9, -9)], // an out-of-range caller is clamped, not trusted
      ]),
    )
    // Cells start at x=8/60/112 and are 48 wide: every 32x40 destination stays inside its own.
    expect(ops(calls, 'drawImage').map(call => call.args.slice(5)))
      .toEqual([[13, 15, 32, 40], [71, 9, 32, 40], [123, 9, 32, 40]])
  })

  it('never stretches a wrongly-sized or not-yet-loaded sheet, falling back to the outline', () => {
    for (const worker of [sheet(40, 10), sheet(80, 40), { complete: false, naturalWidth: 80, naturalHeight: 20 } as unknown as HTMLImageElement]) {
      const { ctx, calls } = recorder()
      createRoom(canvasOf(800, 200, ctx), worker)
        .draw([desk('ses_0')], new Map([['ses_0', frame('ses_0', 'recoil')]]))
      expect(ops(calls, 'drawImage')).toHaveLength(0)
      expect(ops(calls, 'strokeRect').map(call => call.args)).toEqual([[12, 12, 40, 40]])
    }
  })

  it('works with no worker image: desks fill, and only a cued desk is outlined', () => {
    const { ctx, calls } = recorder()
    createRoom(canvasOf(800, 200, ctx))
      .draw([desk('ses_0'), desk('ses_1')], new Map([['ses_1', frame('ses_1', 'alert')]]))
    expect(ops(calls, 'fill')).toHaveLength(2)
    expect(ops(calls, 'drawImage')).toHaveLength(0)
    expect(ops(calls, 'strokeRect').map(call => call.args)).toEqual([[64, 12, 40, 40]])
  })

  it('draws nothing for a frame whose actor has no desk, including one just deleted', () => {
    const worker = sheet()
    const { ctx, calls } = recorder()
    const room = createRoom(canvasOf(800, 200, ctx), worker)
    room.draw([desk('ses_0'), desk('ses_1')], new Map([
      ['ses_0', frame('ses_0', 'speak')],
      ['ghost', frame('ghost', 'recoil')],
    ]))
    expect(ops(calls, 'fill')).toHaveLength(2)
    // One frame per visible desk: speak's cell 2 for ses_0, the resting cell for the uncued
    // ses_1 — and never a frame for the deskless ghost, whose recoil cell is 4.
    expect(ops(calls, 'drawImage').map(call => call.args[1])).toEqual([32, 0])
    const before = calls.length
    // ses_1's frame is still delivered after its desk is gone: it must not resurrect it.
    room.draw([desk('ses_0')], new Map([['ses_0', frame('ses_0', 'speak')], ['ses_1', frame('ses_1', 'work')]]))
    expect(ops(calls.slice(before), 'fill')).toHaveLength(1)
    expect(ops(calls.slice(before), 'drawImage').map(call => call.args[1])).toEqual([32])
  })

  it('skips a desk whose row falls past the canvas instead of half-drawing it', () => {
    const { ctx, calls } = recorder()
    // 200x100 fits 3 columns (8px pad, 48px cell, 4px gap); desk 4 sits at y=60 and would end at 108.
    createRoom(canvasOf(200, 100, ctx)).draw([desk('a'), desk('b'), desk('c'), desk('d')])
    expect(ops(calls, 'fill')).toHaveLength(3)
    expect(ops(calls, 'roundRect').map(call => call.args[0])).toEqual([8, 60, 112])
  })
})

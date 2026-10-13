/**
 * Committed canvas evidence for the office renderer (Task 1, office-experiment).
 *
 * Node environment, so the canvas is a stub recording every 2D call and the style in force
 * when it happened. These assertions pin the real drawing contract — the integer world
 * transform, the 16x20 pose crops from the unchanged 80x20 sheet, status-coloured desks,
 * textual status/name labels, the unloaded-image fallback and per-station motion bounds —
 * not a re-implementation of `draw`.
 */
import { describe, expect, it } from 'vitest'
import { createRoom, statusColour } from '../../src/room/room'
import { officeLayout } from '../../src/room/office'
import type { StageFrame, StagePose } from '../../src/room/stage'
import type { Desk, DeskStatus } from '../../src/state/desk'

type Call = { op: string; args: unknown[]; fillStyle?: string; font?: string; smoothing?: boolean }

function recorder() {
  const calls: Call[] = []
  const ctx = {
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', imageSmoothingEnabled: true,
    clearRect(...a: number[]) { calls.push({ op: 'clearRect', args: a }) },
    setTransform(...a: number[]) { calls.push({ op: 'setTransform', args: a }) },
    fillRect(...a: number[]) { calls.push({ op: 'fillRect', args: a, fillStyle: ctx.fillStyle }) },
    strokeRect(...a: number[]) { calls.push({ op: 'strokeRect', args: a }) },
    fillText(text: string, ...a: number[]) { calls.push({ op: 'fillText', args: [text, ...a], fillStyle: ctx.fillStyle, font: ctx.font }) },
    drawImage(...a: unknown[]) { calls.push({ op: 'drawImage', args: a, smoothing: ctx.imageSmoothingEnabled }) },
  }
  return { ctx, calls }
}

const canvasOf = (w: number, h: number, ctx: object) =>
  ({ width: w, height: h, dataset: {}, getContext: () => ctx }) as unknown as HTMLCanvasElement
/** The shipped art is a layered 80x20 sheet: five 16x20 poses, left to right. */
const sheet = (w = 80, h = 20) => ({ complete: true, naturalWidth: w, naturalHeight: h }) as unknown as HTMLImageElement
const desk = (sessionID: string, status: DeskStatus = 'working'): Desk =>
  ({ sessionID, status, caption: '', openPermissions: [], waitingOnSibling: false })
const frame = (sessionID: string, pose: StagePose, dx = 0, dy = 0): StageFrame =>
  ({ sessionID, beatID: `b:${sessionID}`, kind: 'says', pose, dx, dy })
const ops = (calls: Call[], op: string) => calls.filter(call => call.op === op)
const texts = (calls: Call[]) => ops(calls, 'fillText').map(call => call.args[0] as string)
const dest = (call: Call) => call.args.slice(5) as number[]

describe('createRoom draw (office world)', () => {
  it('refuses a canvas with no 2D context instead of silently drawing nowhere', () => {
    expect(() => createRoom({ getContext: () => null } as unknown as HTMLCanvasElement))
      .toThrow('2D canvas context unavailable')
  })

  it('clears in device pixels, then maps the whole logical world with one integer transform', () => {
    const { ctx, calls } = recorder()
    createRoom(canvasOf(640, 400, ctx)).draw([desk('ses_0')])
    expect(ops(calls, 'clearRect')[0]!.args).toEqual([0, 0, 640, 400])
    const t = ops(calls, 'setTransform')[0]!.args
    const l = officeLayout(1, { w: 640, h: 400 })
    expect(t).toEqual([l.scale, 0, 0, l.scale, l.offset.x, l.offset.y])
    expect(t.every(v => typeof v === 'number' && Number.isInteger(v))).toBe(true)
    // A single scale of 2 maps the 320x200 world to 640x400 without a fractional pixel.
    expect(t[0]).toBe(2)
  })

  it('crops one 16x20 pose per station inside its own seat, smoothing off', () => {
    const worker = sheet()
    const poses: [StagePose, number][] = [['idle', 0], ['think', 1], ['speak', 2], ['work', 3], ['recoil', 4], ['alert', 2]]
    for (const [pose, cell] of poses) {
      const { ctx, calls } = recorder()
      createRoom(canvasOf(640, 400, ctx), worker).draw([desk('ses_0')], new Map([['ses_0', frame('ses_0', pose)]]))
      const draw = ops(calls, 'drawImage')[0]!
      const [x, y, w, h] = dest(draw)
      expect(draw.args.slice(0, 5), pose).toEqual([worker, cell * 16, 0, 16, 20])
      expect([w, h], pose).toEqual([16, 20])
      const st = officeLayout(1, { w: 640, h: 400 }).stations[0]!
      expect(x, pose).toBeGreaterThanOrEqual(st.x)
      expect(y, pose).toBeGreaterThanOrEqual(st.y)
      expect(x + w, pose).toBeLessThanOrEqual(st.x + st.w)
      expect(y + h, pose).toBeLessThanOrEqual(st.y + st.h)
      expect(draw.smoothing, pose).toBe(false)
    }
    // No cue at all still draws the resting frame rather than nothing.
    const { ctx, calls } = recorder()
    createRoom(canvasOf(640, 400, ctx), worker).draw([desk('ses_0')])
    expect(ops(calls, 'drawImage')[0]!.args.slice(1, 5)).toEqual([0, 0, 16, 20])
  })

  it('honours a zero-offset (reduced-motion) frame and rounds fractional offsets', () => {
    const worker = sheet()
    const { ctx, calls } = recorder()
    createRoom(canvasOf(640, 400, ctx), worker)
      .draw([desk('ses_0')], new Map([['ses_0', frame('ses_0', 'work', 0, 0)]]))
    // Reduced motion must not read as "no cue": pose 3 is still the work cell, not idle.
    const still = dest(ops(calls, 'drawImage')[0]!)
    expect(ops(calls, 'drawImage')[0]!.args[1]).toBe(48)
    const rounded = recorder()
    createRoom(canvasOf(640, 400, rounded.ctx), worker)
      .draw([desk('ses_0')], new Map([['ses_0', frame('ses_0', 'work', 2.6, 0.4)]]))
    expect(dest(ops(rounded.calls, 'drawImage')[0]!)).toEqual([still[0] + 3, still[1], 16, 20])
  })

  it('keeps every actor inside its own station at the motion extremes', () => {
    const worker = sheet()
    const { ctx, calls } = recorder()
    createRoom(canvasOf(640, 400, ctx), worker).draw(
      [desk('ses_0'), desk('ses_1'), desk('ses_2')],
      new Map([
        ['ses_0', frame('ses_0', 'recoil', -3, 3)],
        ['ses_1', frame('ses_1', 'work', 3, -3)],
        ['ses_2', frame('ses_2', 'work', 9, -9)], // an out-of-range caller is clamped, not trusted
      ]),
    )
    const stations = officeLayout(3, { w: 640, h: 400 }).stations
    ops(calls, 'drawImage').forEach((call, i) => {
      const [x, y, w, h] = dest(call)
      const st = stations[i]!
      expect({ x: x >= st.x, y: y >= st.y, r: x + w <= st.x + st.w, b: y + h <= st.y + st.h }).toEqual({ x: true, y: true, r: true, b: true })
    })
  })

  it('fills a status-coloured desk for every status', () => {
    const statuses: DeskStatus[] = ['idle', 'working', 'waiting-on-you', 'waiting-on-worker', 'success', 'failure']
    for (const status of statuses) {
      const { ctx, calls } = recorder()
      createRoom(canvasOf(640, 400, ctx)).draw([desk('ses_0', status)])
      expect(new Set(ops(calls, 'fillRect').map(call => call.fillStyle)), status).toContain(statusColour(status))
    }
  })

  it('shows a textual status and a name, clipping an unknown id rather than inventing one', () => {
    const labels: [DeskStatus, string][] = [
      ['idle', 'idle'], ['working', 'working'], ['waiting-on-you', 'needs you'],
      ['waiting-on-worker', 'waiting'], ['success', 'done'], ['failure', 'failed'],
    ]
    for (const [status, label] of labels) {
      const { ctx, calls } = recorder()
      createRoom(canvasOf(640, 400, ctx)).draw([desk('ses_0', status)], undefined, new Map([['ses_0', 'Iris']]))
      expect(texts(calls), status).toContain(label)
      expect(texts(calls), status).toContain('Iris')
    }
    // No name known: the session id is shown, clipped with an ellipsis, never a fake name.
    const { ctx, calls } = recorder()
    const long = 'ses_abcdefghijklmnop'
    createRoom(canvasOf(640, 400, ctx)).draw([desk(long)])
    const shown = texts(calls).find(t => t !== 'working')!
    expect(shown.endsWith('…')).toBe(true)
    expect(shown.length).toBeLessThan(long.length)
    expect(long.startsWith(shown.slice(0, -1))).toBe(true)
  })

  it('never stretches a wrongly-sized or not-yet-loaded sheet, drawing a neutral body and the real desk', () => {
    for (const worker of [sheet(40, 10), sheet(80, 40), { complete: false, naturalWidth: 80, naturalHeight: 20 } as unknown as HTMLImageElement]) {
      const { ctx, calls } = recorder()
      createRoom(canvasOf(640, 400, ctx), worker)
        .draw([desk('ses_0')], new Map([['ses_0', frame('ses_0', 'recoil')]]))
      expect(ops(calls, 'drawImage')).toHaveLength(0)
      expect(ops(calls, 'strokeRect')).toHaveLength(1) // the fallback body, so the job stays visible
      expect(ops(calls, 'fillRect').map(call => call.fillStyle)).toContain(statusColour('working'))
      expect(texts(calls)).toContain('working')
    }
  })

  it('draws nothing for an actor with no desk, including one just deleted', () => {
    const worker = sheet()
    const { ctx, calls } = recorder()
    const room = createRoom(canvasOf(640, 400, ctx), worker)
    room.draw([desk('ses_0'), desk('ses_1')], new Map([
      ['ses_0', frame('ses_0', 'speak')],
      ['ghost', frame('ghost', 'recoil')],
    ]))
    expect(ops(calls, 'drawImage').map(call => call.args[1])).toEqual([32, 0])
    const before = calls.length
    room.draw([desk('ses_0')], new Map([['ses_0', frame('ses_0', 'speak')], ['ses_1', frame('ses_1', 'work')]]))
    expect(ops(calls.slice(before), 'drawImage').map(call => call.args[1])).toEqual([32])
  })

  it('draws six real actors and a counted note for the rest, never a seventh character', () => {
    const worker = sheet()
    const { ctx, calls } = recorder()
    const canvas = canvasOf(640, 400, ctx) as HTMLCanvasElement & { dataset: Record<string, string> }
    createRoom(canvas, worker).draw(Array.from({ length: 8 }, (_, i) => desk(`ses_${i}`)))
    expect(ops(calls, 'drawImage')).toHaveLength(6)
    expect(canvas.dataset.overflow).toBe('2')
    expect(texts(calls)).toContain('+2 more')
  })
  it('keeps the overflow note on a different row from every real desk status', () => {
    const { ctx, calls } = recorder()
    createRoom(canvasOf(640, 400, ctx)).draw(Array.from({ length: 7 }, (_, i) => desk(`ses_${i}`, 'waiting-on-you')))
    const note = ops(calls, 'fillText').find(c => c.args[0] === '+1 more')!
    for (const status of ops(calls, 'fillText').filter(c => c.args[0] === 'needs you')) {
      expect(Math.abs(Number(note.args[2]) - Number(status.args[2]))).toBeGreaterThanOrEqual(7)
    }
  })

  it('produces only finite integer geometry on a canvas smaller than the world', () => {
    const { ctx, calls } = recorder()
    createRoom(canvasOf(30, 20, ctx), sheet()).draw([desk('ses_0'), desk('ses_1')])
    for (const call of calls) {
      for (const a of call.args) {
        if (typeof a !== 'number') continue
        expect(Number.isFinite(a), `${call.op} ${a}`).toBe(true)
        expect(Number.isInteger(a), `${call.op} ${a}`).toBe(true)
      }
    }
    expect(ops(calls, 'setTransform')[0]!.args[0]).toBe(1)
  })
})

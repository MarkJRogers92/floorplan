// tests/state/desk-review.test.ts — review fixes 3-6 to the reducer
import { describe, it, expect } from 'vitest'
import { createDesk, applyFrame, settleDesk, withSiblingWait, type Desk } from '../../src/state/desk'

const d = (): Desk => createDesk('s1')
const f = (type: string, data: unknown = {}) => ({ type, data })
const run = (desk: Desk, ...frames: ReturnType<typeof f>[]) => frames.reduce(applyFrame, desk)

describe('settleDesk — §6.3 success/failure fall back to the underlying state', () => {
  it('settles success to idle with an empty caption', () => {
    const done = run(d(), f('session.execution.started'), f('session.execution.succeeded'))
    expect(settleDesk(done)).toEqual({ ...done, status: 'idle', caption: '' })
  })
  it('settles failure to idle with an empty caption', () => {
    const failed = run(d(), f('session.execution.failed'))
    expect(settleDesk(failed)).toMatchObject({ status: 'idle', caption: '' })
  })
  it('settles to waiting-on-worker when a sibling wait is still recorded', () => {
    const desk: Desk = { ...d(), status: 'success', caption: 'done', waitingOnSibling: true }
    expect(settleDesk(desk)).toEqual({ ...desk, status: 'waiting-on-worker', caption: 'waiting on another worker' })
  })
  it('settles to waiting-on-you when a permission is open', () => {
    const desk: Desk = { ...d(), status: 'failure', caption: 'failed', openPermissions: ['p1'], waitingOnSibling: true }
    expect(settleDesk(desk)).toMatchObject({ status: 'waiting-on-you', caption: 'needs you', openPermissions: ['p1'] })
  })
  it('does not settle a desk that still has an open request', () => {
    const desk: Desk = { ...d(), status: 'success', caption: 'done', openPermissions: ['p1', 'p2'] }
    expect(settleDesk(desk)).toMatchObject({ status: 'waiting-on-you', caption: 'needs you', openPermissions: ['p1', 'p2'] })
  })
  it('returns an equal copy of any other desk', () => {
    const working = run(d(), f('session.text.delta'))
    const settled = settleDesk(working)
    expect(settled).toEqual(working)
    expect(settled).not.toBe(working)
  })
  it('never mutates the desk it was given', () => {
    const done = Object.freeze(run(d(), f('session.execution.succeeded')))
    expect(() => settleDesk(done)).not.toThrow()
    expect(done.status).toBe('success')
  })
})

describe('applyFrame — inbox members never drive the desk (owner ruling 2026-10-13)', () => {
  for (const t of ['session.inbox.enqueued', 'session.inbox.delivered', 'session.inbox.cancelled', 'session.inbox.delivery.changed', 'session.inbox.something.new']) {
    it(`is a no-op for ${t}`, () => {
      const waiting = withSiblingWait(run(d(), f('session.execution.started')), true)
      expect(applyFrame(waiting, f(t))).toEqual(waiting)
    })
  }
})

describe('withSiblingWait — the wait for a running child, with §6.3 precedence', () => {
  it('shows waiting-on-worker over working', () => {
    const next = withSiblingWait(run(d(), f('session.execution.started')), true)
    expect([next.status, next.caption, next.waitingOnSibling]).toEqual(['waiting-on-worker', 'waiting on another worker', true])
  })
  it('returns to working when the wait ends', () => {
    const next = withSiblingWait(withSiblingWait(run(d(), f('session.execution.started')), true), false)
    expect([next.status, next.waitingOnSibling]).toEqual(['working', false])
  })
  it('never overrides needs-you; only records the flag', () => {
    const asked = run(d(), f('permission.asked', { id: 'p1' }))
    const next = withSiblingWait(asked, true)
    expect([next.status, next.waitingOnSibling]).toEqual(['waiting-on-you', true])
  })
  it('does not touch a held success, failure or idle desk', () => {
    for (const desk of [run(d(), f('session.execution.succeeded')), run(d(), f('session.execution.failed')), d()]) {
      const next = withSiblingWait(desk, true)
      expect(next.status).toBe(desk.status)
      expect(next.waitingOnSibling).toBe(true)
    }
  })
  it('returns the same desk when nothing changes, and never mutates', () => {
    const desk = run(d(), f('session.execution.started'))
    const snap = JSON.stringify(desk)
    expect(withSiblingWait(desk, false)).toBe(desk)
    withSiblingWait(desk, true)
    expect(JSON.stringify(desk)).toBe(snap)
  })
})

describe('applyFrame — compaction captions', () => {
  it('captions compaction.delta as compacting', () => {
    expect(applyFrame(d(), f('session.compaction.delta')).caption).toBe('compacting')
  })
  it('stops captioning compacting once compaction ends', () => {
    const next = run(d(), f('session.compaction.started'), f('session.compaction.ended'))
    expect(next).toMatchObject({ status: 'working', caption: 'working' })
  })
  it('stops captioning compacting when compaction fails', () => {
    const next = run(d(), f('session.compaction.started'), f('session.compaction.failed'))
    expect(next).toMatchObject({ status: 'working', caption: 'working' })
  })
})

describe('applyFrame — interrupted by shutdown is not a failure', () => {
  it('goes idle on execution.interrupted with reason shutdown', () => {
    const next = run(d(), f('session.execution.started'), f('session.execution.interrupted', { reason: 'shutdown' }))
    expect(next).toMatchObject({ status: 'idle', caption: '' })
  })
  it('still treats other interruption reasons as failure', () => {
    const next = applyFrame(d(), f('session.execution.interrupted', { reason: 'user' }))
    expect(next).toMatchObject({ status: 'failure', caption: 'interrupted' })
  })
})

// tests/state/desk-review.test.ts — review fixes 3-6 to the reducer
import { describe, it, expect } from 'vitest'
import { createDesk, applyFrame, settleDesk, type Desk } from '../../src/state/desk'

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

describe('applyFrame — only inbox.enqueued starts a sibling wait', () => {
  it('does not flip a working desk on session.inbox.delivery.changed', () => {
    const working = run(d(), f('session.text.delta'))
    const next = applyFrame(working, f('session.inbox.delivery.changed'))
    expect(next).toEqual(working)
  })
  it('leaves an existing wait alone on session.inbox.delivery.changed', () => {
    const waiting = run(d(), f('session.inbox.enqueued'))
    expect(applyFrame(waiting, f('session.inbox.delivery.changed'))).toEqual(waiting)
  })
  it('ignores unknown inbox members for the flag and status', () => {
    const idle = d()
    expect(applyFrame(idle, f('session.inbox.something.new'))).toEqual(idle)
  })
  it('clears the wait on session.inbox.cancelled', () => {
    const next = run(d(), f('session.inbox.enqueued'), f('session.inbox.cancelled'))
    expect(next.waitingOnSibling).toBe(false)
    expect(next.status).toBe('working')
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

// tests/state/desk.test.ts
import { describe, it, expect } from 'vitest'
import { createDesk, applyFrame, type Desk } from '../../src/state/desk'

const d = (): Desk => createDesk('s1')
const f = (type: string, data: unknown = {}) => ({ type, data })
const statusOf = (d: Desk) => d.status

describe('applyFrame — the spec table (§6.3)', () => {
  it('goes working on execution.started', () => {
    expect(statusOf(applyFrame(d(), f('session.execution.started')))).toBe('working')
  })
  it('goes working on a tool call', () => {
    expect(statusOf(applyFrame(d(), f('session.tool.called')))).toBe('working')
  })
  it('goes working on text deltas', () => {
    expect(statusOf(applyFrame(d(), f('session.text.delta')))).toBe('working')
  })
  it('captions compaction', () => {
    const next = applyFrame(d(), f('session.compaction.started'))
    expect(next.status).toBe('working')
    expect(next.caption).toBe('compacting')
  })
  it('goes waiting-on-you on permission.asked and records the id', () => {
    const next = applyFrame(d(), f('permission.asked', { requestID: 'p1' }))
    expect(next.status).toBe('waiting-on-you')
    expect(next.openPermission).toBe('p1')
  })
  it('goes waiting-on-worker on session.inbox events', () => {
    const next = applyFrame(d(), f('session.inbox.enqueued'))
    expect(next.status).toBe('waiting-on-worker')
    expect(next.waitingOnSibling).toBe(true)
  })
  it('holds success then the caller decides when to settle', () => {
    expect(statusOf(applyFrame(d(), f('session.execution.succeeded')))).toBe('success')
  })
  it('holds failure', () => {
    expect(statusOf(applyFrame(d(), f('session.execution.failed')))).toBe('failure')
  })
})

describe('applyFrame — precedence and clearing (§6.3)', () => {
  it('does not clear an open permission on a text delta', () => {
    const held = applyFrame(d(), f('permission.asked', { requestID: 'p1' }))
    expect(statusOf(applyFrame(held, f('session.text.delta')))).toBe('waiting-on-you')
  })
  it('does not clear an open permission on a completed execution', () => {
    const held = applyFrame(d(), f('permission.asked', { requestID: 'p1' }))
    expect(statusOf(applyFrame(held, f('session.execution.succeeded')))).toBe('waiting-on-you')
  })
  it('clears on permission.replied, whoever answered it', () => {
    const held = applyFrame(d(), f('permission.asked', { requestID: 'p1' }))
    const after = applyFrame(held, f('permission.replied', { requestID: 'p1' }))
    expect(after.status).toBe('working')
    expect(after.openPermission).toBeUndefined()
  })
  it('ignores a reply for a request it never saw asked', () => {
    const next = applyFrame(d(), f('permission.replied', { requestID: 'never' }))
    expect(next.status).toBe('idle')
  })
  it('shows needs-you over a sibling wait, and restores the wait afterwards', () => {
    const waiting = applyFrame(d(), f('session.inbox.enqueued'))
    const asked = applyFrame(waiting, f('permission.asked', { requestID: 'p1' }))
    expect(statusOf(asked)).toBe('waiting-on-you')
    const answered = applyFrame(asked, f('permission.replied', { requestID: 'p1' }))
    expect(statusOf(answered)).toBe('waiting-on-worker')
  })
  it('treats an unknown event type as a no-op', () => {
    const before = applyFrame(d(), f('session.execution.started'))
    expect(applyFrame(before, f('some.future.event'))).toEqual(before)
  })
  it('never mutates the desk it was given', () => {
    const before = applyFrame(d(), f('session.execution.started'))
    const snapshot = JSON.stringify(before)
    applyFrame(before, f('permission.asked', { requestID: 'p9' }))
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

// Shapes below are OpenCode v2's own event schemas, read from the installed build and
// confirmed against a live recording — not the plan's guesses. See the ledger rulings.
describe('applyFrame — the real stream', () => {
  it('reads permission.asked by its real id field, data.id', () => {
    const next = applyFrame(d(), f('permission.asked', { id: 'per_1', sessionID: 's1' }))
    expect(next.status).toBe('waiting-on-you')
    expect(next.openPermission).toBe('per_1')
    const after = applyFrame(next, f('permission.replied', { sessionID: 's1', requestID: 'per_1', reply: 'once' }))
    expect(after.status).toBe('working')
    expect(after.openPermission).toBeUndefined()
  })
  it('keeps the first request when a second is asked while one is open', () => {
    const one = applyFrame(d(), f('permission.asked', { id: 'p1' }))
    expect(applyFrame(one, f('permission.asked', { id: 'p2' })).openPermission).toBe('p1')
  })
  it('stays waiting-on-you when a different request is replied', () => {
    const held = applyFrame(d(), f('permission.asked', { id: 'p1' }))
    const next = applyFrame(held, f('permission.replied', { requestID: 'other' }))
    expect(next.status).toBe('waiting-on-you')
    expect(next.openPermission).toBe('p1')
  })
  it('treats form.created as needs-you, keyed by data.form.id', () => {
    const next = applyFrame(d(), f('form.created', { form: { id: 'frm_1', sessionID: 's1' } }))
    expect(next.status).toBe('waiting-on-you')
    expect(next.openPermission).toBe('frm_1')
  })
  it('clears a form on form.replied or form.cancelled', () => {
    const held = applyFrame(d(), f('form.created', { form: { id: 'frm_1', sessionID: 's1' } }))
    expect(applyFrame(held, f('form.replied', { id: 'frm_1', sessionID: 's1' })).status).toBe('working')
    expect(applyFrame(held, f('form.cancelled', { id: 'frm_1', sessionID: 's1' })).openPermission).toBeUndefined()
  })
  it('goes working on reasoning, which the spec table omits but the stream is mostly made of', () => {
    const next = applyFrame(d(), f('session.reasoning.delta'))
    expect(next.status).toBe('working')
    expect(next.caption).toBe('thinking')
  })
  it('captions a tool by the name on tool.input.started, which tool.called does not carry', () => {
    const named = applyFrame(d(), f('session.tool.input.started', { name: 'shell' }))
    expect(named.caption).toBe('shell')
    expect(applyFrame(named, f('session.tool.called', { id: 't1' })).caption).toBe('shell')
  })
  it('treats execution.interrupted as failure', () => {
    expect(statusOf(applyFrame(d(), f('session.execution.interrupted', { reason: 'user' })))).toBe('failure')
  })
  it('lets the next activity frame settle a held success', () => {
    const done = applyFrame(d(), f('session.execution.succeeded'))
    expect(statusOf(applyFrame(done, f('session.execution.started')))).toBe('working')
  })
  it('ends the sibling wait on session.inbox.delivered, so a later reply does not restore it', () => {
    const waiting = applyFrame(d(), f('session.inbox.enqueued'))
    const delivered = applyFrame(waiting, f('session.inbox.delivered'))
    expect(delivered.waitingOnSibling).toBe(false)
    const asked = applyFrame(delivered, f('permission.asked', { id: 'p1' }))
    expect(statusOf(applyFrame(asked, f('permission.replied', { requestID: 'p1' })))).toBe('working')
  })
  it('records a sibling wait that arrives while a permission is open, without showing it', () => {
    const asked = applyFrame(d(), f('permission.asked', { id: 'p1' }))
    const both = applyFrame(asked, f('session.inbox.enqueued'))
    expect(both.status).toBe('waiting-on-you')
    expect(both.waitingOnSibling).toBe(true)
  })
})

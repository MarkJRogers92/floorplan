// tests/state/registry.test.ts
import { describe, it, expect } from 'vitest'
import { ingest, ingestAll, desks } from '../../src/state/registry'
import { seedDesks } from '../../src/state/seed'

const F = (sessionID: string, type: string, data: unknown = {}) =>
  ({ type, data: { sessionID, ...(data as object) } })

describe('registry', () => {
  it('adds a desk on session.created', () => {
    const m = ingest(new Map(), F('a', 'session.created'))
    expect(desks(m).map(d => d.sessionID)).toEqual(['a'])
  })

  it('removes a desk on session.deleted', () => {
    const m = ingestAll(new Map(), [F('a', 'session.created'), F('a', 'session.deleted')])
    expect(desks(m)).toEqual([])
  })

  it('creates a desk for a session we never saw created — joining mid-stream', () => {
    const m = ingest(new Map(), F('joined-late', 'session.execution.started'))
    expect(desks(m).map(d => d.sessionID)).toEqual(['joined-late'])
  })

  it('routes a per-session event to the right desk only', () => {
    const m = ingestAll(new Map(), [
      F('a', 'session.created'), F('b', 'session.created'),
      F('b', 'session.execution.started'),
    ])
    expect(desks(m).find(d => d.sessionID === 'a')!.status).toBe('idle')
    expect(desks(m).find(d => d.sessionID === 'b')!.status).toBe('working')
  })

  it('does not resurrect a deleted session', () => {
    const m = ingestAll(new Map(), [
      F('a', 'session.created'), F('a', 'session.deleted'), F('a', 'session.execution.started'),
    ])
    expect(m.has('a')).toBe(false)
  })

  it('keeps the order sessions were first seen in', () => {
    const m = ingestAll(new Map(), [
      F('z', 'session.created'), F('a', 'session.created'), F('z', 'session.text.delta'),
    ])
    expect(desks(m).map(d => d.sessionID)).toEqual(['z', 'a'])
  })

  it('skips a frame with no session id', () => {
    const m = ingest(new Map(), { type: 'session.execution.started', data: {} })
    expect(desks(m)).toEqual([])
  })

  it('accepts a seeded map and keeps working from it', () => {
    const seeded = seedDesks([{ id: 'a' }], [{ requestID: 'p1', sessionID: 'a' }])
    const m = ingest(seeded, F('a', 'permission.replied', { requestID: 'p1' }))
    expect(desks(m)[0].status).toBe('working')
  })
})

describe('registry — the real stream', () => {
  it('routes form.created by data.form.sessionID, where OpenCode puts it', () => {
    const m = ingest(new Map(), { type: 'form.created', data: { form: { id: 'frm_1', sessionID: 'a' } } })
    expect(desks(m).map(d => [d.sessionID, d.status])).toEqual([['a', 'waiting-on-you']])
  })
  it('skips a frame with no session id even for a known type, such as server.connected', () => {
    expect(desks(ingest(new Map(), { type: 'server.connected', data: {} }))).toEqual([])
  })
  it('never mutates the map it was given', () => {
    const before = ingest(new Map(), F('a', 'session.created'))
    ingest(before, F('b', 'session.created'))
    expect([...before.keys()]).toEqual(['a'])
  })
})

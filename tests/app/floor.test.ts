// tests/app/floor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFloor } from '../../src/app/floor'

describe('createFloor', () => {
  it('starts empty and seeds from a snapshot', () => {
    const floor = createFloor()
    expect(floor.desks()).toEqual([])
    floor.setSnapshot([{ id: 'a' }], [])
    expect(floor.desks().map(d => d.sessionID)).toEqual(['a'])
  })

  it('applies live frames on top of a snapshot', () => {
    const floor = createFloor()
    floor.setSnapshot([{ id: 'a' }], [{ requestID: 'p1', sessionID: 'a' }])
    floor.push({ type: 'permission.replied', data: { sessionID: 'a', requestID: 'p1' } })
    expect(floor.desks()[0].status).toBe('working')
  })

  it('drops a desk the new snapshot does not mention', () => {
    const floor = createFloor()
    floor.setSnapshot([{ id: 'a' }], [])
    floor.push({ type: 'session.created', data: { sessionID: 'b' } })
    floor.setSnapshot([{ id: 'a' }], [])
    expect(floor.desks().map(d => d.sessionID)).toEqual(['a'])
  })

  it('keeps the position of desks that survive a re-snapshot', () => {
    const floor = createFloor()
    floor.setSnapshot([{ id: 'a' }, { id: 'b' }], [])
    floor.setSnapshot([{ id: 'b' }, { id: 'a' }], [])
    expect(floor.desks().map(d => d.sessionID)).toEqual(['a', 'b'])
  })

  it('shows a permission raised while we were disconnected', () => {
    const floor = createFloor()
    floor.setSnapshot([{ id: 'a' }], [])
    floor.setSnapshot([{ id: 'a' }], [{ requestID: 'p1', sessionID: 'a' }])
    expect(floor.desks()[0].status).toBe('waiting-on-you')
  })
})

describe('createFloor — terminal state hold', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('settles success back to idle after the hold', () => {
    const floor = createFloor()
    floor.setSnapshot([{ id: 'a' }], [])
    floor.push({ type: 'session.execution.succeeded', data: { sessionID: 'a' } })
    expect(floor.desks()[0].status).toBe('success')

    vi.advanceTimersByTime(3000)
    expect(floor.desks()[0].status).toBe('idle')
  })
})

// tests/state/seed.test.ts
import { describe, it, expect } from 'vitest'
import { seedDesks } from '../../src/state/seed'

describe('seedDesks', () => {
  it('creates an idle desk per session', () => {
    const m = seedDesks([{ id: 'a' }, { id: 'b' }], [])
    expect(m.size).toBe(2)
    expect(m.get('a')!.status).toBe('idle')
  })

  it('marks a session with an open permission as waiting-on-you — the case events cannot cover', () => {
    const m = seedDesks([{ id: 'a' }], [{ requestID: 'p1', sessionID: 'a' }])
    expect(m.get('a')!.status).toBe('waiting-on-you')
    expect(m.get('a')!.openPermissions).toEqual(['p1'])
  })

  it('records every request a session has, in snapshot order', () => {
    const m = seedDesks([{ id: 'a' }], [
      { requestID: 'p2', sessionID: 'a' },
      { requestID: 'p1', sessionID: 'a' },
    ])
    expect(m.get('a')!.openPermissions).toEqual(['p2', 'p1'])
  })

  it('ignores a permission whose session is not in the snapshot', () => {
    const m = seedDesks([{ id: 'a' }], [{ requestID: 'p1', sessionID: 'ghost' }])
    expect(m.size).toBe(1)
    expect(m.has('ghost')).toBe(false)
  })

  it('returns an empty map for an empty snapshot', () => {
    expect(seedDesks([], []).size).toBe(0)
  })
})

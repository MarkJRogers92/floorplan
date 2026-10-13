import { it, expect } from 'vitest'
import { scopeFromSnapshot, scopeFromFrame, learnSeriesScope, seriesKeyForRoot } from '../../src/narrative/scope'
import { createRollup, rollup, seedRollup } from '../../src/narrative/rollup'
import type { SessionInfo } from '../../src/narrative/types'

it('uses actual frame directory before created-data project fallback', () => {
  expect(scopeFromFrame({ type: 'session.created', location: { directory: '/fake/project' }, data: { projectID: 'p' } })).toBe('directory:/fake/project')
  expect(scopeFromFrame({ type: 'session.created', data: { location: { directory: '/fake/data' }, projectID: 'p' } })).toBe('directory:/fake/data')
  expect(scopeFromFrame({ type: 'session.created', data: { projectID: 'p' } })).toBe('project:p')
  expect(scopeFromFrame({ type: 'server.connected', data: {} })).toBeUndefined()
  expect(scopeFromSnapshot({ location: { directory: '/fake/snapshot' } })).toBe('directory:/fake/snapshot')
})
it('guest scope follows the root, never its unrelated local desk directory', () => {
  const sessions: SessionInfo[] = [{ id: 'root', seriesKey: 'directory:/fake/root' },
    { id: 'kid', parentID: 'root', seriesKey: 'directory:/fake/guest' }]
  expect(seriesKeyForRoot('kid', sessions)).toBe('directory:/fake/root')
  expect(seriesKeyForRoot('missing', sessions)).toBeUndefined()
  expect(seriesKeyForRoot('kid', [{ id: 'root' }, sessions[1]])).toBeUndefined()
})
it('learns a directory and never downgrades it to a project ID', () => {
  const original = new Map<string, SessionInfo>([['root', { id: 'root', seriesKey: 'project:p' }]])
  const next = learnSeriesScope(original, { type: 'step.started', data: { sessionID: 'root' }, location: { directory: '/fake/project' } })
  expect(next.get('root')?.seriesKey).toBe('directory:/fake/project')
  expect(original.get('root')?.seriesKey).toBe('project:p')
  const again = learnSeriesScope(next, { type: 'session.created', data: { sessionID: 'root', projectID: 'p' } })
  expect(again).toBe(next)
})
it('rollup retains real project identity from creation and snapshot reseeding', () => {
  const result = rollup(createRollup(), { id: 'a', type: 'session.created', location: { directory: '/fake/project' }, data: { sessionID: 'root', agent: 'build' } })
  expect(result.state.sessions.get('root')?.seriesKey).toBe('directory:/fake/project')
  const reseeded = seedRollup(result.state, { sessions: [{ id: 'root', seriesKey: 'project:p' }], permissions: [] })
  expect(reseeded.sessions.get('root')?.seriesKey).toBe('directory:/fake/project')
})

import { it, expect } from 'vitest'
import { parseRecap } from '../../src/narrative/recap'

const key = 'directory:/synthetic/recap'
const base = { key, rootSessionID: 'current', before: 1000, coverage: 'partial', moments: [] }
it('refuses invalid requested scope, root or cutoff even for an empty recap', () => {
  for (const before of [0, -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(parseRecap({ ...base, before }, key, 'current', before)).toBeUndefined()
  }
  expect(parseRecap({ ...base, key: 'invalid' }, 'invalid', 'current', 1000)).toBeUndefined()
  expect(parseRecap({ ...base, rootSessionID: '' }, key, '', 1000)).toBeUndefined()
})
it('opaque paired refs cannot collide through a separator inside an ID', () => {
  const moment = (root: string, id: string) => ({ episodeID: `ep:${root}`, session: { id: root, agent: 'build' },
    beat: { id, sessionID: root, at: 100, endAt: 100, eventIDs: ['proof'], kind: 'wrap', detail: { kind: 'wrap' } } })
  const parsed = parseRecap({ ...base, moments: [moment('old', 'x\u0000y'), moment('old\u0000x', 'y')] }, key, 'current', 1000)
  expect(parsed?.moments).toHaveLength(2)
})

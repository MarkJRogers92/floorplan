import { it, expect } from 'vitest'
import { beatsForWork } from '../../src/app/work-scope'
import { createDirectorRuntime } from '../../src/narrative/director-runtime'
import type { Beat } from '../../src/narrative/types'

const sessions = new Map([['ses_a', { id: 'ses_a' }], ['ses_child', { id: 'ses_child', parentID: 'ses_a' }], ['ses_b', { id: 'ses_b' }]])
const beat = (sessionID: string, i: number): Beat => ({ id: `${sessionID}:${i}`, sessionID, at: i + 1, endAt: i + 1,
  eventIDs: [`event:${sessionID}:${i}`], kind: 'uses-tool', detail: { kind: 'uses-tool', tool: 'read' } })
it('selected live work contains its children but not hidden jobs; replay keeps its actual footage', () => {
  const beats = [beat('ses_a', 0), beat('ses_child', 1), beat('ses_b', 2)]
  expect(beatsForWork(beats, sessions, 'ses_a', false).map(b => b.sessionID)).toEqual(['ses_a', 'ses_child'])
  expect(beatsForWork(beats, sessions, 'ses_a', true)).toBe(beats)
  expect(beatsForWork(beats, sessions, '', false)).toBe(beats)
})
it('the Director receives only the selected job’s closed scene, never hidden-root footage', () => {
  const received: string[][] = []
  const director = createDirectorRuntime(async request => { received.push(request.beats.map(b => b.sessionID)); return { mode: 'templates' } }, () => {})
  const beats = [...Array.from({ length: 12 }, (_, i) => beat('ses_b', i)), ...Array.from({ length: 12 }, (_, i) => beat('ses_a', i))]
  director.setEnabled(true)
  director.update(beatsForWork(beats, sessions, 'ses_a', false), [...sessions.values()])
  expect(received).toEqual([Array(12).fill('ses_a')])
})

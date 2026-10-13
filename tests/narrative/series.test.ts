import { it, expect } from 'vitest'
import { parseArchivedEpisode, parseSeriesArchive, mergeEpisode, type ArchivedEpisode } from '../../src/narrative/series'

const episode = (ids = ['a']): ArchivedEpisode => ({ id: 'ep:root', rootSessionID: 'root', seriesKey: 'directory:/fake/project',
  sessions: [{ id: 'root', agent: 'build' }], beats: ids.map(id => ({ id, at: 0, endAt: 0, sessionID: 'root', eventIDs: [id], kind: 'wrap', detail: { kind: 'wrap' } })) })

it('validates actual archive shape and rejects unknown/corrupt/nonfinite data', () => {
  expect(parseArchivedEpisode(episode())).toEqual(episode())
  expect(parseArchivedEpisode({ ...episode(), id: 'ep:someone-else' })).toBeUndefined()
  expect(parseArchivedEpisode({ ...episode(), extra: 'raw credentials' })).toBeUndefined()
  expect(parseArchivedEpisode({ ...episode(), beats: [{ ...episode().beats[0], at: NaN }] })).toBeUndefined()
  expect(parseArchivedEpisode({ ...episode(), beats: [{ ...episode().beats[0], kind: 'invented' }] })).toBeUndefined()
  expect(parseArchivedEpisode({ ...episode(), sessions: [{ id: 'root', parentID: 'root' }] })).toBeUndefined()
})
it('partial saves retain older footage, append new IDs and do not mutate callers', () => {
  const old = episode(['a', 'b'])
  const next = episode(['b', 'c'])
  const merged = mergeEpisode(old, next)
  expect(merged.beats.map(b => b.id)).toEqual(['a', 'b', 'c'])
  expect(old.beats.map(b => b.id)).toEqual(['a', 'b'])
  expect(next.beats.map(b => b.id)).toEqual(['b', 'c'])
})
it('immutable beat conflicts and cross-project merges refuse rather than overwrite', () => {
  const changed = episode()
  changed.beats[0].at = 7
  expect(() => mergeEpisode(episode(), changed)).toThrow()
  expect(() => mergeEpisode(episode(), { ...episode(), seriesKey: 'directory:/other' })).toThrow()
})
it('JSON key order is not a factual beat conflict after hand-formatting an archive', () => {
  const reordered = episode()
  const b = reordered.beats[0]
  reordered.beats[0] = { detail: b.detail, kind: b.kind, eventIDs: b.eventIDs, sessionID: b.sessionID, endAt: b.endAt, at: b.at, id: b.id }
  expect(mergeEpisode(episode(), reordered).beats).toHaveLength(1)
})
it('new undefined metadata never erases a previously learned agent', () => {
  const next = { ...episode(['b']), sessions: [{ id: 'root', agent: undefined }] }
  expect(mergeEpisode(episode(), next).sessions[0].agent).toBe('build')
})
it('saved fictional personas require a real stored debut and safe text', () => {
  const archive = { version: 1, key: episode().seriesKey, episodes: [episode()], personas: [
    { agent: 'build', text: 'A weary foreman with a desperate need for order.', debut: { episodeID: 'ep:root', beatID: 'a' } },
  ] }
  expect(parseSeriesArchive(archive)).toEqual(archive)
  expect(parseSeriesArchive({ ...archive, personas: [{ ...archive.personas[0], debut: { episodeID: 'ep:root', beatID: 'missing' } }] })).toBeUndefined()
  expect(parseSeriesArchive({ ...archive, personas: [{ ...archive.personas[0], text: 'It failed twice.' }] })).toBeUndefined()
  expect(parseSeriesArchive({ ...archive, personas: [{ ...archive.personas[0], agent: 'explore' }] })).toBeUndefined()
  expect(parseSeriesArchive({ ...archive, episodes: [{ ...episode(), seriesKey: 'directory:/other' }] })).toBeUndefined()
})

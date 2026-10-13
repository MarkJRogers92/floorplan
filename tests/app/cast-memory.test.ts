import { it, expect } from 'vitest'
import { parseCastMemoryContext, castMemoryCards } from '../../src/app/cast-memory'
import type { Persona } from '../../src/narrative/series'

const KEY = 'directory:/synthetic/project'
const ROOT = 'sess-root'
const TEXT = 'A cautious archivist who hoards spare batteries.'
const persona = (agent: string, text = TEXT, episodeID = 'ep:sess-alpha', beatID = 'beat-1'): Persona =>
  ({ agent, text, debut: { episodeID, beatID } })

const valid = () => ({
  key: KEY,
  episodeCount: 3,
  bibles: [
    { agent: 'build', episodes: ['ep:sess-alpha'], tools: {}, thinks: { runs: 2, refs: [] } },
    { agent: 'review', episodes: [] },
  ],
  personas: [persona('build')],
})

it('projects only displayed fields from a valid context, dropping computed bible extras', () => {
  expect(parseCastMemoryContext(valid(), KEY, ROOT)).toEqual({
    key: KEY,
    episodeCount: 3,
    bibles: [
      { agent: 'build', episodes: ['ep:sess-alpha'] },
      { agent: 'review', episodes: [] },
    ],
    personas: [{ agent: 'build', text: TEXT, debut: { episodeID: 'ep:sess-alpha', beatID: 'beat-1' } }],
  })
})

it('rejects non-record, invalid key and mismatched key', () => {
  for (const bad of [undefined, null, 'x', 3, [], { ...valid(), key: 'nope' }, { ...valid(), key: undefined }]) {
    expect(parseCastMemoryContext(bad, KEY, ROOT)).toBeUndefined()
  }
  expect(parseCastMemoryContext({ ...valid(), key: 'not-a-scope' }, KEY, ROOT)).toBeUndefined()
})

it('rejects an invalid root', () => {
  expect(parseCastMemoryContext(valid(), KEY, '')).toBeUndefined()
  expect(parseCastMemoryContext(valid(), KEY, 'x'.repeat(257))).toBeUndefined()
})

it('rejects an invalid episode count', () => {
  for (const episodeCount of [-1, 1.5, NaN, Infinity, 2 ** 53, '3', undefined]) {
    expect(parseCastMemoryContext({ ...valid(), episodeCount }, KEY, ROOT)).toBeUndefined()
  }
})

it('rejects unidentified, duplicate and oversized bible/persona agents', () => {
  expect(parseCastMemoryContext({ ...valid(), bibles: [{ agent: 'unidentified', episodes: [] }] }, KEY, ROOT)).toBeUndefined()
  expect(parseCastMemoryContext({ ...valid(), bibles: [{ agent: 'build', episodes: [] }, { agent: 'build', episodes: [] }] }, KEY, ROOT)).toBeUndefined()
  expect(parseCastMemoryContext({ ...valid(), personas: [{ ...persona('unidentified') }] }, KEY, ROOT)).toBeUndefined()
  expect(parseCastMemoryContext({ ...valid(), personas: [persona('build'), persona('build')] }, KEY, ROOT)).toBeUndefined()
  const nine = Array.from({ length: 9 }, (_, i) => ({ agent: `agent-${i}`, episodes: [] }))
  expect(parseCastMemoryContext({ ...valid(), bibles: nine }, KEY, ROOT)).toBeUndefined()
  const ninePersonas = Array.from({ length: 9 }, (_, i) => persona(`agent-${i}`))
  expect(parseCastMemoryContext({ ...valid(), personas: ninePersonas }, KEY, ROOT)).toBeUndefined()
})

it('rejects non-episode, duplicate, current-root and oversized bible episodes', () => {
  expect(parseCastMemoryContext({ ...valid(), bibles: [{ agent: 'build', episodes: ['sess-alpha'] }] }, KEY, ROOT)).toBeUndefined()
  expect(parseCastMemoryContext({ ...valid(), bibles: [{ agent: 'build', episodes: ['ep:sess-alpha', 'ep:sess-alpha'] }] }, KEY, ROOT)).toBeUndefined()
  expect(parseCastMemoryContext({ ...valid(), bibles: [{ agent: 'build', episodes: [`ep:${ROOT}`] }] }, KEY, ROOT)).toBeUndefined()
  const many = Array.from({ length: 257 }, (_, i) => `ep:sess-${i}`)
  expect(parseCastMemoryContext({ ...valid(), bibles: [{ agent: 'build', episodes: many }] }, KEY, ROOT)).toBeUndefined()
})

it('rejects invalid persona text and debut references', () => {
  expect(parseCastMemoryContext({ ...valid(), personas: [persona('build', '')] }, KEY, ROOT)).toBeUndefined()
  expect(parseCastMemoryContext({ ...valid(), personas: [persona('build', 'has a 9 in it')] }, KEY, ROOT)).toBeUndefined()
  expect(parseCastMemoryContext({ ...valid(), personas: [persona('build', 'a'.repeat(161))] }, KEY, ROOT)).toBeUndefined()
  expect(parseCastMemoryContext({ ...valid(), personas: [{ agent: 'build', text: TEXT, debut: { episodeID: 'sess-alpha', beatID: 'beat-1' } }] }, KEY, ROOT)).toBeUndefined()
  expect(parseCastMemoryContext({ ...valid(), personas: [{ agent: 'build', text: TEXT, debut: { episodeID: 'ep:sess-alpha', beatID: '' } }] }, KEY, ROOT)).toBeUndefined()
})

it('allows a persona whose debut is in the current root', () => {
  const context = parseCastMemoryContext({ ...valid(), personas: [persona('newcomer', TEXT, `ep:${ROOT}`, 'beat-9')] }, KEY, ROOT)
  expect(context?.personas).toEqual([{ agent: 'newcomer', text: TEXT, debut: { episodeID: `ep:${ROOT}`, beatID: 'beat-9' } }])
})

it('returns no cards without a context', () => {
  expect(castMemoryCards(undefined, ['build'])).toEqual([])
})

it('keeps cast order, dedupes and omits unrelated, unidentified or empty rows', () => {
  const context = parseCastMemoryContext({
    key: KEY,
    episodeCount: 2,
    bibles: [
      { agent: 'build', episodes: ['ep:sess-alpha'] },
      { agent: 'review', episodes: ['ep:sess-beta'] },
      { agent: 'ghost', episodes: [] },
    ],
    personas: [persona('review', TEXT, 'ep:sess-beta', 'beat-7')],
  }, KEY, ROOT)
  const cards = castMemoryCards(context, ['review', 'build', 'review', 'outsider', 'unidentified', '', 'ghost'])
  expect(cards).toEqual([
    { agent: 'review', episodes: ['ep:sess-beta'], persona: { agent: 'review', text: TEXT, debut: { episodeID: 'ep:sess-beta', beatID: 'beat-7' } } },
    { agent: 'build', episodes: ['ep:sess-alpha'] },
  ])
})

it('caps the returned cards at eight', () => {
  const context = parseCastMemoryContext({
    key: KEY,
    episodeCount: 1,
    bibles: Array.from({ length: 8 }, (_, i) => ({ agent: `extra-${i}`, episodes: [`ep:sess-x${i}`] })),
    personas: [],
  }, KEY, ROOT)
  const many = castMemoryCards(context, ['extra-0', 'extra-1', 'extra-2', 'extra-3', 'extra-4', 'extra-5', 'extra-6', 'extra-7', 'extra-0'])
  expect(many.map(c => c.agent)).toEqual(['extra-0', 'extra-1', 'extra-2', 'extra-3', 'extra-4', 'extra-5', 'extra-6', 'extra-7'])
})

it('is deterministic for repeated calls', () => {
  const first = castMemoryCards(parseCastMemoryContext(valid(), KEY, ROOT), ['review', 'build', 'extra'])
  const second = castMemoryCards(parseCastMemoryContext(valid(), KEY, ROOT), ['review', 'build', 'extra'])
  expect(first).toEqual(second)
})

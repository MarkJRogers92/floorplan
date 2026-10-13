import { it, expect } from 'vitest'
import { assembleEpisodes } from '../../src/narrative/episode'
import { assembleScenes, type Scene } from '../../src/narrative/scene'
import type { Beat } from '../../src/narrative/types'

const scene = (id: string, rootSessionID = 'root', cast = ['plan']): Scene => ({
  id, rootSessionID, cast, location: { kind: 'desk', sessionID: rootSessionID }, beats: [`b:${id}`],
})

it('groups all scenes of one chat under a stable episode id', () => {
  expect(assembleEpisodes([scene('a'), scene('b')])).toEqual([{
    id: 'ep:root', rootSessionID: 'root', seriesID: '', cast: ['plan'], scenes: ['a', 'b'],
  }])
})
it('guest scenes join the parent chat and contribute their cast once', () => {
  expect(assembleEpisodes([scene('a'), scene('guest', 'root', ['build']), scene('guest-again', 'root', ['build'])])[0])
    .toMatchObject({ scenes: ['a', 'guest', 'guest-again'], cast: ['plan', 'build'] })
})
it('preserves first-seen episode order and scene order with interleaved roots', () => {
  expect(assembleEpisodes([scene('a', 'r1'), scene('b', 'r2'), scene('c', 'r1')]))
    .toMatchObject([{ id: 'ep:r1', scenes: ['a', 'c'] }, { id: 'ep:r2', scenes: ['b'] }])
})
it('a root wrap followed by a long resume gap remains one episode under D2', () => {
  const beats: Beat[] = [
    { id: 'w', kind: 'wrap', detail: { kind: 'wrap' }, at: 0, endAt: 0, sessionID: 'root', eventIDs: ['w'] },
    { id: 'ask', kind: 'human-asks', detail: { kind: 'human-asks' }, at: 86_400_000, endAt: 86_400_000, sessionID: 'root', eventIDs: ['ask'] },
  ]
  expect(assembleEpisodes(assembleScenes(beats, [{ id: 'root' }]))).toMatchObject([{ id: 'ep:root', scenes: ['scene:w', 'scene:ask'] }])
})
it('a second opener and an unfinished final scene do not disappear or become part two', () => {
  expect(assembleEpisodes([scene('opener'), scene('second-opener'), scene('unfinished')])[0].scenes)
    .toEqual(['opener', 'second-opener', 'unfinished'])
})
it('emits no empty episode', () => expect(assembleEpisodes([])).toEqual([]))
it('recomputation does not mutate inputs or share mutable episode arrays', () => {
  const input = [scene('a')]
  const first = assembleEpisodes(input)
  first[0].scenes.push('not-footage')
  first[0].cast.push('ghost')
  expect(assembleEpisodes(input)[0]).toMatchObject({ scenes: ['a'], cast: ['plan'] })
  expect(input[0].cast).toEqual(['plan'])
})

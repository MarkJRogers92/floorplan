import { describe, it, expect } from 'vitest'
import { assembleScenes } from '../../src/narrative/scene'
import type { Beat, BeatDetail } from '../../src/narrative/types'

const b = (id: string, detail: BeatDetail = { kind: 'wrap' }, sessionID = 'root', at = 0, endAt = at): Beat =>
  ({ id, kind: detail.kind, detail, sessionID, at, endAt, eventIDs: [id] })
const use = (id: string, sessionID = 'root', at = 0, endAt = at) =>
  b(id, { kind: 'uses-tool', tool: 'read' }, sessionID, at, endAt)
const sessions = [{ id: 'root', agent: 'plan' }, { id: 'kid', parentID: 'root', agent: 'build' }]

describe('scene boundaries', () => {
  it('root boundaries each start a new scene, including an ask after a wrap', () => {
    const scenes = assembleScenes([
      b('ask', { kind: 'human-asks' }), use('use'), b('wrap'), b('resume', { kind: 'human-asks' }),
    ], sessions)
    expect(scenes.map(s => s.beats)).toEqual([['ask', 'use'], ['wrap'], ['resume']])
  })
  it('a child wrap does not cut again at the same desk', () => {
    expect(assembleScenes([use('a', 'kid'), b('w', { kind: 'wrap' }, 'kid'), use('b', 'kid')], sessions)
      .map(s => s.beats)).toEqual([['a', 'w', 'b']])
  })
  it('arrival opens the guest desk, with its briefing adjacent and in order', () => {
    const beats = [use('a'), b('arrive', { kind: 'guest-arrives', childSessionID: 'kid' }, 'kid'),
      b('brief', { kind: 'briefing', childSessionID: 'kid' }, 'kid')]
    const scenes = assembleScenes(beats, sessions)
    expect(scenes.map(s => s.beats)).toEqual([['a'], ['arrive', 'brief']])
    expect(scenes[1]).toMatchObject({ location: { kind: 'desk', sessionID: 'kid' }, rootSessionID: 'root', cast: ['build'] })
  })
  it('departure cuts even at the same desk and includes the footage owner in the cast', () => {
    expect(assembleScenes([use('a', 'kid'), b('leave', { kind: 'guest-leaves', childSessionID: 'kid' })], sessions))
      .toMatchObject([{ beats: ['a'] }, { beats: ['leave'], location: { kind: 'desk', sessionID: 'kid' }, cast: ['plan', 'build'] }])
  })
  it('the thirteenth beat opens a continuation without dropping any beats', () => {
    const beats = Array.from({ length: 13 }, (_, i) => use(String(i)))
    expect(assembleScenes(beats, sessions).map(s => s.beats))
      .toEqual([['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'], ['12']])
  })
  it.each([89_999, 90_000, 91_000])('cuts at ninety seconds of event time: %s', time => {
    expect(assembleScenes([use('a'), use('b', 'root', time)], sessions).length).toBe(time < 90_000 ? 1 : 2)
  })
  it('uses a long run closing timestamp for the ninety-second cap', () => {
    expect(assembleScenes([use('a'), use('b', 'root', 1000, 91_000)], sessions).map(s => s.beats)).toEqual([['a'], ['b']])
  })
  it('cuts on a desk change instead of pretending two desks are one location', () => {
    expect(assembleScenes([use('a'), use('b', 'kid'), use('c')], sessions).map(s => s.beats))
      .toEqual([['a'], ['b'], ['c']])
  })
  it('interleaved roots never share a scene or cast suffix', () => {
    const scenes = assembleScenes([use('a', 'r1'), use('b', 'r2')], [{ id: 'r1', agent: 'build' }, { id: 'r2', agent: 'build' }])
    expect(scenes).toMatchObject([{ rootSessionID: 'r1', cast: ['build'] }, { rootSessionID: 'r2', cast: ['build'] }])
  })
})

it('walks ancestors and disambiguates same-agent guests within a chat', () => {
  const family = [{ id: 'root', agent: 'build' }, { id: 'kid', parentID: 'root', agent: 'build' },
    { id: 'grandkid', parentID: 'kid', agent: 'build' }]
  expect(assembleScenes([use('a', 'grandkid')], family)[0])
    .toMatchObject({ id: 'scene:a', rootSessionID: 'root', cast: ['build·3'] })
})

it('is deterministic, pure, and accepts empty or unknown-session footage', () => {
  const beats = [use('a', 'unknown')]
  expect(assembleScenes([], sessions)).toEqual([])
  expect(assembleScenes(beats, sessions)).toEqual(assembleScenes(beats, sessions))
  expect(assembleScenes(beats, sessions)[0]).toMatchObject({ rootSessionID: 'unknown', cast: ['unidentified'] })
  expect(beats[0].id).toBe('a')
})

it('does not loop on malformed parent cycles', () => {
  const scenes = assembleScenes([use('a', 'r1')], [{ id: 'r1', parentID: 'r2' }, { id: 'r2', parentID: 'r1' }])
  expect(scenes).toHaveLength(1)
})

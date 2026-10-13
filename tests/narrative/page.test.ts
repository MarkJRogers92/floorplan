import { describe, it, expect } from 'vitest'
import { readFrames } from '../../src/replay/replay'
import { createRollup, rollup, flush } from '../../src/narrative/rollup'
import { groupLinesByScene, assembleEpisodeViews } from '../../src/narrative/views'
import type { ScriptLine } from '../../src/narrative/script'
import type { Beat, BeatDetail } from '../../src/narrative/types'

const line = (id: string, beatIDs: string[]): ScriptLine => ({
  line: { id, speaker: 'narrator', template: 'It happened.', cites: beatIDs },
  text: id, delivery: 'narration', beatIDs,
})
const b = (id: string, detail: BeatDetail = { kind: 'wrap' }, at = 0, sessionID = 'root'): Beat =>
  ({ id, kind: detail.kind, detail, at, endAt: at, sessionID, eventIDs: [id] })

describe('groupLinesByScene', () => {
  it('groups each line once by its first cited beat in scene order', () => {
    const out = groupLinesByScene([{ id: 's1', beats: ['a'] }, { id: 's2', beats: ['b'] }],
      [line('second', ['b']), line('multi', ['a', 'b'])])
    expect(out.map(g => g.lines.map(l => l.text))).toEqual([['multi'], ['second']])
  })
  it('keeps orphaned lines in a visible ungrouped tail', () => {
    const out = groupLinesByScene([{ id: 's1', beats: ['a'] }], [line('orphan', ['missing'])])
    expect(out.flatMap(g => g.lines.map(l => l.text))).toEqual(['orphan'])
    expect(out.at(-1)?.scene).toBeUndefined()
  })
  it('returns fresh group and line arrays without mutating inputs', () => {
    const scenes = [{ id: 's1', beats: ['a'] }]
    const lines = [line('a', ['a'])]
    const first = groupLinesByScene(scenes, lines)
    first[0].lines.length = 0
    expect(groupLinesByScene(scenes, lines)[0].lines.map(l => l.text)).toEqual(['a'])
    expect(lines).toHaveLength(1)
  })
})

describe('episode views use the actual checker and rendering pipeline', () => {
  it('shows every episode and scene, not just the newest chat', () => {
    const beats = [b('a', { kind: 'human-asks' }, 0, 'r1'), b('b', { kind: 'human-asks' }, 1, 'r2'), b('c', { kind: 'wrap' }, 2, 'r1')]
    const views = assembleEpisodeViews(beats, [{ id: 'r1', agent: 'build' }, { id: 'r2', agent: 'build' }])
    expect(views.map(v => v.episode.id)).toEqual(['ep:r1', 'ep:r2'])
    expect(views.flatMap(v => v.scenes.flatMap(s => s.lines.map(l => l.beatIDs))))
      .toEqual([['a'], ['c'], ['b']])
    expect(views.map(v => v.heading.text)).toEqual(['Episode: build', 'Episode: build'])
    expect(views.flatMap(v => v.scenes.map(s => s.check.ok))).toEqual([true, true, true])
  })
  it('marks backdated run beats as visible flashbacks instead of reordering footage', () => {
    const beats = [b('a', { kind: 'uses-tool', tool: 'read' }, 3000),
      b('run', { kind: 'thinks', deltas: 0 }, 1000)]
    const group = assembleEpisodeViews(beats, [{ id: 'root', agent: 'build' }])[0].scenes[0]
    expect(group.lines.map(l => l.beatIDs)).toEqual([['a'], ['run']])
    expect(group.lines[1].line.flashback).toBe(true)
    expect(group.check.ok).toBe(true)
  })
  it('recomputes a previously unidentified cast when the stream names it', () => {
    const beats = [b('say', { kind: 'says', deltas: 1, text: 'Hello.' })]
    expect(assembleEpisodeViews(beats, [{ id: 'root' }])[0].scenes[0].lines[0].line.speaker).toBe('unidentified')
    expect(assembleEpisodeViews(beats, [{ id: 'root', agent: 'build' }])[0].scenes[0].lines[0].line.speaker).toBe('build')
  })
  it('the guest-departure heading names the child desk, not the caller', () => {
    const beat = b('leave', { kind: 'guest-leaves', childSessionID: 'kid' })
    const child = b('child', { kind: 'briefing', childSessionID: 'kid' }, 0, 'kid')
    const views = assembleEpisodeViews([child, beat], [{ id: 'root', agent: 'plan' }, { id: 'kid', parentID: 'root', agent: 'build' }])
    expect(views[0].scenes[1].heading.text).toBe('build')
    expect(views[0].scenes[1].heading.beatIDs).toEqual(['child'])
  })
  it('real golden footage loses no beats or critical moments through scene regrouping', () => {
    let state = createRollup()
    const beats: Beat[] = []
    for (const frame of readFrames('fixtures/narrative/four-events.jsonl')) {
      const result = rollup(state, frame)
      state = result.state
      beats.push(...result.beats)
      const partial = assembleEpisodeViews(beats, [...state.sessions.values()])
      expect(partial.flatMap(v => v.scenes.flatMap(s => s.lines.flatMap(l => l.beatIDs))).length).toBe(beats.length)
    }
    beats.push(...flush(state))
    const views = assembleEpisodeViews(beats, [...state.sessions.values()])
    expect(views).toHaveLength(1)
    const groups = views.flatMap(v => v.scenes)
    expect(groups.every(g => g.check.ok)).toBe(true)
    expect(groups.flatMap(g => g.lines.flatMap(l => l.beatIDs))).toEqual(beats.map(b => b.id))
    expect(groups.flatMap(g => g.lines.map(l => l.text)).join('\n')).toContain('forty seconds')
  })
})

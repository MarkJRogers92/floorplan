import { describe, it, expect } from 'vitest'
import { checkScene } from '../../src/narrative/check'
import { renderLine, type Line } from '../../src/narrative/line'
import { assembleScript } from '../../src/narrative/script'
import type { Scene } from '../../src/narrative/scene'
import type { Beat, BeatDetail } from '../../src/narrative/types'

const b = (id: string, at = 0, sessionID = 'root', detail: BeatDetail = { kind: 'wrap' }): Beat =>
  ({ id, at, endAt: at, sessionID, kind: detail.kind, detail, eventIDs: [id] })
const l = (id: string, cites: string[], speaker = 'narrator', template = 'It happened.'): Line => ({ id, cites, speaker, template })
const sceneOf = (beats: Beat[], cast = ['plan', 'build']): Scene => ({
  id: 'scene', rootSessionID: 'root', location: { kind: 'desk', sessionID: 'root' }, cast, beats: beats.map(b => b.id),
})
const ctxOf = (beats: Beat[]) => ({
  beats: new Map(beats.map(b => [b.id, b])), agents: new Map<string, string | undefined>([['root', 'plan'], ['kid', 'build']]),
  episodeBeatIDs: new Set(beats.map(b => b.id)),
})
const check = (beats: Beat[], lines: Line[], cast?: string[]) => checkScene(sceneOf(beats, cast), lines, ctxOf(beats))

describe('scene evidence checks', () => {
  it('passes honest template-only composition', () => {
    const beats = [b('a'), b('b', 1000)]
    const ctx = { cast: () => 'plan', beats }
    expect(check(beats, assembleScript(beats, ctx).map(s => s.line))).toEqual({ ok: true, failures: [] })
  })
  it('rejects a speaker who does not match every cited session', () => {
    expect(check([b('a')], [l('l', ['a'], 'build')]).failures).toContain('l: speaker does not match footage')
  })
  it('accepts unidentified and rejects a guessed agent for unknown footage', () => {
    const beats = [b('a', 0, 'unknown')]
    expect(check(beats, [l('l', ['a'], 'unidentified')], ['unidentified']).ok).toBe(true)
    expect(check(beats, [l('l', ['a'], 'plan')]).ok).toBe(false)
  })
  it('checks resolved cast ids including duplicate-agent suffixes', () => {
    const beats = [b('a', 0, 'kid')]
    const ctx = ctxOf(beats)
    ctx.agents.set('kid', 'build·2')
    expect(checkScene(sceneOf(beats, ['build·2']), [l('l', ['a'], 'build·2')], ctx).ok).toBe(true)
    expect(checkScene(sceneOf(beats, ['build·2']), [l('l', ['a'], 'build')], ctx).ok).toBe(false)
  })
  it('rejects agent slots that conflate actors even when each slot renders', () => {
    const beats = [b('a'), b('b', 1000, 'kid')]
    const line = l('l', ['a', 'b'], 'narrator', '{agent:a} watched.')
    const ctx = ctxOf(beats)
    expect(renderLine(line, ctx.beats, { beats, cast: id => ctx.agents.get(id) ?? 'unidentified' })).toHaveProperty('text')
    expect(check(beats, [line]).failures).toContain('l: agent slot does not match footage')
  })
  it('rejects cites outside the episode even when they exist in the evidence map', () => {
    const beats = [b('a'), b('other')]
    const ctx = ctxOf(beats)
    ctx.episodeBeatIDs.delete('other')
    expect(checkScene(sceneOf([beats[0]]), [l('l', ['other'])], ctx).ok).toBe(false)
  })
  it('rejects missing evidence and empty cites without throwing', () => {
    expect(check([b('a')], [l('l', ['missing'])]).ok).toBe(false)
    expect(check([b('a')], [l('l', [])]).ok).toBe(false)
    expect(checkScene(sceneOf([b('missing')]), [], ctxOf([])).ok).toBe(false)
  })
  it('uses the latest cited beat as the anchor, not the first cite', () => {
    const beats = [b('a', 0), b('b', 1000), b('c', 2000)]
    expect(check(beats, [l('multi', ['a', 'c']), l('backwards', ['b'])]).ok).toBe(false)
  })
  it('permits an explicit flashback but does not lower the present-time watermark', () => {
    const beats = [b('a', 0), b('b', 1000), b('c', 2000)]
    const lines: Line[] = [l('now', ['c']), { ...l('flash', ['a']), flashback: true }]
    expect(check(beats, lines).ok).toBe(true)
    expect(check(beats, [...lines, l('unmarked', ['b'])]).ok).toBe(false)
  })
  it.each<BeatDetail>([
    { kind: 'tool-fails', tool: 'shell', exit: 2 }, { kind: 'cut', reason: 'interrupted' }, { kind: 'knocks', requestID: 'p' },
  ])('rejects buried $kind and accepts its surviving narration', detail => {
    const beats = [b('ordinary'), b('critical', 1000, 'root', detail)]
    expect(check(beats, [l('l', ['ordinary'])]).ok).toBe(false)
    expect(check(beats, [l('l', ['ordinary']), l('critical', ['critical'])]).ok).toBe(true)
  })
  it('requires a speaking character to have footage in the scene, not just in the episode', () => {
    const beats = [b('a'), b('guest', 1000, 'kid')]
    expect(checkScene(sceneOf([beats[0]], ['plan', 'build']), [l('l', ['guest'], 'build')], ctxOf(beats)).ok).toBe(false)
  })
})

it('checks a real-slot cold-open excerpt with seven shells, two edits, two writes and a real quote', () => {
  const beats = [b('arrive', 0, 'kid', { kind: 'guest-arrives', childSessionID: 'kid' }),
    b('brief', 1000, 'kid', { kind: 'briefing', childSessionID: 'kid' })]
  for (const [i, tool] of ['shell', 'shell', 'shell', 'shell', 'shell', 'shell', 'shell', 'edit', 'edit', 'write', 'write'].entries()) {
    beats.push(b(`t${i}`, (i + 2) * 1000, 'kid', { kind: 'uses-tool', tool }))
  }
  beats.push(b('say', 13_000, 'kid', { kind: 'says', deltas: 1, text: 'This is fine.' }), b('wrap', 14_000, 'kid'))
  const lines = [l('arrive', ['arrive', 'brief'], 'narrator', 'A temp arrives. {agent:arrive} has been briefed.'),
    l('counts', beats.slice(2, 13).map(b => b.id), 'narrator', '{count:shell,t0..t10}, {count:edit,t0..t10}, {count:write,t0..t10}.'),
    l('quote', ['say'], 'build', '{quote:say}'), l('wrap', ['wrap'], 'narrator', 'It reports back.')]
  const ctx = ctxOf(beats)
  const rendered = lines.map(line => renderLine(line, ctx.beats, { beats, cast: () => 'build' }))
  expect(rendered).toEqual([
    { text: 'A temp arrives. build has been briefed.', delivery: 'narration' },
    { text: '7, 2, 2.', delivery: 'narration' },
    { text: 'This is fine.', delivery: 'real-speech' }, { text: 'It reports back.', delivery: 'narration' },
  ])
  expect(checkScene(sceneOf(beats, ['build']), lines, ctx)).toEqual({ ok: true, failures: [] })
})

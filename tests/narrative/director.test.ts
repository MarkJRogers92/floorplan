import { describe, it, expect } from 'vitest'
import { checkDirectorLines } from '../../src/narrative/director'
import type { Beat, BeatDetail } from '../../src/narrative/types'
import type { Scene } from '../../src/narrative/scene'

const b = (id: string, at: number, detail: BeatDetail): Beat =>
  ({ id, at, endAt: at, sessionID: 'root', eventIDs: [id], kind: detail.kind, detail })
const beats = [b('a', 0, { kind: 'uses-tool', tool: 'read' }), b('b', 1000, { kind: 'tool-fails', tool: 'shell', exit: 3 })]
const scene: Scene = { id: 'scene:a', rootSessionID: 'root', location: { kind: 'desk', sessionID: 'root' }, cast: ['build'], beats: ['a', 'b'] }
const sessions = [{ id: 'root', agent: 'build' }]
const line = (template: string, cites = ['a', 'b'], speaker = 'narrator', flashback = false) => ({ template, cites, speaker, flashback })
const check = (lines: unknown, evidence = beats) => checkDirectorLines({ ...scene, beats: evidence.map(b => b.id) }, { lines }, evidence, sessions)

describe('Director output is evidence-bound', () => {
  it('accepts a condensed scene without inventing work', () => {
    const result = check([line('A monument to office morale. {outcome:b}.')])
    expect(result.mode).toBe('director')
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].text).toBe('A monument to office morale. exit 3.')
    expect(result.lines[0].line.id).toBe('director:scene:a:0')
  })
  it.each([undefined, null, 'bad', {}, { lines: [] }, { lines: Array(25).fill(line('Fine.')) }])
    ('malformed output falls back to complete templates: %j', output => {
      const result = checkDirectorLines(scene, output, beats, sessions)
      expect(result.mode).toBe('templates')
      expect(result.lines.flatMap(l => l.beatIDs)).toEqual(['a', 'b'])
    })
  it('drops an unsupported joke but independently fills its cited beats', () => {
    const result = check([line('It ran twice.', ['a']), line('The result was {outcome:b}.', ['b'])])
    expect(result.mode).toBe('director')
    expect(result.lines.map(l => l.text)).toEqual(['build pointed read.', 'The result was exit 3.'])
    expect(result.lines.flatMap(l => l.beatIDs)).toEqual(['a', 'b'])
  })
  it('missing ordinary and failure footage stays narrated', () => {
    const result = check([line('Existence is paperwork.', ['a'])])
    expect(result.lines.flatMap(l => l.beatIDs)).toEqual(['a', 'b'])
    expect(result.lines[1].text).toContain('exit 3')
  })
  it.each([
    line('Unrelated.', ['another-episode']), line('I belong here.', ['a'], 'explore'),
    line('{never:wrap}', ['a']), line('{first:read,a}', ['a']), line('The result succeeded.', ['b']),
  ])('false cite, actor or episode-wide claims cannot survive: %j', candidate => {
    const result = check([candidate])
    expect(result.mode).toBe('templates')
    expect(result.lines.flatMap(l => l.beatIDs)).toEqual(['a', 'b'])
  })
  it('guards dynamic tool/agent/model names outside slots', () => {
    const evidence = [b('a', 0, { kind: 'uses-tool', tool: 'warp_drive' })]
    const result = check([line('warp_drive is exhausted.', ['a'])], evidence)
    expect(result.mode).toBe('templates')
    expect(result.lines[0].text).toContain('warp_drive')
  })
  it('returns verbatim quotes as real speech, not invented dialogue', () => {
    const evidence = [b('a', 0, { kind: 'says', deltas: 1, text: 'This is fine.' })]
    expect(check([line('{quote:a}', ['a'], 'build')], evidence).lines[0])
      .toMatchObject({ text: 'This is fine.', delivery: 'real-speech' })
  })
  it('rejects unmarked reverse order, permits an explicit flashback', () => {
    const reversed = [line('A bleak result.', ['b']), line('A hopeful beginning.', ['a'])]
    expect(check(reversed).mode).toBe('templates')
    expect(check([reversed[0], { ...reversed[1], flashback: true }]).mode).toBe('director')
  })
  it('template fallback marks backdated runs rather than reorder footage', () => {
    const evidence = [b('a', 3000, { kind: 'uses-tool', tool: 'read' }), b('b', 1000, { kind: 'thinks', deltas: 0 })]
    const result = check([], evidence)
    expect(result.lines.map(l => l.beatIDs)).toEqual([['a'], ['b']])
    expect(result.lines[1].line.flashback).toBe(true)
  })
})

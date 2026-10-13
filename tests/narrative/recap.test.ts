import { describe, expect, it } from 'vitest'
import {
  MAX_MOMENT_BYTES, MAX_RECAP_BYTES, MAX_RECAP_MOMENTS, MAX_RECAP_TEXT,
  buildRecap, parseRecap, recapLines, type Recap,
} from '../../src/narrative/recap'
import type { ArchivedEpisode, SeriesArchive } from '../../src/narrative/series'
import type { Beat, BeatDetail, BeatKind } from '../../src/narrative/types'

const KEY = 'directory:/synthetic/project'
const LIVE = 'live-root'
const UNKNOWN = undefined as unknown as number

const beat = (id: string, kind: BeatKind, at: number, endAt: number, sessionID = 'root1',
  detail: BeatDetail = { kind } as unknown as BeatDetail): Beat => ({ id, at, endAt, eventIDs: [id], kind, sessionID, detail })

const says = (id: string, text: string, at = 10, sessionID = 'root1'): Beat =>
  beat(id, 'says', at, at, sessionID, { kind: 'says', deltas: 1, text })

/** `agent === null` is the wire's missing actor: an unknown name, never a guess. */
const episode = (root: string, beats: Beat[], agent: string | null = 'build'): ArchivedEpisode =>
  ({ id: `ep:${root}`, rootSessionID: root, seriesKey: KEY, sessions: [agent === null ? { id: root } : { id: root, agent }], beats })

const archive = (...episodes: ArchivedEpisode[]): SeriesArchive => ({ version: 1, key: KEY, episodes, personas: [] })

const refs = (recap: Recap): string[] => recap.moments.map(m => `${m.episodeID}/${m.beat.id}`)

/** A run's packet, not its quote: big enough to break the proof byte cap without long text. */
const bulky = (count: number): Beat => ({
  id: 'b:bulk', at: 20, endAt: 20, eventIDs: Array.from({ length: count }, (_, i) => `e:${i}:${'x'.repeat(48)}`),
  kind: 'wrap', sessionID: 'root1', detail: { kind: 'wrap' },
})

describe('buildRecap', () => {
  it('montages the newest episodes oldest-first, one strongest moment each, third from what remains', () => {
    const old = episode('root1', [says('b:say', 'It is quiet.', 10), beat('b:fail', 'tool-fails', 20, 20, 'root1', { kind: 'tool-fails', tool: 'bash' })])
    const newer = episode('root2', [beat('b:wrap', 'wrap', 30, 30, 'root2')])
    const recap = buildRecap(archive(old, newer), LIVE, 100)
    expect(recap).toEqual({
      key: KEY, rootSessionID: LIVE, before: 100, coverage: 'partial',
      moments: [
        { episodeID: 'ep:root1', beat: old.beats[0], session: { id: 'root1', agent: 'build' } },
        { episodeID: 'ep:root1', beat: old.beats[1], session: { id: 'root1', agent: 'build' } },
        { episodeID: 'ep:root2', beat: newer.beats[0], session: { id: 'root2', agent: 'build' } },
      ],
    })
    expect(refs(recap)).toEqual(['ep:root1/b:say', 'ep:root1/b:fail', 'ep:root2/b:wrap'])
  })

  it('keeps archived beat order inside an episode rather than clock order or highlight order', () => {
    const recap = buildRecap(archive(episode('root1', [beat('b:wrap', 'wrap', 30, 30), says('b:say', 'Later words.', 10)])), LIVE, 100)
    expect(refs(recap)).toEqual(['ep:root1/b:wrap', 'ep:root1/b:say'])
  })

  it('lets one eligible episode fill the montage, strongest first, capped at three moments', () => {
    const recap = buildRecap(archive(episode('root1', [
      says('b:say', 'words', 10),
      beat('b:wrap', 'wrap', 20, 20),
      beat('b:use', 'uses-tool', 30, 30, 'root1', { kind: 'uses-tool', tool: 'read' }),
      beat('b:fail', 'tool-fails', 40, 40, 'root1', { kind: 'tool-fails', tool: 'bash' }),
    ])), LIVE, 100)
    expect(recap.moments).toHaveLength(MAX_RECAP_MOMENTS)
    expect(refs(recap)).toEqual(['ep:root1/b:say', 'ep:root1/b:wrap', 'ep:root1/b:fail'])
  })

  it('never lets a third episode in, however strong its leftover beat', () => {
    const quiet = episode('rootA', [beat('b:quiet', 'memory-wipe', 5, 5, 'rootA')])
    const newest = episode('rootB', [beat('b:new', 'wrap', 50, 50, 'rootB')])
    const middle = episode('rootC', [beat('b:mid', 'retry', 40, 40, 'rootC', { kind: 'retry', attempt: 1 })])
    expect(refs(buildRecap(archive(quiet, newest, middle), LIVE, 100))).toEqual(['ep:rootC/b:mid', 'ep:rootB/b:new'])
  })

  it('breaks recency and highlight ties by first-seen archive order', () => {
    const a = episode('rootA', [beat('b:a1', 'wrap', 20, 20, 'rootA')])
    const b = episode('rootB', [beat('b:b1', 'knocks', 20, 20, 'rootB', { kind: 'knocks', requestID: 'r1' })])
    const c = episode('rootC', [beat('b:c1', 'cut', 20, 20, 'rootC', { kind: 'cut', reason: 'interrupted' })])
    expect(refs(buildRecap(archive(a, b, c), LIVE, 100))).toEqual(['ep:rootA/b:a1', 'ep:rootB/b:b1'])
    const tied = episode('root1', [beat('b:first', 'says', 30, 30), beat('b:second', 'says', 30, 30)])
    expect(refs(buildRecap(archive(tied), LIVE, 100))).toEqual(['ep:root1/b:first', 'ep:root1/b:second'])
  })

  it('never guesses unknown, nonpositive, inverted, equal or future timings', () => {
    const recap = buildRecap(archive(episode('root1', [
      beat('b:nan', 'wrap', UNKNOWN, UNKNOWN),
      beat('b:undefined', 'wrap', UNKNOWN, UNKNOWN),
      beat('b:inverted', 'wrap', 30, 10),
      beat('b:zero', 'wrap', 0, 0),
      beat('b:negative', 'wrap', -5, -1),
      beat('b:equal', 'wrap', 60, 60),
      beat('b:future', 'wrap', 70, 80),
      beat('b:thinks', 'thinks', 10, 10, 'root1', { kind: 'thinks', deltas: 2 }),
      beat('b:silence', 'silence', 10, 10, 'root1', { kind: 'silence', fromEventID: 'e1', toEventID: 'e2', ms: 5000 }),
      beat('b:opens', 'episode-opens', 10, 10),
      beat('b:asks', 'human-asks', 10, 10),
    ])), LIVE, 60)
    expect(recap.moments).toEqual([])
    const edge = episode('root1', [beat('b:older', 'retry', 89, 89, 'root1', { kind: 'retry', attempt: 2 }), beat('b:now', 'wrap', 90, 90)])
    expect(refs(buildRecap(archive(edge), LIVE, 90))).toEqual(['ep:root1/b:older'])
  })

  it('selects nothing for a clock it cannot trust', () => {
    const ep = episode('root1', [beat('b:wrap', 'wrap', 10, 10)])
    for (const before of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildRecap(archive(ep), LIVE, before).moments).toEqual([])
    }
  })

  it('excludes the current root, rejoins, foreign projects and malformed episode refs', () => {
    const live = episode('live-root', [beat('b:live', 'tool-fails', 90, 90, 'live-root', { kind: 'tool-fails', tool: 'bash' })])
    const foreign = { ...episode('root2', [beat('b:foreign', 'wrap', 70, 70, 'root2')]), seriesKey: 'directory:/other' }
    const mislabelled = { ...episode('root3', [beat('b:mislabelled', 'wrap', 60, 60, 'root3')]), id: 'ep:elsewhere' }
    const older = episode('root1', [beat('b:old', 'wrap', 10, 10, 'root1')])
    const recap = buildRecap(archive(live, foreign, mislabelled, older), 'live-root', 100)
    expect(refs(recap)).toEqual(['ep:root1/b:old'])
    expect(recap.key).toBe(KEY)
  })

  it('keeps a raw stored actor name and leaves an unknown actor unidentified', () => {
    const silent = buildRecap(archive(episode('root1', [says('b:say', 'hello', 10)], null)), LIVE, 100)
    expect(silent.moments[0]!.session).toEqual({ id: 'root1' })
    expect(recapLines(silent)[0]!.speaker).toBe('unidentified')
    const named = buildRecap(archive(episode('root2', [says('b:say', 'hello', 20, 'root2')], 'scribe')), LIVE, 100)
    expect(named.moments[0]!.session).toEqual({ id: 'root2', agent: 'scribe' })
    expect(recapLines(named)[0]!.speaker).toBe('scribe')
  })

  it('keeps repeated beat IDs in different episodes independent, and parses back unchanged', () => {
    const one = episode('root1', [says('b:shared', 'alpha', 10, 'root1')], 'build')
    const two = episode('root2', [says('b:shared', 'beta', 20, 'root2')], 'scribe')
    const recap = buildRecap(archive(one, two), LIVE, 100)
    expect(refs(recap)).toEqual(['ep:root1/b:shared', 'ep:root2/b:shared'])
    expect(recapLines(recap).map(l => [l.ref.episodeID, l.ref.beatID, l.speaker, l.text])).toEqual([
      ['ep:root1', 'b:shared', 'build', 'alpha'],
      ['ep:root2', 'b:shared', 'scribe', 'beta'],
    ])
    expect(parseRecap(recap, KEY, LIVE, 100)).toEqual(recap)
  })

  it('omits oversize quotes and oversize proof packets instead of truncating them', () => {
    const quoted = episode('root1', [says('b:quote', 'x'.repeat(MAX_RECAP_TEXT + 1), 30), says('b:exact', 'y'.repeat(MAX_RECAP_TEXT), 10)])
    expect(refs(buildRecap(archive(quoted), LIVE, 100))).toEqual(['ep:root1/b:exact'])
    expect(recapLines(buildRecap(archive(quoted), LIVE, 100))[0]!.text).toHaveLength(MAX_RECAP_TEXT)
    expect(refs(buildRecap(archive(episode('root1', [bulky(300), says('b:thin', 'kept', 10)])), LIVE, 100))).toEqual(['ep:root1/b:thin'])
    const kept = buildRecap(archive(episode('root1', [bulky(100)])), LIVE, 100)
    expect(kept.moments).toHaveLength(1)
    expect(new TextEncoder().encode(JSON.stringify(kept.moments[0])).length).toBeLessThanOrEqual(MAX_MOMENT_BYTES)
    expect(MAX_RECAP_BYTES).toBeGreaterThanOrEqual(MAX_RECAP_MOMENTS * MAX_MOMENT_BYTES)
  })

  it('omits evidence that cannot be rendered rather than inventing a line for it', () => {
    const broken = { id: 'b:broken', at: 10, endAt: 10, eventIDs: ['b:broken'], kind: 'cut', sessionID: 'root1', detail: UNKNOWN } as unknown as Beat
    const recap = buildRecap(archive(episode('root1', [broken, says('b:ok', 'fine', 5)])), LIVE, 100)
    expect(refs(recap)).toEqual(['ep:root1/b:ok'])
  })
})

describe('parseRecap', () => {
  const valid = buildRecap(archive(episode('root1', [says('b:say', 'words', 10), beat('b:wrap', 'wrap', 20, 20)])), LIVE, 100)
  const moment = () => JSON.parse(JSON.stringify(valid.moments[0])) as Recap['moments'][number]
  const wrapMoment = (): Recap['moments'][number] => ({
    episodeID: 'ep:root1', beat: beat('b:wrap', 'wrap', 20, 20), session: { id: 'root1', agent: 'build' },
  })

  it('accepts its own montage, byte-for-byte through JSON', () => {
    expect(parseRecap(valid, KEY, LIVE, 100)).toEqual(valid)
    expect(parseRecap(JSON.parse(JSON.stringify(valid)), KEY, LIVE, 100)).toEqual(valid)
    const empty = { key: KEY, rootSessionID: LIVE, before: 100, coverage: 'partial', moments: [] }
    expect(parseRecap(empty, KEY, LIVE, 100)).toEqual(empty)
  })

  it('refuses foreign fields, including anything that reads as server-written story', () => {
    expect(parseRecap({ ...valid, story: 'Once upon a time' }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, moments: [{ ...moment(), text: 'invented narration' }] }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap(null, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap([valid], KEY, LIVE, 100)).toBeUndefined()
  })

  it('requires the partial label, the expected scope and cutoff, and the caps', () => {
    expect(parseRecap({ ...valid, coverage: 'complete' }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, coverage: undefined }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, moments: undefined }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap(valid, 'directory:/other', LIVE, 100)).toBeUndefined()
    expect(parseRecap(valid, KEY, 'other-root', 100)).toBeUndefined()
    expect(parseRecap(valid, KEY, LIVE, 99)).toBeUndefined()
    const three = buildRecap(archive(episode('root1', [says('b:s1', 'a', 10), says('b:s2', 'b', 20), says('b:s3', 'c', 30)])), LIVE, 100)
    expect(three.moments).toHaveLength(MAX_RECAP_MOMENTS)
    expect(parseRecap(three, KEY, LIVE, 100)).toEqual(three)
    expect(parseRecap({ ...three, moments: [moment(), moment(), moment(), moment()] }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...three, moments: three.moments.map((m, i) => ({ ...m, episodeID: `ep:root${i}` })) }, KEY, LIVE, 100)).toBeUndefined()
  })

  it('requires unique paired refs, an earlier different ep:<root>, and exact moment/session fields', () => {
    expect(parseRecap({ ...valid, moments: [moment(), moment()] }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, moments: [{ ...moment(), episodeID: `ep:${LIVE}` }] }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, moments: [{ ...moment(), episodeID: 'b:say' }] }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, moments: [{ ...moment(), episodeID: 'ep:' }] }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, moments: [{ ...moment(), extra: true }] }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, moments: [{ episodeID: 'ep:root1', beat: beat('b:wrap', 'wrap', 20, 20) }] }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, moments: [{ ...moment(), session: { id: 'root1', parentID: 'x' } }] }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, moments: [{ ...moment(), session: { id: 'someone-else' } }] }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, moments: [{ ...moment(), session: { id: 'root1', agent: 7 } }] }, KEY, LIVE, 100)).toBeUndefined()
  })

  it('requires single-beat evidence of an allowed kind with honest clocks', () => {
    const say = moment()
    expect(parseRecap({ ...valid, moments: [wrapMoment()] }, KEY, LIVE, 100)).toEqual({ ...valid, moments: [wrapMoment()] })
    const withBeat = (patch: Record<string, unknown>) => ({ ...valid, moments: [{ ...say, beat: { ...say.beat, ...patch } }] })
    expect(parseRecap(withBeat({ kind: 'thinks', detail: { kind: 'thinks', deltas: 2 } }), KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap(withBeat({ at: 0 }), KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap(withBeat({ endAt: 9 }), KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap(withBeat({ endAt: 100 }), KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap(withBeat({ endAt: 101 }), KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap(withBeat({ id: '' }), KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap(withBeat({ eventIDs: 'nope' }), KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap(withBeat({ extra: 1 }), KEY, LIVE, 100)).toBeUndefined()
  })

  it('refuses oversize quotes and oversize proof packets', () => {
    const say = moment()
    const longQuote = { ...valid, moments: [{ ...say, beat: { ...say.beat, detail: { kind: 'says', deltas: 1, text: 'x'.repeat(MAX_RECAP_TEXT + 1) } } }] }
    expect(parseRecap(longQuote, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, moments: [{ ...wrapMoment(), beat: bulky(300) }] }, KEY, LIVE, 100)).toBeUndefined()
    expect(parseRecap({ ...valid, moments: [{ ...wrapMoment(), beat: bulky(100) }] }, KEY, LIVE, 100)).toBeDefined()
  })
})

describe('recapLines', () => {
  it('holds a citation, speaker and delivery for every recomputed line', () => {
    const recap = buildRecap(archive(episode('root1', [
      says('b:say', 'Aloud.', 10),
      beat('b:fail', 'tool-fails', 20, 20, 'root1', { kind: 'tool-fails', tool: 'bash', exit: 1 }),
      beat('b:wrap', 'wrap', 30, 30, 'root1'),
    ])), LIVE, 100)
    expect(recapLines(recap)).toEqual([
      { ref: { episodeID: 'ep:root1', beatID: 'b:say' }, text: 'Aloud.', delivery: 'real-speech', speaker: 'build' },
      { ref: { episodeID: 'ep:root1', beatID: 'b:fail' }, text: 'build called bash; the result was exit 1.', delivery: 'narration', speaker: 'narrator' },
      { ref: { episodeID: 'ep:root1', beatID: 'b:wrap' }, text: 'The episode wrapped.', delivery: 'narration', speaker: 'narrator' },
    ])
  })

  it('renders from the moment evidence and never from a supplied story', () => {
    const recap = buildRecap(archive(episode('root1', [says('b:say', 'original', 10)])), LIVE, 100)
    const rewritten = { ...recap, moments: [{ ...recap.moments[0]!, beat: says('b:say', 'rewritten', 10) }] } as Recap
    expect(recapLines(rewritten)[0]!.text).toBe('rewritten')
    const withStory = { ...recap, story: 'A STORY-TEXT the server wrote' } as Recap
    expect(recapLines(withStory)).toHaveLength(1)
    expect(JSON.stringify(recapLines(withStory))).not.toContain('STORY-TEXT')
  })
})

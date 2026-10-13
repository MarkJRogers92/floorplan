/**
 * Committed DOM evidence for the script surface (review finding 3: the script/memory/recap
 * views were only ever exercised by the ignored scratch harness). This runs in the node
 * environment, so `document` is a stub: an element that records `textContent`, classes,
 * dataset and children, and **throws on `innerHTML`**. Every one of these strings starts
 * life as agent- or human-supplied text (an agent name, a quote, a persona), so a future
 * edit from `textContent` to `innerHTML` must fail here rather than render a tag.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { castMemoryCards } from '../../src/app/cast-memory'
import { memoryElement, recapElement, scriptRow } from '../../src/app/script-view'
import { buildRecap, type Recap } from '../../src/narrative/recap'
import type { ScriptLine } from '../../src/narrative/script'
import type { ArchivedEpisode, SeriesArchive } from '../../src/narrative/series'
import type { Beat, BeatDetail } from '../../src/narrative/types'

type El = {
  tag: string
  className: string
  dataset: Record<string, string>
  tabIndex: number
  open: boolean
  textContent: string
  kids: El[]
  append(...nodes: El[]): void
}

function el(tag: string): El {
  const node: El = {
    tag, className: '', dataset: {}, tabIndex: -1, open: false, textContent: '', kids: [],
    append(...nodes: El[]) { node.kids.push(...nodes) },
  }
  Object.defineProperty(node, 'innerHTML', {
    get() { throw new Error(`innerHTML read on <${tag}>: view text must never be markup`) },
    set() { throw new Error(`innerHTML set on <${tag}>: view text must never be markup`) },
  })
  return node
}

beforeEach(() => { vi.stubGlobal('document', { createElement: (tag: string) => el(tag) }) })
afterEach(() => { vi.unstubAllGlobals() })

const asType = <T>(node: unknown): T => node as T
/** Real DOM textContent collapses children; the stub keeps them, so flatten explicitly. */
const flat = (node: El): string => node.textContent + node.kids.map(flat).join('')
const kidsWith = (node: El, className: string): El[] => node.kids.filter(kid => kid.className === className)

const KEY = 'directory:/synthetic/project'
const LIVE = 'live-root'

const says = (id: string, said: string, at = 10): Beat =>
  ({ id, at, endAt: at, eventIDs: [id], kind: 'says', sessionID: 'root1', detail: { kind: 'says', deltas: 1, text: said } })
const wrap = (id: string, at = 20): Beat =>
  ({ id, at, endAt: at, eventIDs: [id], kind: 'wrap', sessionID: 'root1', detail: { kind: 'wrap' } })
const episode = (root: string, beats: Beat[]): ArchivedEpisode =>
  ({ id: `ep:${root}`, rootSessionID: root, seriesKey: KEY, sessions: [{ id: root, agent: 'build' }], beats })
const archive = (episodes: ArchivedEpisode[]): SeriesArchive => ({ version: 1, key: KEY, episodes, personas: [] })
const recapOf = (...beats: Beat[]): Recap => buildRecap(archive([episode('root1', beats)]), LIVE, 100)

const line = (text = 'It happened.', patch: Partial<ScriptLine> = {}): ScriptLine => ({
  line: { id: 'l1', speaker: 'narrator', template: 'It happened.', cites: ['b:a'] },
  text, delivery: 'narration', beatIDs: ['b:a'], ...patch,
})

describe('scriptRow', () => {
  it('marks the kind, cites the beats and stays keyboard-focusable', () => {
    for (const kind of ['episode', 'scene', 'line'] as const) {
      const row = asType<El>(scriptRow(line('A line.'), kind))
      expect(row.className, kind).toBe(kind)
      expect(row.tabIndex, kind).toBe(0)
      expect(row.dataset.beats, kind).toBe('b:a')
    }
    const row = asType<El>(scriptRow(line('A line.'), 'line'))
    expect(row.kids[0]!.textContent).toBe('A line.')
    expect(row.kids[1]!.className).toBe('beats')
    expect(row.kids[1]!.textContent).toBe('b:a')
  })

  it('labels delivery and flashback only on a line row', () => {
    const plain = asType<El>(scriptRow(line(), 'line'))
    expect(plain.dataset.delivery).toBe('narration')
    expect(plain.dataset.flashback).toBeUndefined()
    expect(asType<El>(scriptRow(line(), 'scene')).dataset.delivery).toBeUndefined()
    const flashback = line('Earlier words.', {
      delivery: 'real-speech', line: { id: 'l2', speaker: 'build', template: '{quote:b:a}', cites: ['b:a'], flashback: true },
    })
    const row = asType<El>(scriptRow(flashback, 'line'))
    expect(row.dataset.delivery).toBe('real-speech')
    expect(row.dataset.flashback).toBe('true')
  })

  it('writes markup-like line text as text, never as markup', () => {
    const raw = '<b>Quoted</b> & <script>alert(1)</script>'
    const row = asType<El>(scriptRow(line(raw), 'line'))
    expect(row.kids[0]!.textContent).toBe(raw)
    expect(flat(row)).toContain(raw)
  })
})

describe('memoryElement', () => {
  const cards = (agents: string[]) => castMemoryCards({
    key: KEY, episodeCount: 2,
    bibles: [{ agent: 'scribe', episodes: ['ep:a'] }],
    personas: [{ agent: 'build', text: 'a weary detective', debut: { episodeID: 'ep:a', beatID: 'b:say' } }],
  }, agents)
  const id = '["directory:/synthetic/project","live-root"]'

  it('labels a saved persona as invented and prints its exact stored debut', () => {
    const memory = asType<El>(memoryElement(cards(['build', 'scribe', 'ghost']), id, false))
    expect(memory.tag).toBe('details')
    expect(memory.className).toBe('cast-memory')
    expect(memory.dataset.memory).toBe(id)
    expect(memory.kids[0]!.tag).toBe('summary')
    expect(memory.kids[0]!.textContent).toBe('Cast memory')
    const entry = memory.kids[1]!
    expect(entry.kids[0]!.tag).toBe('strong')
    expect(entry.kids[0]!.textContent).toBe('build')
    expect(flat(entry)).toContain('Invented persona: a weary detective')
    expect(flat(entry)).toContain('Stored debut: ep:a · b:say')
    expect(flat(entry)).not.toContain('Previous appearances')
  })

  it('lists previous archived episodes, and shows no invented label without a persona', () => {
    const scribe = asType<El>(memoryElement(cards(['scribe']), id, false)).kids[1]!
    expect(flat(scribe)).toContain('Previous appearances: ep:a')
    expect(flat(scribe)).not.toContain('Invented persona')
    expect(flat(scribe)).not.toContain('Stored debut')
  })

  it('restores the open disclosure state it was given, and shows nothing when empty', () => {
    expect(asType<El>(memoryElement(cards(['build']), id, true)).open).toBe(true)
    expect(asType<El>(memoryElement(cards(['build']), id, false)).open).toBe(false)
    expect(asType<El>(memoryElement([], id, true)).kids).toHaveLength(1)
  })

  it('writes a markup-like agent name as text', () => {
    const raw = asType<El>(memoryElement([{ agent: '<em>x</em>', episodes: ['ep:a'] }], id, false))
    expect(raw.kids[1]!.kids[0]!.textContent).toBe('<em>x</em>')
  })
})

describe('recapElement', () => {
  const recap = recapOf(says('b:say', 'Aloud.'), wrap('b:wrap'))
  const rows = (section: El) => kidsWith(section, 'line recap-line')

  it('keeps the always-partial label and note on every montage', () => {
    const section = asType<El>(recapElement(recap))
    expect(section.tag).toBe('section')
    expect(section.className).toBe('recap')
    expect(section.dataset.recap).toBe('partial')
    expect(section.kids[0]!.tag).toBe('h3')
    expect(section.kids[0]!.textContent).toBe('Previously on…')
    expect(section.kids[1]!.className).toBe('recap-note')
    expect(section.kids[1]!.textContent).toBe('From earlier archived footage; may be incomplete.')
  })

  it('pairs each row with its exact episode/beat citation and makes it focusable', () => {
    const section = asType<El>(recapElement(recap))
    const cited = rows(section).map(row => [JSON.parse(row.dataset.historyRef!), row.kids[1]!.textContent, row.tabIndex])
    expect(cited).toEqual([
      [{ episodeID: 'ep:root1', beatID: 'b:say' }, 'ep:root1 · b:say', 0],
      [{ episodeID: 'ep:root1', beatID: 'b:wrap' }, 'ep:root1 · b:wrap', 0],
    ])
    expect(rows(section)[0]!.dataset.historyRef).toBe('{"episodeID":"ep:root1","beatID":"b:say"}')
    expect(rows(section)[0]!.kids[1]!.className).toBe('beats')
  })

  it('prefixes only real speech with its speaker, and writes markup as text', () => {
    const section = asType<El>(recapElement(recapOf(says('b:say', '<i>Aloud.</i>'))))
    const [spoken] = rows(section)
    expect(spoken!.dataset.delivery).toBe('real-speech')
    expect(spoken!.kids[0]!.textContent).toBe('build: <i>Aloud.</i>')
    const narration = asType<El>(recapElement(recapOf(wrap('b:wrap'))))
    expect(rows(narration)[0]!.dataset.delivery).toBe('narration')
    expect(rows(narration)[0]!.kids[0]!.textContent).toBe('The episode wrapped.')
  })

  it('returns nothing at all when no moment can be proved, rather than an empty section', () => {
    const empty: Recap = { key: KEY, rootSessionID: LIVE, before: 100, coverage: 'partial', moments: [] }
    expect(recapElement(empty)).toBeUndefined()
    const unprovable: Recap = {
      key: KEY, rootSessionID: LIVE, before: 100, coverage: 'partial',
      moments: [{
        episodeID: 'ep:root1', session: { id: 'root1', agent: 'build' },
        beat: { id: 'b:bad', at: 10, endAt: 10, eventIDs: ['b:bad'], kind: 'cut', sessionID: 'root1', detail: undefined as unknown as BeatDetail },
      }],
    }
    expect(recapElement(unprovable)).toBeUndefined()
  })
})

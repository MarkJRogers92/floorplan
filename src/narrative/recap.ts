/**
 * Earlier-footage recaps (docs/superpowers/specs/2026-10-13-recaps-design.md).
 *
 * A recap is a bounded montage, never a history: up to three archived moments from
 * up to two eligible episodes in one series key, each re-rendered through the ordinary
 * template checker so a reader can recompute every line instead of trusting prose.
 * Selection is pure and deterministic; nothing here reads a clock, a file, a socket
 * or a model.
 */

import { castFor } from './cast'
import { isID, isRecord, parseEvidence } from './evidence'
import type { Rendered } from './line'
import { assembleScript } from './script'
import type { ArchivedEpisode, SeriesArchive } from './series'
import { templateFor } from './templates'
import type { Beat } from './types'
import { validSeriesKey } from './scope'

export type RecapMoment = { episodeID: string; beat: Beat; session: { id: string; agent?: string } }
export type Recap = { key: string; rootSessionID: string; before: number; coverage: 'partial'; moments: RecapMoment[] }

export type RecapLine = {
  ref: { episodeID: string; beatID: string }
  text: string
  delivery: Rendered['delivery']
  speaker: string
}

export const MAX_RECAP_MOMENTS = 3
export const MAX_RECAP_EPISODES = 2
export const MAX_RECAP_BYTES = 65_536
export const MAX_MOMENT_BYTES = 12_000
export const MAX_RECAP_TEXT = 240

const ENVELOPE_KEYS = ['key', 'rootSessionID', 'before', 'coverage', 'moments']
const MOMENT_KEYS = ['episodeID', 'beat', 'session']
const SESSION_KEYS = ['id', 'agent']

/** Spec priority: the higher number wins, and a kind with no entry is never recapped. */
const PRIORITY: Record<string, number | undefined> = {
  'tool-fails': 7, knocks: 6, answered: 6, cut: 5, 'memory-wipe': 5, retry: 4, wrap: 3, says: 2, 'uses-tool': 1,
}

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length

/** Finite, positive, ordered, and strictly older than the first known current-footage frame. */
const eligible = (beat: Beat, before: number): boolean =>
  Number.isFinite(beat.at) && Number.isFinite(beat.endAt) && beat.at > 0 && beat.endAt >= beat.at &&
  beat.endAt < before && PRIORITY[beat.kind] !== undefined

/**
 * One moment's line, rendered exactly as the page will render it: a line that cannot be
 * proved, or that reads past the quote cap, yields nothing rather than a guess.
 */
const lineFor = (moment: RecapMoment): RecapLine | undefined => {
  try {
    const rendered = assembleScript([moment.beat], { cast: castFor([moment.session]), beats: [moment.beat] }, templateFor)[0]
    if (rendered === undefined || rendered.text.length > MAX_RECAP_TEXT) return undefined
    return {
      ref: { episodeID: moment.episodeID, beatID: moment.beat.id },
      text: rendered.text,
      delivery: rendered.delivery,
      speaker: rendered.line.speaker,
    }
  } catch {
    return undefined // malformed detail cannot be narrated
  }
}

/** The stored actor's raw name; a session the archive never recorded stays unidentified. */
const sessionOf = (beat: Beat, episode: ArchivedEpisode): RecapMoment['session'] => {
  const known = episode.sessions.find(s => s.id === beat.sessionID)
  return known?.agent === undefined ? { id: beat.sessionID } : { id: known.id, agent: known.agent }
}

type Candidate = { moment: RecapMoment; episodeRank: number; beatRank: number; priority: number }

const candidateOf = (episode: ArchivedEpisode, beat: Beat, before: number, episodeRank: number, beatRank: number): Candidate | undefined => {
  if (!eligible(beat, before)) return undefined
  const moment: RecapMoment = { episodeID: episode.id, beat, session: sessionOf(beat, episode) }
  if (bytes(moment) > MAX_MOMENT_BYTES || lineFor(moment) === undefined) return undefined
  return { moment, episodeRank, beatRank, priority: PRIORITY[beat.kind]! }
}

/** Strongest first: higher priority, then newer, then first-seen archive order. */
const preferred = (a: Candidate, b: Candidate): boolean =>
  a.priority !== b.priority ? a.priority > b.priority
    : a.moment.beat.endAt !== b.moment.beat.endAt ? a.moment.beat.endAt > b.moment.beat.endAt
      : (a.episodeRank - b.episodeRank || a.beatRank - b.beatRank) < 0

export function buildRecap(archive: SeriesArchive, root: string, before: number): Recap {
  const recap: Recap = { key: archive.key, rootSessionID: root, before, coverage: 'partial', moments: [] }
  if (!Number.isFinite(before) || before <= 0 || before > Number.MAX_SAFE_INTEGER) return recap
  const byEpisode = new Map<string, Candidate[]>()
  const episodeRank = new Map<string, number>()
  archive.episodes.forEach((episode, rank) => {
    // Same project, a different root, and an episode ref the parser will accept.
    if (episode.seriesKey !== archive.key || episode.rootSessionID === root ||
        episode.id !== `ep:${episode.rootSessionID}` || !isID(episode.rootSessionID)) return
    const candidates = episode.beats.flatMap((beat, beatRank) => candidateOf(episode, beat, before, rank, beatRank) ?? [])
    if (candidates.length === 0) return
    byEpisode.set(episode.id, candidates)
    episodeRank.set(episode.id, rank)
  })
  const latest = (id: string): number => Math.max(...byEpisode.get(id)!.map(c => c.moment.beat.endAt))
  // Recent means latest eligible endAt, not write order; a tie keeps the archive's own order.
  const recent = [...byEpisode.keys()].sort((a, b) => latest(b) - latest(a) || episodeRank.get(a)! - episodeRank.get(b)!)
  const chosen = recent.slice(0, MAX_RECAP_EPISODES)
  const pool = chosen.flatMap(id => byEpisode.get(id)!)
  const selected: Candidate[] = []
  const best = (from: Candidate[]): Candidate | undefined => from
    .filter(c => !selected.includes(c))
    .reduce<Candidate | undefined>((top, c) => (top === undefined || preferred(c, top) ? c : top), undefined)
  for (const id of chosen) {
    const highlight = best(byEpisode.get(id)!)
    if (highlight) selected.push(highlight) // one highlight per eligible episode
  }
  while (selected.length < MAX_RECAP_MOMENTS) {
    const next = best(pool)
    if (next === undefined) break
    selected.push(next)
  }
  // Episodes oldest-to-newest, archived beat order inside each: never a rearranged story.
  const place = new Map([...chosen]
    .sort((a, b) => latest(a) - latest(b) || episodeRank.get(a)! - episodeRank.get(b)!)
    .map((id, i) => [id, i]))
  recap.moments = selected
    .slice()
    .sort((a, b) => place.get(a.moment.episodeID)! - place.get(b.moment.episodeID)! || a.beatRank - b.beatRank)
    .map(c => c.moment)
  while (recap.moments.length > 0 && bytes(recap) > MAX_RECAP_BYTES) recap.moments.pop()
  return recap
}

const parseMoment = (value: unknown, root: string, before: number): RecapMoment | undefined => {
  if (!isRecord(value) || Object.keys(value).some(key => !MOMENT_KEYS.includes(key))) return undefined
  const episodeID = value.episodeID
  if (typeof episodeID !== 'string' || !episodeID.startsWith('ep:') || episodeID === `ep:${root}` ||
      !isID(episodeID.slice(3))) return undefined
  const session = value.session
  if (!isRecord(session) || Object.keys(session).some(key => !SESSION_KEYS.includes(key)) || !isID(session.id) ||
      (session.agent !== undefined && !isID(session.agent))) return undefined
  const evidence = parseEvidence([value.beat], [session], 1, 1)
  if (!evidence) return undefined
  const beat = evidence.beats[0]!
  if (beat.sessionID !== session.id || !eligible(beat, before)) return undefined
  const text = (beat.detail as { text?: string }).text
  if (text !== undefined && text.length > MAX_RECAP_TEXT) return undefined
  if (bytes(value) > MAX_MOMENT_BYTES) return undefined
  return value as RecapMoment
}

/** The whole-envelope gate: anything unknown or inconsistent refuses the recap, never part of it. */
export function parseRecap(value: unknown, key: string, root: string, before: number): Recap | undefined {
  try {
    if (!validSeriesKey(key) || !isID(root) || !Number.isFinite(before) || before <= 0 || before > Number.MAX_SAFE_INTEGER ||
        !isRecord(value) || Object.keys(value).some(field => !ENVELOPE_KEYS.includes(field)) ||
        value.key !== key || value.rootSessionID !== root || value.before !== before || value.coverage !== 'partial' ||
        !Array.isArray(value.moments) || value.moments.length > MAX_RECAP_MOMENTS || bytes(value) > MAX_RECAP_BYTES) return undefined
    const refs = new Set<string>()
    const episodes = new Set<string>()
    for (const raw of value.moments) {
      const moment = parseMoment(raw, root, before)
      if (!moment) return undefined
      const ref = JSON.stringify([moment.episodeID, moment.beat.id])
      if (refs.has(ref)) return undefined
      refs.add(ref)
      episodes.add(moment.episodeID)
      if (episodes.size > MAX_RECAP_EPISODES) return undefined
    }
    return JSON.parse(JSON.stringify(value)) as Recap
  } catch {
    return undefined
  }
}

/** Recompute, never trust: every line comes from its own moment's evidence. */
export function recapLines(recap: Recap): RecapLine[] {
  return recap.moments.flatMap(moment => lineFor(moment) ?? [])
}

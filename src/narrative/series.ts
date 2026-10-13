import type { Beat, SessionInfo } from './types'
import { rootFor } from './cast'
import { isRecord, isID, parseEvidence } from './evidence'
import { validSeriesKey, preferSeriesKey } from './scope'
import { lintFreeText } from './vocabulary'

export type ArchivedEpisode = { id: string; rootSessionID: string; seriesKey: string; sessions: SessionInfo[]; beats: Beat[] }
export type Persona = { agent: string; text: string; debut: { episodeID: string; beatID: string } }
export type SeriesArchive = { version: 1; key: string; episodes: ArchivedEpisode[]; personas: Persona[] }
export const MAX_EPISODE_BYTES = 2 * 1024 * 1024
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => isRecord(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)

export function validPersonaText(text: unknown): text is string {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= 160 && !/[{}]/.test(text) &&
    lintFreeText(text) === undefined && !/\b(?:succeeded|failed|interrupted|approved|denied|rejected|exit)\b/i.test(text)
}

export function parseArchivedEpisode(value: unknown): ArchivedEpisode | undefined {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_EPISODE_BYTES || !isRecord(value) ||
        Object.keys(value).some(k => !['id', 'rootSessionID', 'seriesKey', 'sessions', 'beats'].includes(k)) ||
        !isID(value.rootSessionID) || value.id !== `ep:${value.rootSessionID}` || !validSeriesKey(value.seriesKey)) return undefined
    const evidence = parseEvidence(value.beats, value.sessions, 10_000, 256, true)
    if (!evidence) return undefined
    const index = new Map(evidence.sessions.map(s => [s.id, s]))
    if (evidence.sessions.some(s => rootFor(s.id, index) !== value.rootSessionID) ||
        evidence.beats.some(b => rootFor(b.sessionID, index) !== value.rootSessionID)) return undefined
    return JSON.parse(JSON.stringify(value)) as ArchivedEpisode
  } catch { return undefined }
}

export function parseSeriesArchive(value: unknown): SeriesArchive | undefined {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_ARCHIVE_BYTES || !isRecord(value) || value.version !== 1 ||
        !validSeriesKey(value.key) || Object.keys(value).some(k => !['version', 'key', 'episodes', 'personas'].includes(k)) ||
        !Array.isArray(value.episodes) || value.episodes.length > 256 || !Array.isArray(value.personas) || value.personas.length > 256) return undefined
    const episodes = value.episodes.map(parseArchivedEpisode)
    if (episodes.some(e => !e || e.seriesKey !== value.key) || new Set(episodes.map(e => e!.id)).size !== episodes.length) return undefined
    const agents = new Set<string>()
    for (const p of value.personas) {
      if (!isRecord(p) || Object.keys(p).some(k => !['agent', 'text', 'debut'].includes(k)) || !isID(p.agent) ||
          p.agent === 'unidentified' || agents.has(p.agent) || !validPersonaText(p.text) || !isRecord(p.debut) ||
          Object.keys(p.debut).some(k => !['episodeID', 'beatID'].includes(k)) || !isID(p.debut.episodeID, 512) || !isID(p.debut.beatID, 512)) return undefined
      const episode = episodes.find(e => e!.id === (p.debut as Record<string, unknown>).episodeID)!
      const beat = episode?.beats.find(b => b.id === (p.debut as Record<string, unknown>).beatID)
      if (!beat || episode.sessions.find(s => s.id === beat.sessionID)?.agent !== p.agent) return undefined
      agents.add(p.agent)
    }
    return JSON.parse(JSON.stringify(value)) as SeriesArchive
  } catch { return undefined }
}

/** Partial rejoins are additive. A conflicting immutable beat fails the entire save. */
export function mergeEpisode(old: ArchivedEpisode, next: ArchivedEpisode): ArchivedEpisode {
  if (old.id !== next.id || old.seriesKey !== next.seriesKey || old.rootSessionID !== next.rootSessionID) throw new Error('episode conflict')
  const sessions = new Map(old.sessions.map(s => [s.id, { ...s }]))
  for (const session of next.sessions) {
    const known = sessions.get(session.id)
    const merged = { ...known, ...Object.fromEntries(Object.entries(session).filter(([, v]) => v !== undefined)) } as SessionInfo
    const seriesKey = preferSeriesKey(known?.seriesKey, session.seriesKey)
    if (seriesKey !== undefined) merged.seriesKey = seriesKey
    sessions.set(session.id, merged)
  }
  const beats = new Map(old.beats.map(b => [b.id, b]))
  for (const beat of next.beats) {
    const known = beats.get(beat.id)
    if (known && canonical(known) !== canonical(beat)) throw new Error('beat conflict')
    beats.set(beat.id, beat)
  }
  const merged = parseArchivedEpisode({ ...old, sessions: [...sessions.values()], beats: [...beats.values()] })
  if (!merged) throw new Error('invalid merged episode')
  return merged
}

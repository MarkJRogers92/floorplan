/** One schema for browser/server narrative evidence; callers impose their own byte caps. */
import type { Beat, SessionInfo } from './types'
import { validSeriesKey } from './scope'

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const isID = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const count = (v: unknown) => finite(v) && Number.isInteger(v) && (v as number) >= 0
const fields: Record<string, { required: string[]; optional?: string[] }> = {
  'episode-opens': { required: [] }, 'human-asks': { required: [] }, 'memory-wipe': { required: [] }, wrap: { required: [] },
  thinks: { required: ['deltas'], optional: ['text', 'endedEventID'] }, says: { required: ['deltas'], optional: ['text', 'endedEventID'] },
  'uses-tool': { required: ['tool'], optional: ['callID', 'path', 'exit'] }, 'tool-fails': { required: ['tool'], optional: ['callID', 'path', 'exit'] },
  'guest-arrives': { required: ['childSessionID'], optional: ['callID'] }, 'guest-leaves': { required: ['childSessionID'], optional: ['callID'] },
  briefing: { required: ['childSessionID'], optional: ['callID'] }, knocks: { required: ['requestID'] }, answered: { required: ['reply'] },
  retry: { required: ['attempt'] }, cut: { required: ['reason'] }, silence: { required: ['fromEventID', 'toEventID', 'ms'] },
}
const detailValue = (key: string, value: unknown) => {
  if (key === 'deltas' || key === 'attempt') return count(value)
  if (key === 'ms') return finite(value) && (value as number) >= 0
  if (key === 'exit') return finite(value) && Number.isInteger(value)
  return typeof value === 'string' && value.length <= 16_384
}

export function parseEvidence(beats: unknown, sessions: unknown, maxBeats: number, maxSessions: number, allowScope = false):
  { beats: Beat[]; sessions: SessionInfo[] } | undefined {
  if (!Array.isArray(beats) || !beats.length || beats.length > maxBeats || !Array.isArray(sessions) || sessions.length > maxSessions) return undefined
  const sessionIDs = new Set<string>()
  const sessionKeys = ['id', 'parentID', 'agent', 'model', ...(allowScope ? ['seriesKey'] : [])]
  for (const s of sessions) {
    if (!isRecord(s) || !isID(s.id) || sessionIDs.has(s.id) || Object.keys(s).some(k => !sessionKeys.includes(k)) ||
        ['parentID', 'agent', 'model'].some(k => s[k] !== undefined && !isID(s[k])) ||
        (s.seriesKey !== undefined && !validSeriesKey(s.seriesKey))) return undefined
    sessionIDs.add(s.id)
  }
  const typedSessions = sessions as SessionInfo[]
  const parents = new Map(typedSessions.map(s => [s.id, s.parentID]))
  for (const s of typedSessions) {
    const visited = new Set<string>()
    let id: string | undefined = s.id
    while (id) { if (visited.has(id)) return undefined; visited.add(id); id = parents.get(id) }
  }
  const beatIDs = new Set<string>()
  for (const b of beats) {
    if (!isRecord(b) || !isID(b.id, 512) || beatIDs.has(b.id) || !isID(b.sessionID) || !finite(b.at) || !finite(b.endAt) ||
        !Array.isArray(b.eventIDs) || b.eventIDs.length > 2048 || b.eventIDs.some(id => !isID(id, 512)) ||
        Object.keys(b).some(k => !['id', 'at', 'endAt', 'eventIDs', 'kind', 'sessionID', 'detail'].includes(k)) ||
        typeof b.kind !== 'string' || !Object.hasOwn(fields, b.kind) || !isRecord(b.detail) || b.detail.kind !== b.kind) return undefined
    const schema = fields[b.kind]
    const detail = b.detail
    const allowed = ['kind', ...schema.required, ...(schema.optional ?? [])]
    if (schema.required.some(k => !detailValue(k, detail[k])) || Object.entries(detail).some(([k, v]) =>
      !allowed.includes(k) || (k !== 'kind' && v !== undefined && !detailValue(k, v)))) return undefined
    beatIDs.add(b.id)
  }
  return { beats: beats as Beat[], sessions: typedSessions }
}

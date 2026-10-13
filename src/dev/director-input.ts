/** Strict shape/size checks before any scene can spend or leave this machine. */
import type { DirectorRequest } from '../narrative/director'
import { assembleScenes } from '../narrative/scene'

export const MAX_SCENE_BYTES = 32_768
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
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

export function parseDirectorRequest(value: unknown): DirectorRequest | undefined {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_SCENE_BYTES) return undefined
    if (!object(value) || Object.keys(value).some(k => !['sceneID', 'beats', 'sessions'].includes(k)) ||
        !str(value.sceneID, 512) || !Array.isArray(value.beats) || !value.beats.length || value.beats.length > 12 ||
        !Array.isArray(value.sessions) || value.sessions.length > 128) return undefined
    const sessionIDs = new Set<string>()
    for (const s of value.sessions) {
      if (!object(s) || !str(s.id) || sessionIDs.has(s.id) ||
          Object.keys(s).some(k => !['id', 'parentID', 'agent', 'model'].includes(k)) ||
          ['parentID', 'agent', 'model'].some(k => s[k] !== undefined && !str(s[k], 256))) return undefined
      sessionIDs.add(s.id)
    }
    const sessions = value.sessions as DirectorRequest['sessions']
    const parents = new Map(sessions.map(s => [s.id, s.parentID]))
    for (const s of sessions) {
      const visited = new Set<string>()
      let id: string | undefined = s.id
      while (id) {
        if (visited.has(id)) return undefined
        visited.add(id); id = parents.get(id)
      }
    }
    const beatIDs = new Set<string>()
    for (const b of value.beats) {
      if (!object(b) || !str(b.id, 512) || beatIDs.has(b.id) || !str(b.sessionID) || !finite(b.at) || !finite(b.endAt) ||
          !Array.isArray(b.eventIDs) || b.eventIDs.length > 2048 || b.eventIDs.some(id => !str(id, 512)) ||
          Object.keys(b).some(k => !['id', 'at', 'endAt', 'eventIDs', 'kind', 'sessionID', 'detail'].includes(k)) ||
          typeof b.kind !== 'string' || !Object.hasOwn(fields, b.kind) || !object(b.detail) || b.detail.kind !== b.kind) return undefined
      const schema = fields[b.kind]
      const detail = b.detail
      const allowed = ['kind', ...schema.required, ...(schema.optional ?? [])]
      if (schema.required.some(k => !Object.hasOwn(detail, k)) ||
          Object.entries(detail).some(([k, v]) => !allowed.includes(k) || (k !== 'kind' && v !== undefined && !detailValue(k, v)))) return undefined
      beatIDs.add(b.id)
    }
    const request = value as unknown as DirectorRequest
    const scenes = assembleScenes(request.beats, sessions)
    if (scenes.length !== 1 || scenes[0].id !== request.sceneID) return undefined
    return JSON.parse(JSON.stringify(request)) as DirectorRequest
  } catch { return undefined }
}

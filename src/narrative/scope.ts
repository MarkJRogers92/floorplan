import type { Frame } from '../api/sse'
import { rootFor } from './cast'
import type { SessionInfo } from './types'

export function validSeriesKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && /^(directory|project):.+$/.test(value) &&
    !/[\x00-\x1f\x7f]/.test(value) && new TextDecoder().decode(new TextEncoder().encode(value)) === value
}

export function preferSeriesKey(known?: string, incoming?: string): string | undefined {
  if (!validSeriesKey(incoming)) return known
  return known?.startsWith('directory:') && incoming.startsWith('project:') ? known : incoming
}

export function scopeFromSnapshot(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const data = value as Record<string, unknown>
  const location = data.location as { directory?: unknown } | undefined
  const directory = location?.directory ?? data.directory
  if (typeof directory === 'string' && directory) {
    const key = `directory:${directory}`
    if (validSeriesKey(key)) return key
  }
  const key = typeof data.projectID === 'string' && data.projectID ? `project:${data.projectID}` : undefined
  return validSeriesKey(key) ? key : undefined
}

export function scopeFromFrame(frame: Frame): string | undefined {
  return preferSeriesKey(scopeFromSnapshot(frame.data), scopeFromSnapshot({ location: frame.location }))
}

export function learnSeriesScope(sessions: Map<string, SessionInfo>, frame: Frame): Map<string, SessionInfo> {
  const data = frame.data as { sessionID?: unknown } | null
  const id = data && typeof data.sessionID === 'string' ? data.sessionID : ''
  const known = sessions.get(id)
  if (!known) return sessions
  const seriesKey = preferSeriesKey(known.seriesKey, scopeFromFrame(frame))
  return seriesKey !== known.seriesKey ? new Map(sessions).set(id, { ...known, seriesKey }) : sessions
}

/** Only the root's own identity governs its guests; a guest's cwd is not evidence of it. */
export function seriesKeyForRoot(sessionID: string, sessions: SessionInfo[]): string | undefined {
  const index = new Map(sessions.map(s => [s.id, s]))
  return index.get(rootFor(sessionID, index))?.seriesKey
}

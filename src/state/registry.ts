import type { Frame } from '../api/sse'
import { applyFrame, createDesk, type Desk } from './desk'

/**
 * Sessions deleted so far, per registry map. A tombstone must outlive the frame that
 * made it — a straggling event after `session.deleted` must not resurrect the desk —
 * but the plan's interface passes only the `Map`. So each map we return carries its
 * set here, keyed weakly so a dropped map takes its tombstones with it. A map we did
 * not make (a fresh one, or one from `seedDesks`) simply has none yet.
 */
const tombstones = new WeakMap<Map<string, Desk>, ReadonlySet<string>>()

/** The session a frame belongs to. `form.created` nests it under `data.form`, as OpenCode's own client reads it. */
function sessionOf(frame: Frame): string | undefined {
  const data = typeof frame.data === 'object' && frame.data !== null ? (frame.data as Record<string, unknown>) : {}
  let id = data.sessionID
  if (id === undefined && frame.type === 'form.created' && typeof data.form === 'object' && data.form !== null) {
    id = (data.form as Record<string, unknown>).sessionID
  }
  return typeof id === 'string' && id !== '' ? id : undefined
}

function derive(next: Map<string, Desk>, deleted: ReadonlySet<string>) {
  tombstones.set(next, deleted)
  return next
}

/**
 * Fold one frame into the floor. Never mutates `map`; returns `map` itself when the
 * frame has no session or names a deleted one. Desks keep the order first seen in.
 */
export function ingest(map: Map<string, Desk>, frame: Frame): Map<string, Desk> {
  const sessionID = sessionOf(frame)
  if (sessionID === undefined) return map
  const deleted = tombstones.get(map) ?? new Set<string>()

  if (frame.type === 'session.deleted') {
    const next = new Map(map)
    next.delete(sessionID)
    return derive(next, new Set(deleted).add(sessionID))
  }
  if (deleted.has(sessionID)) return map

  const desk = map.get(sessionID) ?? createDesk(sessionID)
  const next = new Map(map)
  // session.created on a known desk is idempotent; on a new one it simply adds the desk.
  next.set(sessionID, frame.type === 'session.created' ? desk : applyFrame(desk, frame))
  return derive(next, deleted)
}

export function ingestAll(map: Map<string, Desk>, frames: Frame[]): Map<string, Desk> {
  return frames.reduce(ingest, map)
}

/** The desks in the order their sessions were first seen. */
export function desks(map: Map<string, Desk>): Desk[] {
  return [...map.values()]
}

import type { Frame } from '../api/sse'
import { applyFrame, createDesk, withSiblingWait, type Desk, type DeskStatus } from './desk'

/**
 * What the registry must remember beyond the desks themselves, per returned map:
 *
 * - `deleted`: tombstones. A straggling event after `session.deleted` must not
 *   resurrect the desk, so a tombstone outlives the frame that made it.
 * - `parentOf`: child session → parent session, from `session.created`'s `parentID`.
 *   A parent is waiting on another worker while one of its children is busy (owner
 *   ruling, 2026-10-13), and only the registry sees more than one desk at a time.
 *
 * The plan's interface passes only the `Map`, so each map we return carries its
 * memory here, keyed weakly so a dropped map takes it along. A map we did not make
 * (a fresh one, or one from `seedDesks`) simply has none yet.
 *
 * Two consequences. The memory belongs to the exact map object we returned, so a
 * caller that copies it (`new Map(m)`) loses it — a straggler could resurrect a
 * deleted desk and parents stop waiting on children; always pass back the map
 * `ingest` returned. And both only grow for the life of the registry.
 */
type Memory = { deleted: ReadonlySet<string>; parentOf: ReadonlyMap<string, string> }
const memory = new WeakMap<Map<string, Desk>, Memory>()
const EMPTY: Memory = { deleted: new Set(), parentOf: new Map() }

const BUSY: ReadonlySet<DeskStatus> = new Set(['working', 'waiting-on-you', 'waiting-on-worker'])

type Data = Record<string, unknown>
const dataOf = (frame: Frame): Data =>
  typeof frame.data === 'object' && frame.data !== null ? (frame.data as Data) : {}
const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** The session a frame belongs to. `form.created` nests it under `data.form`, as OpenCode's own client reads it. */
function sessionOf(frame: Frame): string | undefined {
  const data = dataOf(frame)
  if (data.sessionID === undefined && frame.type === 'form.created' && typeof data.form === 'object' && data.form !== null) {
    return nonEmpty((data.form as Data).sessionID)
  }
  return nonEmpty(data.sessionID)
}

/** Re-derive one parent's sibling wait from its children's current desks. Mutates `next`, which we own. */
function refreshWait(next: Map<string, Desk>, parentOf: ReadonlyMap<string, string>, parent: string) {
  const desk = next.get(parent)
  if (!desk) return
  let waiting = false
  for (const [child, p] of parentOf) {
    if (p === parent && BUSY.has(next.get(child)?.status as DeskStatus)) { waiting = true; break }
  }
  next.set(parent, withSiblingWait(desk, waiting))
}

function derive(next: Map<string, Desk>, mem: Memory, touched: string) {
  refreshWait(next, mem.parentOf, touched) // the session itself, if it is a parent
  const parent = mem.parentOf.get(touched)
  if (parent !== undefined) refreshWait(next, mem.parentOf, parent)
  memory.set(next, mem)
  return next
}

/**
 * Fold one frame into the floor. Never mutates `map`; returns `map` itself when the
 * frame has no session or names a deleted one. Desks keep the order first seen in.
 */
export function ingest(map: Map<string, Desk>, frame: Frame): Map<string, Desk> {
  const sessionID = sessionOf(frame)
  if (sessionID === undefined) return map
  const mem = memory.get(map) ?? EMPTY

  if (frame.type === 'session.deleted') {
    const next = new Map(map)
    next.delete(sessionID)
    return derive(next, { ...mem, deleted: new Set(mem.deleted).add(sessionID) }, sessionID)
  }
  if (mem.deleted.has(sessionID)) return map

  const desk = map.get(sessionID) ?? createDesk(sessionID)
  const next = new Map(map)
  let nextMem = mem
  if (frame.type === 'session.created') {
    // Idempotent on a known desk; on a new one it simply adds the desk.
    next.set(sessionID, desk)
    const parent = nonEmpty(dataOf(frame).parentID)
    if (parent !== undefined && parent !== sessionID) {
      nextMem = { ...mem, parentOf: new Map(mem.parentOf).set(sessionID, parent) }
    }
  } else {
    next.set(sessionID, applyFrame(desk, frame))
  }
  return derive(next, nextMem, sessionID)
}

export function ingestAll(map: Map<string, Desk>, frames: Frame[]): Map<string, Desk> {
  return frames.reduce(ingest, map)
}

/** The desks in the order their sessions were first seen. */
export function desks(map: Map<string, Desk>): Desk[] {
  return [...map.values()]
}

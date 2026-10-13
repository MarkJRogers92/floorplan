import type { Frame } from '../api/sse'
import type { Desk } from '../state/desk'
import { settleDesk } from '../state/desk'
import { ingest, desks as registryDesks } from '../state/registry'
import { seedDesks, type PermissionRequest, type SessionSnapshot } from '../state/seed'

const SETTLE_HOLD_MS = 2000

/**
 * The page's single source of floor truth.
 *
 * `setSnapshot` is authoritative for which sessions exist: it re-seeds from the REST
 * snapshot and drops anything not mentioned. Desks that survive keep the position they
 * already had; new desks are appended.
 *
 * `push` folds one live frame into the registry. The exact Map returned by `ingest` is
 * kept, not copied, because `ingest` attaches deleted-session tombstones to that object.
 * Copying would let a straggling event resurrect a deleted desk.
 */
export function createFloor(): {
  setSnapshot(sessions: SessionSnapshot[], permissions: PermissionRequest[]): void
  push(frame: Frame): void
  desks(): Desk[]
} {
  let map = new Map<string, Desk>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function settle(sessionID: string) {
    timers.delete(sessionID)
    const desk = map.get(sessionID)
    if (!desk) return
    map = map.set(sessionID, settleDesk(desk)) // Map.set returns the same map instance
  }

  function scheduleSettle(sessionID: string) {
    if (timers.has(sessionID)) return
    timers.set(sessionID, setTimeout(() => settle(sessionID), SETTLE_HOLD_MS))
  }

  function clearSettle(sessionID: string) {
    const t = timers.get(sessionID)
    if (t !== undefined) {
      clearTimeout(t)
      timers.delete(sessionID)
    }
  }

  return {
    setSnapshot(sessions, permissions) {
      const seeded = seedDesks(sessions, permissions)
      // shortcut: this builds a fresh Map, so deleted-session tombstones from the
      // previous registry are discarded. The snapshot is authoritative for which
      // sessions exist; a straggler for a dropped session after a reconnect can be
      // ignored because the snapshot already caught us up.
      const next = new Map<string, Desk>()
      // Preserve the order of desks that already exist, but take their seeded state
      // so a newly raised permission (or cleared one) is reflected.
      for (const [id] of map) {
        if (seeded.has(id)) {
          next.set(id, seeded.get(id)!)
          seeded.delete(id)
        }
      }
      // Append any genuinely new desks in snapshot order.
      for (const [id, desk] of seeded) {
        next.set(id, desk)
      }
      map = next
      // Any pending settle for a dropped desk is irrelevant now.
      for (const id of timers.keys()) {
        if (!map.has(id)) clearSettle(id)
      }
    },

    push(frame) {
      map = ingest(map, frame)
      for (const desk of map.values()) {
        if (desk.status === 'success' || desk.status === 'failure') {
          scheduleSettle(desk.sessionID)
        } else {
          clearSettle(desk.sessionID)
        }
      }
    },

    desks() {
      return registryDesks(map)
    },
  }
}

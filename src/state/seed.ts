import { applyFrame, createDesk, type Desk } from './desk'

/** One entry from `GET /api/session` (or `/active`). Only the id is read. */
export type SessionSnapshot = { id: string; active?: boolean }

/**
 * One open request from `GET /api/permission/request`. OpenCode returns these keyed
 * by `id`; the caller maps that to `requestID` here, the name `permission.replied` uses.
 *
 * Open forms (`GET /api/form`) can be seeded the same way: pass
 * `{ requestID: form.id, sessionID }`. `form.replied` and `form.cancelled` settle by
 * that same id, so the desk clears exactly as it would for a streamed `form.created`.
 */
export type PermissionRequest = { requestID: string; sessionID: string }

/**
 * Build the floor from a REST snapshot (§6.3: seeded, then streamed).
 *
 * Each open request is folded in as a synthetic `permission.asked` through the same
 * `applyFrame` the live stream uses, so a desk's state cannot depend on whether we
 * learned of its request from the snapshot or from an event. The reducer keeps the
 * first request a desk is asked, so "earliest" means first in the snapshot's order.
 */
export function seedDesks(sessions: SessionSnapshot[], permissions: PermissionRequest[]): Map<string, Desk> {
  const desks = new Map<string, Desk>()
  for (const session of sessions) {
    if (typeof session?.id === 'string' && session.id !== '' && !desks.has(session.id)) {
      desks.set(session.id, createDesk(session.id))
    }
  }
  for (const request of permissions) {
    const { requestID, sessionID } = (request ?? {}) as Partial<PermissionRequest>
    if (typeof requestID !== 'string' || requestID === '' || typeof sessionID !== 'string') continue
    const desk = desks.get(sessionID)
    if (!desk) continue // a request for a session the snapshot does not have: skip, never invent a desk
    desks.set(sessionID, applyFrame(desk, { type: 'permission.asked', data: { id: requestID, sessionID } }))
  }
  return desks
}

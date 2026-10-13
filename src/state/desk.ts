/**
 * The frozen interface between the data path and the room.
 *
 * These two declarations are the contract two branches are built against
 * concurrently: the data path (Tasks 5-9) fills desks in, the room (Tasks 10-11)
 * draws them. Neither side may change a field name or a status string without
 * changing the other, so treat this as append-only until the branches merge.
 *
 * Task 6 adds `createDesk` and `applyFrame` to this file. The room imports the
 * types only, via `import type`, so nothing here has a runtime cost.
 *
 * The status vocabulary is deliberately finer than the drawing needs: "needs you"
 * and "waiting on another worker" are separate states and must never collapse into
 * one. A worker blocked on a sibling is not a worker that needs you.
 */
export type DeskStatus =
  | 'idle'
  | 'working'
  | 'waiting-on-you'
  | 'waiting-on-worker'
  | 'success'
  | 'failure'

export type Desk = {
  sessionID: string
  status: DeskStatus
  caption: string
  /** Set while a permission request is open. Cleared by `permission.replied`. */
  openPermission?: string
  /** Persists across unrelated events, so clearing a permission restores the wait. */
  waitingOnSibling: boolean
}

// ---------------------------------------------------------------------------
// The reducer (Task 6). Everything below is spec §6.3, and the one place it lives.
// Field names are OpenCode v2's own event schemas, checked against a live stream.
// ---------------------------------------------------------------------------

import type { Frame } from '../api/sse'

export function createDesk(sessionID: string): Desk {
  return { sessionID, status: 'idle', caption: '', waitingOnSibling: false }
}

type Data = Record<string, unknown>
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const dataOf = (frame: Frame): Data =>
  typeof frame.data === 'object' && frame.data !== null ? (frame.data as Data) : {}

/**
 * The id of a request that needs the human, or undefined if this frame raises none.
 * OpenCode keys `permission.asked` by `data.id` and `form.created` by `data.form.id`;
 * `data.requestID` is accepted on `permission.asked` too, for the plan's tests.
 */
function askedID(frame: Frame, data: Data): string | undefined {
  if (frame.type === 'permission.asked') return str(data.id) ?? str(data.requestID)
  if (frame.type === 'form.created') {
    const form = data.form
    return typeof form === 'object' && form !== null ? str((form as Data).id) : undefined
  }
  return undefined
}

/** The id this frame settles: `permission.replied` names `requestID`, forms name `id`. */
function settledID(frame: Frame, data: Data): string | undefined {
  if (frame.type === 'permission.replied') return str(data.requestID)
  if (frame.type === 'form.replied' || frame.type === 'form.cancelled') return str(data.id)
  return undefined
}

/** Event families that mean the worker is busy, and the caption each gives. */
const ACTIVITY: ReadonlyArray<[RegExp, string | null]> = [
  [/^session\.compaction\./, 'compacting'],
  [/^session\.reasoning\./, 'thinking'],
  [/^session\.text\./, 'writing'],
  [/^session\.(tool|step|shell)\./, null], // null: keep the current activity caption
  [/^session\.(execution\.started|retry\.scheduled)$/, null],
]

const SIBLING_WAIT = 'waiting on another worker'

/**
 * Fold one frame into one desk. Pure: always returns a new object, never mutates.
 *
 * Precedence (§6.3): an open request outranks everything and is cleared only by the
 * event that settles it — never by our own UI — so anything else that arrives while
 * one is open updates only the persistent sibling flag. Success and failure are held
 * until the next frame that sets a status; no timers live here.
 */
export function applyFrame(desk: Desk, frame: Frame): Desk {
  const data = dataOf(frame)
  const t = frame.type

  // Sibling-wait bookkeeping happens whatever is showing, so it is right afterwards.
  let waitingOnSibling = desk.waitingOnSibling
  if (t === 'session.inbox.delivered' || t === 'session.inbox.cancelled') waitingOnSibling = false
  else if (t.startsWith('session.inbox.')) waitingOnSibling = true

  if (desk.openPermission !== undefined) {
    if (settledID(frame, data) === desk.openPermission) {
      const { openPermission: _settled, ...rest } = desk
      return waitingOnSibling
        ? { ...rest, waitingOnSibling, status: 'waiting-on-worker', caption: SIBLING_WAIT }
        : { ...rest, waitingOnSibling, status: 'working', caption: 'working' }
    }
    return { ...desk, waitingOnSibling }
  }

  const asked = askedID(frame, data)
  if (asked !== undefined) {
    return { ...desk, waitingOnSibling, status: 'waiting-on-you', caption: 'needs you', openPermission: asked }
  }

  if (t.startsWith('session.inbox.')) {
    if (waitingOnSibling) return { ...desk, waitingOnSibling, status: 'waiting-on-worker', caption: SIBLING_WAIT }
    // The wait ended. If it was what we were showing, the input has landed: working.
    return desk.status === 'waiting-on-worker'
      ? { ...desk, waitingOnSibling, status: 'working', caption: 'working' }
      : { ...desk, waitingOnSibling }
  }

  if (t === 'session.execution.succeeded') return { ...desk, status: 'success', caption: 'done' }
  if (t === 'session.execution.failed') return { ...desk, status: 'failure', caption: 'failed' }
  if (t === 'session.execution.interrupted') return { ...desk, status: 'failure', caption: 'interrupted' }

  for (const [pattern, caption] of ACTIVITY) {
    if (!pattern.test(t)) continue
    const tool = t === 'session.tool.input.started' ? str(data.name) : undefined
    const keep = desk.status === 'working' && desk.caption !== '' ? desk.caption : 'working'
    return { ...desk, status: 'working', caption: tool ?? caption ?? keep }
  }

  return { ...desk } // unknown or not ours to act on (§7 R2): a no-op, never an error
}

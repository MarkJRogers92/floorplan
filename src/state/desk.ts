/**
 * The frozen interface between the data path and the room.
 *
 * These two declarations are the contract two branches are built against
 * concurrently: the data path (Tasks 5-9) fills desks in, the room (Tasks 10-11)
 * draws them. Neither side may change a field name or a status string without
 * changing the other, so treat this as append-only. One exception was sanctioned and is
 * recorded on the field itself: the permission ids became a list of every open request
 * rather than a single one.
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
  /**
   * Every unanswered request on this desk, oldest first. The desk shows "needs you"
   * while this is non-empty, and a reply removes only the id it names.
   *
   * A list, not a single slot: the platform can hold more than one request for a
   * session and surface them one at a time, so a single slot would clear the desk
   * when the first was answered while a second was still unanswered — the exact
   * sticking §6.3's precedence rules exist to prevent. This is the one sanctioned
   * change to the frozen declarations; the room reads only `status` (and the count
   * of desks), so it is unaffected.
   */
  openPermissions: string[]
  /** Persists across unrelated events, so clearing a permission restores the wait. */
  waitingOnSibling: boolean
}

// ---------------------------------------------------------------------------
// The reducer (Task 6). Everything below is spec §6.3, and the one place it lives.
// Field names are OpenCode v2's own event schemas, checked against a live stream.
// ---------------------------------------------------------------------------

import type { Frame } from '../api/sse'

export function createDesk(sessionID: string): Desk {
  return { sessionID, status: 'idle', caption: '', openPermissions: [], waitingOnSibling: false }
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
  [/^session\.compaction\.(started|delta)$/, 'compacting'],
  [/^session\.compaction\.(ended|failed)$/, 'working'], // compaction over: drop the 'compacting' caption
  [/^session\.reasoning\./, 'thinking'],
  [/^session\.text\./, 'writing'],
  [/^session\.(tool|step|shell)\./, null], // null: keep the current activity caption
  [/^session\.(execution\.started|retry\.scheduled)$/, null],
]

const SIBLING_WAIT = 'waiting on another worker'

/**
 * Fold one frame into one desk. Pure: always returns a new object, never mutates.
 *
 * Precedence (§6.3): open requests outrank everything and each is cleared only by the
 * event that settles it — never by our own UI — so a second request joins the list and
 * any other frame that arrives while one is open updates only the persistent sibling
 * flag. Success and failure are held until the next frame that sets a status; no timers
 * live here.
 */
export function applyFrame(desk: Desk, frame: Frame): Desk {
  const data = dataOf(frame)
  const t = frame.type

  // Inbox items (user | synthetic | compaction | move) are input arriving, not a wait on
  // another worker (owner ruling, 2026-10-13). The sibling wait is set by the registry,
  // which knows a parent's children, through withSiblingWait.
  if (t.startsWith('session.inbox.')) return { ...desk }
  const waitingOnSibling = desk.waitingOnSibling

  // A request raises "needs you" whether or not one is already open; the desk holds
  // every open id. This is above the open-request branch so a second ask is recorded.
  const asked = askedID(frame, data)
  if (asked !== undefined) {
    return {
      ...desk,
      waitingOnSibling,
      status: 'waiting-on-you',
      caption: 'needs you',
      openPermissions: [...desk.openPermissions, asked],
    }
  }

  if (desk.openPermissions.length > 0) {
    const settled = settledID(frame, data)
    // A reply clears only the id it names; one that names nothing on the desk is a
    // no-op, so an unrelated or already-answered request never blanks the desk.
    if (settled === undefined || !desk.openPermissions.includes(settled)) {
      return { ...desk, waitingOnSibling }
    }
    const rest = desk.openPermissions.filter((id) => id !== settled)
    if (rest.length > 0) return { ...desk, waitingOnSibling, openPermissions: rest }
    return waitingOnSibling
      ? { ...desk, waitingOnSibling, openPermissions: rest, status: 'waiting-on-worker', caption: SIBLING_WAIT }
      : { ...desk, waitingOnSibling, openPermissions: rest, status: 'working', caption: 'working' }
  }

  if (t === 'session.execution.succeeded') return { ...desk, status: 'success', caption: 'done' }
  if (t === 'session.execution.failed') return { ...desk, status: 'failure', caption: 'failed' }
  // OpenCode's own reducer does not count a shutdown as a failure: the session just stopped.
  if (t === 'session.execution.interrupted' && data.reason === 'shutdown') return { ...desk, status: 'idle', caption: '' }
  if (t === 'session.execution.interrupted') return { ...desk, status: 'failure', caption: 'interrupted' }

  for (const [pattern, caption] of ACTIVITY) {
    if (!pattern.test(t)) continue
    const tool = t === 'session.tool.input.started' ? str(data.name) : undefined
    const keep = desk.status === 'working' && desk.caption !== '' ? desk.caption : 'working'
    return { ...desk, status: 'working', caption: tool ?? caption ?? keep }
  }

  return { ...desk } // unknown or not ours to act on (§7 R2): a no-op, never an error
}

/**
 * §6.3: success and failure "hold briefly, then fall back to the session's underlying
 * state". This is the fall-back; the hold is the caller's (a timer in the page), so
 * this stays pure. An open request wins, then a recorded sibling wait, else idle. Any
 * desk not showing success or failure comes back as an equal copy.
 */
export function settleDesk(desk: Desk): Desk {
  if (desk.status !== 'success' && desk.status !== 'failure') return { ...desk }
  if (desk.openPermissions.length > 0) return { ...desk, status: 'waiting-on-you', caption: 'needs you' }
  if (desk.waitingOnSibling) return { ...desk, status: 'waiting-on-worker', caption: SIBLING_WAIT }
  return { ...desk, status: 'idle', caption: '' }
}

/**
 * Set or clear the sibling wait: whether one of this worker's children is still busy.
 * The registry decides `waiting`; this decides what it shows, with §6.3 precedence —
 * an open request is never overridden, only the flag is recorded so the wait shows
 * again when the request is settled. Only a `working` desk turns into a wait, and
 * only a desk showing the wait turns back to `working`: a held success or failure,
 * or an idle desk, keeps its status. Returns `desk` itself when nothing changes.
 */
export function withSiblingWait(desk: Desk, waiting: boolean): Desk {
  if (desk.openPermissions.length === 0) {
    if (waiting && desk.status === 'working') {
      return { ...desk, waitingOnSibling: true, status: 'waiting-on-worker', caption: SIBLING_WAIT }
    }
    if (!waiting && desk.status === 'waiting-on-worker') {
      return { ...desk, waitingOnSibling: false, status: 'working', caption: 'working' }
    }
  }
  return desk.waitingOnSibling === waiting ? desk : { ...desk, waitingOnSibling: waiting }
}

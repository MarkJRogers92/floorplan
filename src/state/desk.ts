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

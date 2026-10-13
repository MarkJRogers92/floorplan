/**
 * The silence rule (design §4.1) and the per-session "working" track that makes
 * it checkable. A silence is a gap of ≥ 30 s between two frames of a *working*
 * session, raised by the frame that ends it and citing both bounding frames.
 *
 * Working = after the session's `execution.started` (or its first frame, if we
 * *joined* after creation) and before its `wrap`/`cut`, with no unanswered
 * `knocks` and no open `subagent` call. A parent waiting on its guest is not
 * silent. A `session.created` we saw is not "joined" — a session we watched
 * from creation is not working until its `execution.started`. No timers, so a
 * replay yields the same beats.
 *
 * The check runs at entry, before the rest of the frame is processed, so the
 * working state is the prior frame's and the from-side bounding frame is
 * already in the track. The track is updated last, so it reflects the
 * post-process state the *next* frame's silence check sees.
 */

import type { Frame } from '../api/sse'
import type { Beat, BeatDetail, BeatKind, OpenCall, SessionTrack } from './types'

/** The silence threshold, in ms (design §4.1). */
const SILENCE_GAP_MS = 30_000

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/**
 * A beat's name. Most beats: `b:<first event id>`, so the beat is named where it
 * started and a replay names it the same. The silence beat is the exception:
 * naming it by either bounding frame would collide with the other beat that
 * frame may raise (the frame that ends a silence may itself be a `knocks`,
 * `wrap`, `cut`, etc., which takes that frame's id). So silence always takes
 * the kind-qualified fallback `b:silence:<session>:<at>`, which no other beat
 * can produce — the collision is structurally impossible. §4.1's "an opener
 * and its beat must never share an id" generalises to every pair of beats.
 *
 * A beat whose first event carries no id at all also takes the kind fallback
 * (`b:<kind>:<session>:<at>`); that rule and the silence rule share one
 * definition here.
 */
export const beatID = (eventIDs: string[], kind: BeatKind, sessionID: string, at: number): string => {
  if (kind === 'silence') return `b:silence:${sessionID}:${at}`
  return eventIDs[0] !== undefined ? `b:${eventIDs[0]}` : `b:${kind}:${sessionID}:${at}`
}

/**
 * Is this session's audience still being asked? A knock is unanswered until a
 * `permission.replied`/`form.replied`/`form.cancelled` frame names its id.
 * `permission.asked`/`form.created` add to the map; a reply removes only its own.
 */
const hasUnansweredKnock = (pending: Map<string, string>, sessionID: string): boolean => {
  for (const owner of pending.values()) if (owner === sessionID) return true
  return false
}

/**
 * Is this session waiting on a subagent guest? A call is open from its
 * `tool.input.started` to its `tool.success`/`tool.failed`, and a parent waiting
 * on its guest is not silent.
 */
const hasOpenSubagentCall = (calls: Map<string, OpenCall>, sessionID: string): boolean => {
  for (const call of calls.values()) {
    if (call.sessionID === sessionID && call.tool === 'subagent') return true
  }
  return false
}

/**
 * §4.1 silence check. Returns a beat to push if this frame ends a silence, or
 * undefined. Runs at entry, with the state before this frame is processed.
 *
 * The beat's id is the silence fallback (`b:silence:<session>:<at>`), so it can
 * never collide with the beat the ending frame may itself raise. Its
 * `eventIDs` cites both bounding frames — the silence is narrated by what
 * ended it, and the citation must show that.
 */
export function checkSilence(params: {
  sessionID: string
  at: number
  id: string | undefined
  tracks: Map<string, SessionTrack>
  pending: Map<string, string>
  calls: Map<string, OpenCall>
}): Beat | undefined {
  const { sessionID, at, id, tracks, pending, calls } = params
  if (sessionID === '') return undefined
  const prior = tracks.get(sessionID)
  if (prior?.working !== true) return undefined
  if (prior.lastAt === undefined) return undefined
  if (at - prior.lastAt < SILENCE_GAP_MS) return undefined
  if (hasUnansweredKnock(pending, sessionID)) return undefined
  if (hasOpenSubagentCall(calls, sessionID)) return undefined
  if (prior.lastEventID === undefined) return undefined

  // The from-side bound is the prior track's lastEventID; the to-side is the
  // ending frame's id. An id-less ending frame still closes a silence, but
  // there is no id to cite on the to side, so the citation carries an empty
  // string there. The silence's own id (kind fallback) is independent of either.
  const eventIDs = [prior.lastEventID, ...(id === undefined ? [] : [id])]
  const toEventID = id ?? ''
  const detail: BeatDetail = { kind: 'silence', fromEventID: prior.lastEventID, toEventID, ms: at - prior.lastAt }
  return {
    id: beatID(eventIDs, 'silence', sessionID, at),
    at, eventIDs, kind: 'silence', sessionID, detail,
  }
}

/**
 * §4.1 working-flag transitions. `execution.started` opens working; `wrap`/
 * `cut` close it; a session's *first* frame opens working only when we joined
 * — and a `session.created` we saw is not "joined" (we watched the session
 * from its creation, not after). A session that became known to us through
 * `session.created` is not working until its `execution.started`. Other
 * frames leave the flag alone.
 */
export function nextWorking(params: {
  sessionID: string
  type: string
  prior: SessionTrack | undefined
  working: boolean
}): boolean {
  const { sessionID, type, prior, working } = params
  if (type === 'execution.succeeded') return false
  if (type === 'execution.failed' || type === 'execution.interrupted') return false
  if (type === 'execution.started') return true
  if (sessionID !== '' && prior === undefined && type !== 'created') return true
  return working
}

/**
 * Update the per-session track with this frame's `at` and id, and the working
 * state the caller computed. Skips frames without a `created` value: a silence
 * is measured in ms and an unknown-time frame cannot bound a gap. An id-less
 * frame advances `lastAt` but not `lastEventID`: a silence needs a real id on
 * the from side to cite.
 */
export function updateTrack(params: {
  tracks: Map<string, SessionTrack>
  sessionID: string
  frame: Frame
  at: number
  id: string | undefined
  working: boolean
}): Map<string, SessionTrack> {
  const { tracks, sessionID, frame, at, id, working } = params
  if (sessionID === '' || num(frame.created) === undefined) return tracks
  const next: SessionTrack = { lastAt: at, working }
  if (id !== undefined) next.lastEventID = id
  return new Map(tracks).set(sessionID, next)
}

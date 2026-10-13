/**
 * The rollup (design §4.1): SSE frames in, beats out — the same shape as the desk
 * reducer in `src/state/desk.ts`, and like it, pure. No model, no clock, no I/O:
 * every timestamp is a frame's own `created`, so a recording replays to a
 * byte-identical beat list.
 *
 * A beat's name is its first event's id — `b:<event id>` — so a beat is named where it
 * *started*, never where it closed, and its `at` is that same event's `created`. The
 * rules that make that hold:
 *
 *  - Every non-duplicate id is recorded as seen **before** any rule runs, so a frame a
 *    reconnect replays is dropped outright rather than opening a second run.
 *  - A frame with no `id` can never open a run: a run is named by its first event's id, and
 *    such a frame has none to give. It can still raise an immediate beat of its own —
 *    `knocks`, `cut`, `episode-opens` — which takes the fallback name below rather than a
 *    bare `b:`, because a stable unique id beats one that collides, and a beat is never
 *    dropped for want of an id.
 *  - A beat whose first event carries no id at all takes `b:<kind>:<session>:<at>`: ugly,
 *    but stable and unique in every case we can reach.
 *  - An episode opens on the root's `session.created`, its `execution.started` when we
 *    joined after creation, or its first run or call beat — whichever comes first, and once
 *    per root. Being merely the first frame we see opens nothing, so neither a bookkeeping
 *    frame nor a stray `retry.scheduled` on a root we joined mid-turn can open one, while
 *    that root's episode still opens the moment it does some work.
 */

import type { Frame } from '../api/sse'
import type {
  Beat, BeatDetail, BeatKind, NarrativeSnapshot, OpenRun, RollupState, SessionInfo,
} from './types'
import { findGuestCall, foldCall } from './calls'
import { checkSilence, nextWorking, updateTrack } from './silence'

type Data = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const dataOf = (frame: Frame): Data =>
  typeof frame.data === 'object' && frame.data !== null ? (frame.data as Data) : {}

/**
 * A beat's name: its first event's id, so the beat is named where it started and a
 * replay names it the same. Only a beat whose first event has no id at all — reachable
 * only from a frame handed to us without one — takes the fallback.
 */
const beatID = (eventIDs: string[], kind: BeatKind, sessionID: string, at: number): string =>
  eventIDs[0] !== undefined ? `b:${eventIDs[0]}` : `b:${kind}:${sessionID}:${at}`

/**
 * OpenCode prefixes session frames (`session.execution.started`) and the spec writes
 * them without it, so strip the one prefix: both spellings name the same event.
 * (`session.created` becomes `created`; `permission.asked` is already unprefixed.)
 */
const eventType = (type: string): string =>
  type.startsWith('session.') ? type.slice('session.'.length) : type

/** A `user` inbox item is the Human speaking; anything else is the platform talking. */
const userItem = (data: Data): boolean => {
  const item = data.item
  return typeof item === 'object' && item !== null && (item as Data).type === 'user'
}

const formID = (data: Data): string | undefined => {
  const form = data.form
  return typeof form === 'object' && form !== null ? str((form as Data).id) : undefined
}

const setSession = (sessions: Map<string, SessionInfo>, info: SessionInfo): Map<string, SessionInfo> =>
  new Map(sessions).set(info.id, info)

export function createRollup(): RollupState {
  return {
    seenIDs: new Set(), sessions: new Map(), open: new Map(), calls: new Map(),
    roots: new Set(), pending: new Map(), tracks: new Map(),
  }
}

/**
 * Seed from the REST snapshot so a session joined mid-stream still has a root, a
 * parent and a cast member (§4.1). Merged over the current state: a re-seed must not
 * forget a request the stream has already settled, nor an agent the stream learned.
 */
export function seedRollup(state: RollupState, snapshot: NarrativeSnapshot): RollupState {
  const sessions = new Map(state.sessions)
  const roots = new Set(state.roots)
  for (const session of snapshot?.sessions ?? []) {
    if (typeof session?.id !== 'string' || session.id === '') continue
    const known = sessions.get(session.id)
    sessions.set(session.id, { ...known, ...session })
    if (session.parentID === undefined) roots.add(session.id)
  }

  const pending = new Map(state.pending)
  for (const request of snapshot?.permissions ?? []) {
    const requestID = str(request?.requestID)
    const sessionID = str(request?.sessionID)
    if (requestID === undefined || sessionID === undefined) continue
    pending.set(requestID, sessionID)
  }

  return { ...state, sessions, roots, pending }
}

/** Fold one frame into the rollup. Always a new state object, never a mutation. */
export function rollup(state: RollupState, frame: Frame): { state: RollupState; beats: Beat[] } {
  const id = str(frame.id)

  // Dedupe first — before every rule, and before this id is recorded as seen: a
  // reconnect replays frames we have already folded in, and a second pass through
  // one would double every delta and every call in the episode.
  if (id !== undefined && state.seenIDs.has(id)) return { state, beats: [] }
  const seenIDs = id === undefined ? state.seenIDs : new Set(state.seenIDs).add(id)

  const type = eventType(frame.type)
  const data = dataOf(frame)
  const sessionID = str(data.sessionID) ?? ''
  const at = num(frame.created) ?? 0

  let sessions = state.sessions
  let roots = state.roots
  let open = state.open
  let calls = state.calls
  let pending = state.pending
  let tracks = state.tracks
  const beats: Beat[] = []

  // The current session's "working" state, after this frame is processed. Starts
  // from whatever the prior track said, and §4.1's transitions (start/wrap/cut)
  // and the "first frame starts it working" rule set it here.
  const priorTrack = sessionID === '' ? undefined : state.tracks.get(sessionID)
  let working = priorTrack?.working === true

  /** A beat raised by this frame alone: its one event is the frame's own. */
  const raise = (kind: BeatKind, subject: string, detail: BeatDetail): Beat => {
    const eventIDs = id === undefined ? [] : [id]
    return { id: beatID(eventIDs, kind, subject, at), at, eventIDs, kind, sessionID: subject, detail }
  }

  // §4.1 silence — checked at entry, before this frame is processed, so the working
  // state is the prior frame's and the from-side bounding frame is already in the track.
  const silence = checkSilence({ sessionID, at, id, tracks, pending, calls })
  if (silence !== undefined) beats.push(silence)

  /**
   * §4.1: an episode opens on the root's `session.created`, its `execution.started` when
   * we joined after creation, or its first run or call beat — whichever comes first, and
   * once per root. A frame that is merely the first we happen to see opens nothing: a stray
   * `retry.scheduled` on a root we joined mid-turn is not an opening. Callers hold the
   * trigger; this holds the once-per-root rule. Task 2's call beats open the episode from
   * their own emission the same way.
   */
  const openEpisode = (subject: string): void => {
    const info = sessions.get(subject)
    if (info === undefined || info.arrived === true || !roots.has(subject)) return
    sessions = setSession(sessions, { ...info, arrived: true })
    beats.push(raise('episode-opens', subject, { kind: 'episode-opens' }))
  }

  // --- the cast: who this session is, and who its parent is (§4.1 seeding) --------

  if (type === 'created' && sessionID !== '') {
    const known = sessions.get(sessionID)
    const parentID = str(data.parentID)
    sessions = setSession(sessions, {
      ...known, id: sessionID, parentID, agent: str(data.agent) ?? known?.agent,
    })
    if (parentID === undefined) {
      roots = new Set(roots).add(sessionID)
    } else if (roots.has(sessionID)) {
      const next = new Set(roots)
      next.delete(sessionID)
      roots = next
    }
    // §4.1: a guest arrives exactly once, on session.created with a parentID.
    // A seeded guest already existed and never emitted an arrival event.
    // The arrival links to the subagent call whose input named this child.
    if (parentID !== undefined && !known?.arrived) {
      sessions = setSession(sessions, { ...sessions.get(sessionID)!, arrived: true })
      const guestCall = findGuestCall(calls, sessionID)
      beats.push(raise('guest-arrives', sessionID, {
        kind: 'guest-arrives',
        childSessionID: sessionID,
        callID: guestCall?.callID,
      }))
    }
  }

  // `step.started` names the agent and the model; §4.1 absorbs both into the cast
  // (and into nothing else — a step is not an act a viewer can follow).
  if (type === 'step.started' && sessionID !== '') {
    const known = sessions.get(sessionID)
    if (known !== undefined) {
      sessions = setSession(sessions, {
        ...known, agent: str(data.agent) ?? known.agent, model: str(data.model) ?? known.model,
      })
    }
  }

  // --- an episode opens (§4.1, §5.6) -----------------------------------------------
  // Two of the three triggers live here: the root's own `session.created`, and its
  // `execution.started` when we joined after creation. The third — its first run or call
  // beat — is raised where that beat is emitted, further down.

  if (type === 'created' || type === 'execution.started') openEpisode(sessionID)

  // --- the beats that need no history (§4.1) --------------------------------------
  // §4.1's absorbed frames — `step.*`, `usage.updated`, `inbox.delivered`,
  // `instructions`/`project`/`provider`/`model.updated`, `server.connected`,
  // `tool.input.delta`/`.ended`, `tool.called`, `tool.progress`, `shell.*`,
  // `compaction.ended`, session deletes, heartbeats — raise nothing and are simply not
  // matched below. `compaction.ended` is absent because it *closes* the memory-wipe: that
  // is one beat, raised by `compaction.started`, never two. Task 2 joins the call frames.

  if (type === 'inbox.enqueued' && userItem(data)) {
    // A user item on a root is the Human asking; on a child it is the briefing that
    // hired the guest. A session we know nothing about is taken for a root: only the
    // seed or a `session.created` can make a session somebody's guest.
    const root = roots.has(sessionID) || !sessions.has(sessionID)
    beats.push(root
      ? raise('human-asks', sessionID, { kind: 'human-asks' })
      : raise('briefing', sessionID, { kind: 'briefing', childSessionID: sessionID }))
  }

  const asked = type === 'permission.asked'
    ? str(data.id) ?? str(data.requestID)
    : type === 'form.created' ? formID(data) : undefined
  if (asked !== undefined) {
    pending = new Map(pending).set(asked, sessionID)
    beats.push(raise('knocks', sessionID, { kind: 'knocks', requestID: asked }))
  }

  const settled = type === 'permission.replied'
    ? str(data.requestID)
    : type === 'form.replied' || type === 'form.cancelled' ? str(data.id) : undefined
  if (settled !== undefined) {
    // A reply names the request, not always the session; the ask we recorded does.
    const askedIn = pending.get(settled) ?? ''
    const next = new Map(pending)
    next.delete(settled)
    pending = next
    beats.push(raise('answered', sessionID !== '' ? sessionID : askedIn, {
      kind: 'answered',
      // A form's reply carries no value we can name, so it stays empty rather than
      // being filled with an invented one.
      reply: str(data.reply) ?? '',
    }))
  }

  if (type === 'retry.scheduled') {
    beats.push(raise('retry', sessionID, { kind: 'retry', attempt: num(data.attempt) ?? 0 }))
  }

  // `compaction.ended` is absorbed above: the memory-wipe was raised by `.started`.
  if (type === 'compaction.started') {
    beats.push(raise('memory-wipe', sessionID, { kind: 'memory-wipe' }))
  }

  if (type === 'execution.succeeded') {
    beats.push(raise('wrap', sessionID, { kind: 'wrap' }))
  }

  // OpenCode does not count a shutdown as a failure (`src/state/desk.ts`), and §4.1
  // agrees the session merely stopped — but the story still stops, so it is a cut,
  // carrying the reason.
  if (type === 'execution.failed' || type === 'execution.interrupted') {
    beats.push(raise('cut', sessionID, { kind: 'cut', reason: str(data.reason) ?? '' }))
  }

  // §4.1 working-flag transitions are centralised in silence.ts; the track update
  // runs last so the *next* frame's silence check sees the post-process state.
  working = nextWorking({ sessionID, type, prior: priorTrack, working })

  // --- calls: tool uses and subagent guests, joined by the call's id (§4.1) --------
  const callResult = foldCall({ calls, frame, sessionID, at, openEpisode, beatID })
  calls = callResult.calls
  beats.push(...callResult.beats)

  // --- runs: a think or a say, from its first frame to its last (§4.1) -------------
  // A run opens on `X.started`, or on the first `X.delta` when we joined mid-run, and
  // closes on `X.ended`. Its beat is emitted at the close, because only then is the delta
  // count known, but it is named where it started — the frame that opened it, which is
  // the first event of its range: nothing outside the run joins `eventIDs`. A run beat is
  // also a root's third way to open its episode, so it is raised just before the beat.

  const part = type.endsWith('.started') ? 'started'
    : type.endsWith('.delta') ? 'delta'
    : type.endsWith('.ended') ? 'ended'
    : undefined
  const runKind: OpenRun['kind'] | undefined = part === undefined ? undefined
    : type.startsWith('reasoning.') ? 'thinks'
    : type.startsWith('text.') ? 'says'
    : undefined
  if (part !== undefined && runKind !== undefined) {
    const key = `${sessionID}\u0000${runKind}`
    const current = open.get(key)
    if (part === 'ended') {
      if (current !== undefined) {
        const next = new Map(open)
        next.delete(key)
        open = next
        const eventIDs = id === undefined ? current.eventIDs : [...current.eventIDs, id]
        openEpisode(current.sessionID) // §4.1: this may be the root's first beat
        beats.push({
          id: beatID(eventIDs, current.kind, current.sessionID, current.at),
          at: current.at,
          eventIDs,
          kind: current.kind,
          sessionID: current.sessionID,
          detail: id === undefined
            ? { kind: current.kind, deltas: current.deltas }
            : { kind: current.kind, deltas: current.deltas, endedEventID: id },
        })
      }
    } else if (current !== undefined) {
      // A delta is counted and joins the run; the run keeps the name it was raised with.
      // An id-less delta still counts as a delta — it happened — it just cannot be cited.
      open = new Map(open).set(key, {
        ...current,
        eventIDs: id === undefined ? current.eventIDs : [...current.eventIDs, id],
        deltas: current.deltas + (part === 'delta' ? 1 : 0),
      })
    } else if (id !== undefined) {
      // We joined mid-run: no `X.started` was seen, so this first delta raises the run.
      // A frame with no id cannot — there would be nothing to name the beat by.
      open = new Map(open).set(key, {
        sessionID, kind: runKind, at, eventIDs: [id],
        deltas: part === 'delta' ? 1 : 0,
      })
    }
  }

  // --- the session's working track, updated last so it reflects the post-process state
  // A session joined mid-stream (or never seen) becomes working on its first frame, so
  // a future gap is eligible. `lastAt`/`lastEventID` are this frame's, so the next
  // silence is measured against the right boundary. An id-less frame advances `lastAt`
  // but not `lastEventID`: a silence needs a real id on the from side to cite.
  tracks = updateTrack({ tracks, sessionID, frame, at, id, working })

  return { state: { seenIDs, sessions, open, calls, roots, pending, tracks }, beats }
}

/**
 * §4.1's flush, at stream end: open runs close with the events they have. A call with
 * no success produces no beat, and neither does a session that never wrapped — the
 * footage simply stops, which is the next slice's business to narrate, not this one's.
 *
 * A root whose first beat is one of these was opened by nothing else, so its opener is
 * raised here too — once per root, just before the beat that earned it. It has no frame
 * of its own to be named by, so it takes the fallback name.
 */
export function flush(state: RollupState): Beat[] {
  const beats: Beat[] = []
  const opened = new Set<string>()
  for (const run of state.open.values()) {
    const info = state.sessions.get(run.sessionID)
    if (info !== undefined && info.arrived !== true && state.roots.has(run.sessionID) && !opened.has(run.sessionID)) {
      opened.add(run.sessionID)
      beats.push({
        id: beatID([], 'episode-opens', run.sessionID, run.at),
        at: run.at,
        eventIDs: [],
        kind: 'episode-opens',
        sessionID: run.sessionID,
        detail: { kind: 'episode-opens' },
      })
    }
    beats.push({
      id: beatID(run.eventIDs, run.kind, run.sessionID, run.at),
      at: run.at,
      eventIDs: run.eventIDs,
      kind: run.kind,
      sessionID: run.sessionID,
      detail: { kind: run.kind, deltas: run.deltas },
    })
  }
  return beats
}

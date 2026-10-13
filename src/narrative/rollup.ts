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
 *  - A frame with no `id` can never open a run: there is nothing to name it by, and an id we
 *    never recorded cannot be deduped, so a replay of it would raise the beat twice. Such a
 *    frame only ever joins a beat another frame started.
 *  - A beat whose first event has no id at all — an immediate beat raised by an id-less
 *    frame — falls back to `b:<kind>:<session>:<at>`: ugly, but stable and unique in every
 *    case we can reach, which a bare `b:` is not. Beats are never dropped for want of an id:
 *    losing real work because the platform omitted one is the worse failure.
 *  - `episode-opens` is raised by the first frame that shows a session we joined, id or no id,
 *    because §4.1 has the episode open — which is where that fallback earns its keep.
 */

import type { Frame } from '../api/sse'
import type {
  Beat, BeatDetail, BeatKind, NarrativeSnapshot, OpenRun, RollupState, SessionInfo,
} from './types'

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

/**
 * §4.1's "absorbed without a beat": they raise nothing of their own, and — the one
 * place this list is read — they cannot be the frame that announces a session we
 * joined, because bookkeeping is not an act. `compaction.ended` is here because it
 * *closes* the memory-wipe: that is one beat, raised by `compaction.started`, not two.
 */
const ABSORBED = new Set([
  'step.started', 'step.ended', 'step.streamed', 'usage.updated',
  'inbox.delivered', 'instructions.updated', 'project.updated', 'provider.updated',
  'model.updated', 'server.connected', 'deleted',
  'tool.input.delta', 'tool.input.ended', 'tool.called', 'tool.progress',
  'shell.created', 'shell.exited', 'shell.deleted',
  'compaction.ended',
])

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
    seenIDs: new Set(), sessions: new Map(), open: new Map(),
    roots: new Set(), pending: new Map(),
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
  let pending = state.pending
  const beats: Beat[] = []

  /** A beat raised by this frame alone: its one event is the frame's own. */
  const raise = (kind: BeatKind, subject: string, detail: BeatDetail): Beat => {
    const eventIDs = id === undefined ? [] : [id]
    return { id: beatID(eventIDs, kind, subject, at), at, eventIDs, kind, sessionID: subject, detail }
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

  // --- an episode opens, a guest arrives (§4.1, §5.6) -----------------------------
  // A root we were seeded with has no `session.created` here, so it opens the episode
  // on the frame that shows it working. A guest we were seeded with has nothing to
  // announce it at all, so it arrives on the first of its own frames we see — except
  // its briefing, because on a child the user inbox item *is* the arrival, and two
  // beats for one moment would narrate it twice.
  const info = sessionID === '' ? undefined : sessions.get(sessionID)
  if (info !== undefined && info.arrived !== true) {
    const isRoot = roots.has(sessionID)
    const briefing = type === 'inbox.enqueued' && userItem(data)
    const opens = isRoot
      ? type === 'created' || type === 'execution.started'
      : !briefing && !ABSORBED.has(type)
    if (opens || briefing) sessions = setSession(sessions, { ...info, arrived: true })
    if (opens) {
      beats.push(isRoot
        ? raise('episode-opens', sessionID, { kind: 'episode-opens' })
        : raise('guest-arrives', sessionID, { kind: 'guest-arrives', childSessionID: sessionID }))
    }
  }

  // --- the beats that need no history (§4.1) --------------------------------------

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

  // --- runs: a think or a say, from its first frame to its last (§4.1) -------------
  // A run opens on `X.started`, or on the first `X.delta` when we joined mid-run, and
  // closes on `X.ended`. Its beat is emitted at the close, because only then is the delta
  // count known, but it is named where it started — the frame that opened it, which is
  // the first event of its range: nothing outside the run joins `eventIDs`.

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

  return { state: { seenIDs, sessions, open, roots, pending }, beats }
}

/**
 * §4.1's flush, at stream end: open runs close with the events they have. A call with
 * no success produces no beat, and neither does a session that never wrapped — the
 * footage simply stops, which is the next slice's business to narrate, not this one's.
 */
export function flush(state: RollupState): Beat[] {
  const beats: Beat[] = []
  for (const run of state.open.values()) {
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

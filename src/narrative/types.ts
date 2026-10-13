/**
 * The narrative layer's data model — spec §6, plus the state the rollup keeps
 * between frames. Declarations only: nothing here runs, and nothing here reads a
 * clock, a model or a file.
 */

/** The sixteen beat kinds of §4.1 — one row each. */
export type BeatKind =
  | 'episode-opens'
  | 'human-asks'
  | 'briefing'
  | 'thinks'
  | 'says'
  | 'uses-tool'
  | 'tool-fails'
  | 'guest-arrives'
  | 'guest-leaves'
  | 'knocks'
  | 'answered'
  | 'retry'
  | 'memory-wipe'
  | 'wrap'
  | 'cut'
  | 'silence'

/** §6's `BeatDetail`, verbatim. */
export type BeatDetail =
  | { kind: 'thinks' | 'says'; deltas: number; endedEventID?: string }
  | { kind: 'uses-tool' | 'tool-fails'; tool: string | 'unknown'; callID: string; path?: string; exit?: number }
  | { kind: 'guest-arrives' | 'guest-leaves' | 'briefing'; childSessionID: string; callID?: string }
  | { kind: 'knocks'; requestID: string }
  | { kind: 'answered'; reply: string }
  | { kind: 'retry'; attempt: number }
  | { kind: 'cut'; reason: string }
  | { kind: 'silence'; fromEventID: string; toEventID: string }
  | { kind: 'episode-opens' | 'human-asks' | 'memory-wipe' | 'wrap' }

export type Beat = {
  /**
   * `b:<the beat's first event id>` — where the beat *started*, which for a run is its
   * opening frame, never the frame that closed it. When that first event carries no id
   * at all the id is `b:<kind>:<session>:<at>`: ugly but stable and unique, because a
   * beat is never dropped for want of an id.
   */
  id: string
  /** `created` of the beat's first event — the run's start for a run. 0 if the wire carried none. */
  at: number
  /** Every event id joined into this beat, in arrival order: a think of 317 deltas cites 317. */
  eventIDs: string[]
  kind: BeatKind
  /** The session the beat happened in. A beat always belongs to one worker's desk. */
  sessionID: string
  detail: BeatDetail
}

/** What the rollup knows about one worker: from the seed, from `session.created`, from `step.started`. */
export type SessionInfo = {
  id: string
  /** Absent means root: an episode is one root session, and guests carry their parent (§5.6). */
  parentID?: string
  agent?: string
  model?: string
  /** True once this session's arrival beat has been raised, so it is raised exactly once. */
  arrived?: boolean
}

/** A think or a say, open between its first frame and its close. */
export type OpenRun = {
  sessionID: string
  kind: 'thinks' | 'says'
  at: number
  eventIDs: string[]
  /** Deltas only: the frames that carried the worker's actual words. */
  deltas: number
}

/**
 * The session's `execution.started` frame — the start of its latest turn of work.
 * It raises no beat of its own (§4.1 absorbs it), but the first run raised inside that
 * turn is named there, because a run is named where its work began.
 */
export type Turn = { id?: string; at: number }

/** The rollup's whole memory. Replaced, never mutated — the reducer stays pure. */
export type RollupState = {
  /** Every event id already folded in: a reconnect replays frames we have already seen. */
  seenIDs: Set<string>
  sessions: Map<string, SessionInfo>
  /**
   * Runs that are still open, keyed by session and kind — a session can be thinking
   * and speaking at once, and neither run may lose its own frames to the other.
   */
  open: Map<string, OpenRun>
  /** Sessions with no parent: an episode is one root session (§5.6). */
  roots: Set<string>
  /** Requests asked and not yet answered, requestID → sessionID: the audience is being asked. */
  pending: Map<string, string>
  /** Each session's open turn of work, waiting for the first run it names. */
  turn: Map<string, Turn>
}

/**
 * The REST snapshot §4.1 seeds from, re-taken on every reconnect: sessions with a
 * parent and an agent, and the requests still open. Deliberately not
 * `src/state/seed.ts`'s `SessionSnapshot`, which carries neither parent nor agent.
 */
export type NarrativeSnapshot = {
  sessions: SessionInfo[]
  permissions: { requestID: string; sessionID: string }[]
}

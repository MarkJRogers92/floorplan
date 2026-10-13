/**
 * Call join logic (design §4.1). Fold `tool.*` and `shell.exited` frames into
 * `uses-tool`, `tool-fails` and `guest-leaves` beats, keyed by the call's id.
 *
 * Kept separate from `rollup.ts` so the file stays under the project's size limit.
 */

import type { Frame } from '../api/sse'
import type { Beat, BeatDetail, BeatKind, OpenCall } from './types'

type Data = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const dataOf = (frame: Frame): Data =>
  typeof frame.data === 'object' && frame.data !== null ? (frame.data as Data) : {}

/**
 * OpenCode prefixes session frames (`session.execution.started`) and the spec writes
 * them without it, so strip the one prefix: both spellings name the same event.
 */
const eventType = (type: string): string =>
  type.startsWith('session.') ? type.slice('session.'.length) : type

const metadataOf = (data: Data): Data =>
  typeof data.metadata === 'object' && data.metadata !== null ? (data.metadata as Data) : {}

const inputSessionIDOf = (data: Data): string | undefined => {
  const input = typeof data.input === 'object' && data.input !== null ? (data.input as Data) : {}
  return str(input.sessionID)
}

/**
 * The exit code a tool result reports: the frame's own `metadata.exit` first (always
 * present at decision time), then the `shell.exited` code joined onto the call.
 */
const exitCode = (data: Data, call?: OpenCall): number | undefined =>
  num(metadataOf(data).exit) ?? call?.exit

/**
 * §4.1, amended by the Task 4 recording: a non-zero shell exit arrives as a
 * `tool.success` carrying `metadata.exit` — never as `tool.failed` — and its
 * `shell.exited` frame can arrive *after* the success (22 ms late in the fixture).
 * So `tool-fails` is raised by `tool.failed` **and** by a `tool.success` whose
 * reported exit code is non-zero, from either source.
 */
export const raisesToolFails = (frameType: string, frameData: Data, call?: OpenCall): boolean => {
  if (frameType === 'tool.failed') return true
  if (frameType !== 'tool.success') return false
  const exit = exitCode(frameData, call)
  return exit !== undefined && exit !== 0
}

/**
 * Find the subagent call whose input names this child, if any. Arrivals are linked to
 * a call only by that call's `input.sessionID`, never by "the parent's open call".
 */
export function findGuestCall(calls: Map<string, OpenCall>, childSessionID: string): OpenCall | undefined {
  for (const call of calls.values()) {
    if (call.tool === 'subagent' && call.inputSessionID === childSessionID) return call
  }
  return undefined
}

/**
 * Fold one frame's worth of call state. Returns the new calls map and any beats emitted.
 */
export function foldCall(params: {
  calls: Map<string, OpenCall>
  frame: Frame
  sessionID: string
  at: number
  openEpisode: (subject: string, openerEventIDs?: string[]) => void
  beatID: (eventIDs: string[], kind: BeatKind, sessionID: string, at: number) => string
}): { calls: Map<string, OpenCall>; beats: Beat[] } {
  const { calls: initialCalls, frame, sessionID, at, openEpisode, beatID } = params
  let calls = initialCalls
  const beats: Beat[] = []

  const type = eventType(frame.type)
  const data = dataOf(frame)
  const id = str(frame.id)
  const callID = str(data.id)

  if (type === 'tool.input.started' && callID !== undefined && sessionID !== '') {
    const tool = str(data.name)
    const existing = calls.get(callID)
    const eventIDs = existing
      ? (id === undefined ? existing.eventIDs : [...existing.eventIDs, id])
      : (id === undefined ? [] : [id])
    calls = new Map(calls).set(callID, {
      sessionID,
      callID,
      at: existing?.at ?? at,
      tool: tool ?? existing?.tool,
      inputSessionID: inputSessionIDOf(data) ?? existing?.inputSessionID,
      eventIDs,
      shellID: existing?.shellID,
      exit: existing?.exit,
    })
  }

  if (type === 'tool.called' && callID !== undefined) {
    const existing = calls.get(callID)
    if (existing !== undefined) {
      calls = new Map(calls).set(callID, {
        ...existing,
        eventIDs: id === undefined ? existing.eventIDs : [...existing.eventIDs, id],
        inputSessionID: inputSessionIDOf(data) ?? existing.inputSessionID,
      })
    }
  }

  if (type === 'tool.progress' && callID !== undefined) {
    const existing = calls.get(callID)
    if (existing !== undefined) {
      const metadata = metadataOf(data)
      calls = new Map(calls).set(callID, {
        ...existing,
        eventIDs: id === undefined ? existing.eventIDs : [...existing.eventIDs, id],
        shellID: str(metadata.shellID) ?? existing.shellID,
      })
    }
  }

  if (type === 'shell.exited') {
    const shellID = str(data.id)
    if (shellID !== undefined) {
      for (const [cid, call] of calls) {
        if (call.shellID === shellID) {
          calls = new Map(calls).set(cid, {
            ...call,
            eventIDs: id === undefined ? call.eventIDs : [...call.eventIDs, id],
            exit: num(data.exit) ?? call.exit,
          })
          break
        }
      }
    }
  }

  if (type === 'tool.success' || type === 'tool.failed') {
    const existing = callID !== undefined ? calls.get(callID) : undefined
    const metadata = metadataOf(data)
    const childSessionID = str(metadata.sessionID)
    const eventIDs = existing
      ? (id === undefined ? existing.eventIDs : [...existing.eventIDs, id])
      : (id === undefined ? [] : [id])
    if (callID !== undefined) {
      const nextCalls = new Map(calls)
      nextCalls.delete(callID)
      calls = nextCalls
    }
    const callAt = existing?.at ?? at
    const exit = exitCode(data, existing)

    // §4.1: a call beat may be the root's first beat. If we joined the call
    // mid-stream, its beat will be named by this frame's id; spend the opener
    // with no event id so the two never collide.
    openEpisode(sessionID, existing === undefined ? [] : undefined)

    if (raisesToolFails(type, data, existing)) {
      const detail: BeatDetail = {
        kind: 'tool-fails',
        tool: str(data.name) ?? existing?.tool ?? 'unknown',
      }
      if (callID !== undefined) detail.callID = callID
      if (exit !== undefined) detail.exit = exit
      beats.push({
        id: beatID(eventIDs, 'tool-fails', sessionID, callAt),
        at: callAt,
        eventIDs,
        kind: 'tool-fails',
        sessionID,
        detail,
      })
    } else if (existing?.tool === 'subagent' && childSessionID !== undefined) {
      beats.push({
        id: beatID(eventIDs, 'guest-leaves', sessionID, callAt),
        at: callAt,
        eventIDs,
        kind: 'guest-leaves',
        sessionID,
        detail: { kind: 'guest-leaves', childSessionID, callID },
      })
    } else {
      // A subagent success whose child id is missing cannot be narrated as a departure;
      // degrade to an unknown tool use rather than inventing a child session id.
      const tool = existing?.tool === 'subagent' ? 'unknown' : str(data.name) ?? existing?.tool ?? 'unknown'
      const detail: BeatDetail = { kind: 'uses-tool', tool }
      if (callID !== undefined) detail.callID = callID
      if (existing?.exit !== undefined) detail.exit = existing.exit
      beats.push({
        id: beatID(eventIDs, 'uses-tool', sessionID, callAt),
        at: callAt,
        eventIDs,
        kind: 'uses-tool',
        sessionID,
        detail,
      })
    }
  }

  return { calls, beats }
}

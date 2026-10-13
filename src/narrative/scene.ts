/** Deterministic scene cuts (§4.2). Never sort: arrival/briefing order is footage. */
import { castByRoot, rootFor, type CastID } from './cast'
import type { Beat, SessionInfo } from './types'

export type Location = { kind: 'desk'; sessionID: string } | { kind: 'to-camera' }
export type Scene = {
  id: string
  location: Location
  rootSessionID: string
  cast: CastID[]
  beats: string[]
}

export function assembleScenes(beats: Beat[], sessions: SessionInfo[]): Scene[] {
  const index = new Map(sessions.map(s => [s.id, s]))
  const cast = castByRoot(sessions)
  const scenes: Scene[] = []
  let current: Scene | undefined
  let startAt = 0
  for (const beat of beats) {
    const detail = beat.detail
    const desk = 'childSessionID' in detail ? detail.childSessionID : beat.sessionID
    // Departures belong to the parent's episode even if the child was not in the snapshot.
    const root = rootFor(beat.sessionID, index)
    const boundary = beat.kind === 'guest-arrives' || beat.kind === 'guest-leaves' ||
      (beat.sessionID === root && ['human-asks', 'wrap', 'cut'].includes(beat.kind))
    if (!current || boundary || current.rootSessionID !== root ||
        current.location.kind !== 'desk' || current.location.sessionID !== desk ||
        current.beats.length >= 12 || beat.endAt - startAt >= 90_000) {
      current = { id: `scene:${beat.id}`, location: { kind: 'desk', sessionID: desk },
        rootSessionID: root, cast: [], beats: [] }
      startAt = beat.at
      scenes.push(current)
    }
    current.beats.push(beat.id)
    for (const sessionID of new Set([beat.sessionID, desk])) {
      const member = cast(sessionID)
      if (!current.cast.includes(member)) current.cast.push(member)
    }
  }
  return scenes
}

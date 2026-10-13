import { rootFor } from '../narrative/cast'
import type { Beat, SessionInfo } from '../narrative/types'

/** Hidden jobs must not become either visible narration or billable Director evidence. */
export function beatsForWork(beats: Beat[], sessions: Map<string, SessionInfo>, selected: string, replay: boolean): Beat[] {
  return replay || !selected ? beats : beats.filter(beat => rootFor(beat.sessionID, sessions) === selected)
}

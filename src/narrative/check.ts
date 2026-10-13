/** Composition checks (§5.2). Input lines have already survived renderLine; no re-lint. */
import type { Line } from './line'
import type { Scene } from './scene'
import type { Beat } from './types'

export type CheckResult = { ok: boolean; failures: string[] }
type CheckCtx = {
  beats: Map<string, Beat>
  /** Resolved CastIDs, including per-chat suffixes; unknown maps to unidentified. */
  agents: Map<string, string | undefined>
  episodeBeatIDs: Set<string>
}

export function checkScene(scene: Scene, lines: Line[], ctx: CheckCtx): CheckResult {
  const failures: string[] = []
  const castOf = (beat: Beat) => ctx.agents.get(beat.sessionID) ?? 'unidentified'
  const present = new Set<string>()
  for (const id of scene.beats) {
    const beat = ctx.beats.get(id)
    if (!beat || !ctx.episodeBeatIDs.has(id)) failures.push(`${scene.id}: missing scene evidence ${id}`)
    if (beat) present.add(castOf(beat))
  }
  let previousAnchor = -Infinity
  const cited = new Set<string>()
  for (const line of lines) {
    if (!line.cites.length) failures.push(`${line.id}: no cited footage`)
    const footage: Beat[] = []
    for (const id of line.cites) {
      const beat = ctx.beats.get(id)
      if (!beat) failures.push(`${line.id}: missing beat ${id}`)
      if (!ctx.episodeBeatIDs.has(id)) failures.push(`${line.id}: cite outside episode ${id}`)
      if (beat) footage.push(beat)
      cited.add(id)
    }
    if (line.speaker !== 'narrator' && footage.some(b => castOf(b) !== line.speaker)) {
      failures.push(`${line.id}: speaker does not match footage`)
    }
    for (const slot of line.template.matchAll(/\{agent:([^}]+)\}/g)) {
      const subject = ctx.beats.get(slot[1].trim())
      if (!subject || footage.some(b => castOf(b) !== castOf(subject))) {
        failures.push(`${line.id}: agent slot does not match footage`)
      }
    }
    const anchor = Math.max(...footage.map(b => b.at))
    if (anchor < previousAnchor && !line.flashback) failures.push(`${line.id}: out of time order`)
    previousAnchor = Math.max(previousAnchor, anchor)
    if (line.speaker !== 'narrator' && (!scene.cast.includes(line.speaker) || !present.has(line.speaker))) {
      failures.push(`${line.id}: speaker is not in the room`)
    }
  }
  for (const id of scene.beats) {
    const beat = ctx.beats.get(id)
    if (beat && ['tool-fails', 'cut', 'knocks'].includes(beat.kind) && !cited.has(id)) {
      failures.push(`${scene.id}: buried ${beat.kind} ${id}`)
    }
  }
  return { ok: failures.length === 0, failures }
}

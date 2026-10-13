/** Model output is untrusted. This is the sole admission path to a Director scene. */
import { castByRoot } from './cast'
import { checkScene } from './check'
import { renderLine, type Line } from './line'
import { assembleScript, type ScriptLine } from './script'
import type { Scene } from './scene'
import type { Beat, SessionInfo } from './types'

export type DirectorResult = { lines: ScriptLine[]; mode: 'director' | 'templates' }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const unsupported = /\{(?:ordinal|first|last|never|cost):/
const outcomeWords = /\b(?:succeeded|success|successfully|failed|failure|interrupted|approved|denied|rejected|cancelled|exit)\b/i

export function checkDirectorLines(scene: Scene, output: unknown, beats: Beat[], sessions: SessionInfo[]): DirectorResult {
  const ids = new Set(scene.beats)
  const evidence = beats.filter(b => ids.has(b.id))
  const index = new Map(evidence.map(b => [b.id, b]))
  const cast = castByRoot(sessions)
  const ctx = { cast, beats: evidence }
  const templates = () => {
    let anchor = -Infinity
    return assembleScript(evidence, ctx).map(line => {
      const at = index.get(line.beatIDs[0])!.at
      const flashback = at < anchor
      anchor = Math.max(anchor, at)
      return flashback ? { ...line, line: { ...line.line, flashback: true as const } } : line
    })
  }
  const fallback = (): DirectorResult => ({ lines: templates(), mode: 'templates' })
  if (!object(output) || !Array.isArray(output.lines) || !output.lines.length || output.lines.length > 24) return fallback()
  const names = [...sessions.flatMap(s => [s.agent, s.model]), ...evidence.map(b => 'tool' in b.detail ? b.detail.tool : undefined)]
    .filter((name): name is string => Boolean(name))
  const literalName = (free: string) => names.some(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`, 'i').test(free)
  })
  const lines: ScriptLine[] = []
  for (const [i, raw] of output.lines.entries()) {
    if (!object(raw) || typeof raw.speaker !== 'string' || !raw.speaker || raw.speaker.length > 128 ||
        typeof raw.template !== 'string' || !raw.template.trim() || raw.template.length > 2000 ||
        !Array.isArray(raw.cites) || !raw.cites.length || raw.cites.length > 12 ||
        raw.cites.some(id => typeof id !== 'string' || !ids.has(id)) ||
        (raw.flashback !== undefined && typeof raw.flashback !== 'boolean')) continue
    const free = raw.template.replace(/\{[^}]*\}/g, '')
    if (unsupported.test(raw.template) || outcomeWords.test(free) || literalName(free)) continue
    const line: Line = { id: `director:${scene.id}:${i}`, speaker: raw.speaker, template: raw.template, cites: raw.cites as string[] }
    if (raw.flashback === true) line.flashback = true
    const rendered = renderLine(line, index, ctx)
    if (!('rejected' in rendered)) lines.push({ line, ...rendered, beatIDs: line.cites })
  }
  if (!lines.length) return fallback()
  const covered = new Set(lines.flatMap(l => l.beatIDs))
  const anchorOf = (line: ScriptLine) => Math.max(...line.beatIDs.map(id => index.get(id)!.at))
  for (const template of assembleScript(evidence.filter(b => !covered.has(b.id)), ctx)) {
    const insertion = lines.findIndex(line => !line.line.flashback && anchorOf(line) >= anchorOf(template))
    lines.splice(insertion < 0 ? lines.length : insertion, 0, template)
  }
  const agents = new Map(sessions.map(s => [s.id, cast(s.id)]))
  if (!checkScene(scene, lines.map(l => l.line), { beats: index, agents, episodeBeatIDs: ids }).ok) return fallback()
  return { lines, mode: 'director' }
}

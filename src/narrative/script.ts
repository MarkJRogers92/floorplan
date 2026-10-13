/**
 * The script (design §6 ruling 13's first rendering, §5.1). `assembleScript` maps beats
 * through a template to a `Line`, asks `renderLine` to prove and render it, drops the
 * lines that cannot be proved, and carries each survivor's `cites` through as
 * `beatIDs` — which the page shows on hover, so a reader can trace every line back to
 * the events it describes.
 *
 * The template is a parameter, not a buried import: a test can inject one with no
 * model and no fixture, and the Director will take the same seat later (§4.2).
 */

import type { CastID } from './cast'
import { renderLine, type Line, type Rendered } from './line'
import { templateFor as defaultTemplateFor } from './templates'
import type { Beat } from './types'

export type ScriptCtx = { cast: (sessionID: string) => CastID; beats: Beat[] }

export type ScriptLine = {
  line: Line
  text: string
  delivery: Rendered['delivery']
  beatIDs: string[]
}

export type TemplateFor = (beat: Beat, ctx: ScriptCtx) => Line

/**
 * Beats → the script, in beat order. A rejected line is dropped, never repaired (§5.1):
 * a missing joke costs nothing, a wrong one breaks the premise.
 */
export function assembleScript(
  beats: Beat[],
  ctx: ScriptCtx,
  templateFor: TemplateFor = defaultTemplateFor,
): ScriptLine[] {
  const index = new Map(beats.map(beat => [beat.id, beat]))
  const script: ScriptLine[] = []
  for (const beat of beats) {
    const line = templateFor(beat, ctx)
    const rendered = renderLine(line, index, ctx)
    if ('rejected' in rendered) continue
    script.push({ line, text: rendered.text, delivery: rendered.delivery, beatIDs: line.cites })
  }
  return script
}

/**
 * A scene heading (§6 `Scene.heading`, §4.2 grouping by location only): the scene's
 * first beat, rendered through the same checker as any other line. The location this
 * slice recognises is the session's desk, so the heading is that desk's cast name —
 * the `{agent:}` slot's own output, never an invented title.
 */
export function sceneHeadingFor(beat: Beat, ctx: ScriptCtx): ScriptLine {
  const templateFor: TemplateFor = b => ({
    id: `scene-${b.id}`,
    speaker: 'narrator',
    template: `{agent:${b.id}}`,
    cites: [b.id],
  })
  return assembleScript([beat], ctx, templateFor)[0]!
}

import { castByRoot } from './cast'
import { checkScene } from './check'
import { checkDirectorLines } from './director'
import type { Line } from './line'
import { assembleEpisodes } from './episode'
import { assembleScenes } from './scene'
import { assembleScript, markFlashbacks, sceneHeadingFor, type ScriptLine } from './script'
import type { Beat, SessionInfo } from './types'

/** Group by the first cite; unknown footage stays visible instead of disappearing. */
export function groupLinesByScene<S extends { id: string; beats: string[] }>(scenes: S[], lines: ScriptLine[]) {
  const groups: { scene: S | undefined; lines: ScriptLine[] }[] = scenes.map(scene => ({ scene, lines: [] }))
  const owners = new Map<string, number>()
  scenes.forEach((scene, i) => scene.beats.forEach(id => owners.set(id, i)))
  const ungrouped: ScriptLine[] = []
  for (const line of lines) {
    const index = owners.get(line.beatIDs[0])
    if (index === undefined) ungrouped.push(line)
    else groups[index].lines.push(line)
  }
  if (ungrouped.length) groups.push({ scene: undefined, lines: ungrouped })
  return groups
}

/** The same pure view drives the page and the golden replay tests. */
export function assembleEpisodeViews(beats: Beat[], sessions: SessionInfo[], replacements: Map<string, Line[]> = new Map()) {
  const scenes = assembleScenes(beats, sessions)
  const cast = castByRoot(sessions)
  const index = new Map(beats.map(b => [b.id, b]))
  const agents = new Map(sessions.map(s => [s.id, cast(s.id)]))
  return assembleEpisodes(scenes).map(episode => {
    const episodeScenes = scenes.filter(s => s.rootSessionID === episode.rootSessionID)
    const episodeBeatIDs = new Set(episodeScenes.flatMap(s => s.beats))
    const episodeBeats = beats.filter(b => episodeBeatIDs.has(b.id))
    const ctx = { cast, beats: episodeBeats }
    const script = assembleScript(episodeBeats, ctx)
    const groups = groupLinesByScene(episodeScenes, script)
    const rootBeat = episodeBeats.find(b => b.sessionID === episode.rootSessionID)
    const first = rootBeat ?? episodeBeats[0]
    const heading = assembleScript([first], ctx, beat => ({
      id: `heading:${episode.id}`, speaker: 'narrator', cites: [beat.id],
      template: rootBeat ? `Episode: {agent:${beat.id}}` : 'Episode.',
    }))[0]
    return { episode, heading, scenes: episodeScenes.map((scene, i) => {
      const replacement = replacements.get(scene.id)
      const result = replacement ? checkDirectorLines(scene, { lines: replacement }, episodeBeats, sessions) : undefined
      let lines = result?.lines ?? markFlashbacks(groups[i].lines, index)
      let mode = result?.mode ?? 'templates'
      const opening = index.get(scene.beats[0])!
      const desk = scene.location.kind === 'desk' ? scene.location.sessionID : opening.sessionID
      const deskBeat = opening.sessionID === desk ? opening : episodeBeats.find(b => b.sessionID === desk)
      const heading = deskBeat ? sceneHeadingFor(deskBeat, ctx) : assembleScript([opening], ctx, beat => ({
        id: `heading:${scene.id}`, speaker: 'narrator', cites: [beat.id], template: 'A guest’s desk.',
      }))[0]
      let check = checkScene(scene, lines.map(l => l.line), { beats: index, agents, episodeBeatIDs })
      if (!check.ok && mode === 'director') {
        lines = markFlashbacks(groups[i].lines, index); mode = 'templates'
        check = checkScene(scene, lines.map(l => l.line), { beats: index, agents, episodeBeatIDs })
      }
      return { scene, heading, lines, mode, check }
    }) }
  })
}

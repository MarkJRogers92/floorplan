import type { CastID } from './cast'
import type { Scene } from './scene'

export type Episode = {
  id: string
  seriesID: string
  rootSessionID: string
  scenes: string[]
  cast: CastID[]
}

/** D2: a chat is an episode, even when it resumes days after a wrap. */
export function assembleEpisodes(scenes: Scene[]): Episode[] {
  const episodes = new Map<string, Episode>()
  for (const scene of scenes) {
    let episode = episodes.get(scene.rootSessionID)
    if (!episode) {
      // Series storage and Director plot labels arrive in slice 3.
      episode = { id: `ep:${scene.rootSessionID}`, seriesID: '', rootSessionID: scene.rootSessionID,
        scenes: [], cast: [] }
      episodes.set(scene.rootSessionID, episode)
    }
    episode.scenes.push(scene.id)
    for (const member of scene.cast) if (!episode.cast.includes(member)) episode.cast.push(member)
  }
  return [...episodes.values()]
}

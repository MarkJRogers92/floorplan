/** Browser-safe projection of the displayed part of read-through context (cast memory). */
import type { Persona } from '../narrative/series'
import { validPersonaText } from '../narrative/series'
import { isRecord, isID } from '../narrative/evidence'
import { validSeriesKey } from '../narrative/scope'

export type CastMemoryContext = {
  key: string
  episodeCount: number
  bibles: { agent: string; episodes: string[] }[]
  personas: Persona[]
}

const MAX_CAST = 8
const MAX_BIBLE_EPISODES = 256

/** An episode ID is "ep:" plus a valid session ID. */
const episodeRoot = (id: unknown): string | undefined =>
  typeof id === 'string' && id.startsWith('ep:') && isID(id.slice(3)) ? id.slice(3) : undefined

const validEpisodeID = (id: unknown): id is string => episodeRoot(id) !== undefined

const namedAgent = (v: unknown): v is string => isID(v) && v !== 'unidentified'

export function parseCastMemoryContext(value: unknown, key: string, root: string): CastMemoryContext | undefined {
  try {
    if (!isRecord(value) || !validSeriesKey(value.key) || value.key !== key || !isID(root) ||
        !Number.isSafeInteger(value.episodeCount) || (value.episodeCount as number) < 0 ||
        !Array.isArray(value.bibles) || value.bibles.length > MAX_CAST ||
        !Array.isArray(value.personas) || value.personas.length > MAX_CAST) return undefined
    const bibles: CastMemoryContext['bibles'] = []
    const bibleAgents = new Set<string>()
    for (const bible of value.bibles) {
      if (!isRecord(bible) || !namedAgent(bible.agent) || bibleAgents.has(bible.agent) ||
          !Array.isArray(bible.episodes) || bible.episodes.length > MAX_BIBLE_EPISODES) return undefined
      const episodes = new Set<string>()
      for (const id of bible.episodes) {
        const episode = episodeRoot(id)
        // The server excludes this root; a current-root appearance is a mismatched read.
        if (typeof id !== 'string' || !episode || episode === root || episodes.has(id)) return undefined
        episodes.add(id)
      }
      bibleAgents.add(bible.agent)
      bibles.push({ agent: bible.agent, episodes: [...episodes] })
    }
    const personas: Persona[] = []
    const personaAgents = new Set<string>()
    for (const p of value.personas) {
      if (!isRecord(p) || !namedAgent(p.agent) || personaAgents.has(p.agent) || !validPersonaText(p.text) ||
          !isRecord(p.debut)) return undefined
      const { episodeID, beatID } = p.debut
      // A debut in the current root is allowed: it is fiction already saved with real proof.
      if (!validEpisodeID(episodeID) || !isID(beatID, 512)) return undefined
      personaAgents.add(p.agent)
      personas.push({ agent: p.agent, text: p.text, debut: { episodeID, beatID } })
    }
    return { key, episodeCount: value.episodeCount as number, bibles, personas }
  } catch { return undefined }
}

export function castMemoryCards(context: CastMemoryContext | undefined, agents: string[]):
  { agent: string; episodes: string[]; persona?: Persona }[] {
  if (!context) return []
  const episodesFor = new Map(context.bibles.map(b => [b.agent, b.episodes]))
  const personaFor = new Map(context.personas.map(p => [p.agent, p]))
  const cards: { agent: string; episodes: string[]; persona?: Persona }[] = []
  const seen = new Set<string>()
  for (const agent of agents) {
    if (!namedAgent(agent) || seen.has(agent)) continue
    seen.add(agent)
    const episodes = episodesFor.get(agent) ?? []
    const persona = personaFor.get(agent)
    if (!episodes.length && !persona) continue
    cards.push(persona ? { agent, episodes, persona } : { agent, episodes })
    if (cards.length === MAX_CAST) break
  }
  return cards
}

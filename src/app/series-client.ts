/** Nonblocking live archive writer. Replays are never a durable source. */
import { rootFor } from '../narrative/cast'
import { assembleScenes } from '../narrative/scene'
import { seriesKeyForRoot } from '../narrative/scope'
import { parseArchivedEpisode, type ArchivedEpisode } from '../narrative/series'
import { isRecord } from '../narrative/evidence'
import type { Beat, SessionInfo } from '../narrative/types'

type CachedContext = { key: string; episodeCount: number; bibles: unknown[]; personas: unknown[] }
export function createSeriesClient(fetcher: typeof fetch = fetch, changed: () => void = () => {}) {
  let epoch = 0
  let replayMode = false
  let active: AbortController | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let message = 'Local history: waiting for project footage'
  const queued = new Map<string, ArchivedEpisode>()
  const scheduled = new Map<string, string>()
  const failed = new Set<string>()
  const cached = new Map<string, CachedContext>()
  const identity = (e: ArchivedEpisode) => JSON.stringify([e.seriesKey, e.id])
  const pump = () => {
    if (active || retryTimer !== undefined || !queued.size) return
    const [id, episode] = queued.entries().next().value!
    queued.delete(id)
    const controller = new AbortController()
    active = controller
    const started = epoch
    message = 'Local history: saving'
    void (async () => {
      let saved = false
      let retryable = true
      try {
        const response = await fetcher('/__series/episode', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(episode), signal: controller.signal, credentials: 'same-origin' })
        if (!response.ok) {
          const problem: unknown = await response.json().catch(() => null)
          retryable = response.status === 423 || response.status >= 500 ||
            (response.status === 409 && isRecord(problem) && problem.code === 'unavailable')
          throw new Error('local history unavailable')
        }
        const receipt: unknown = await response.json()
        if (!isRecord(receipt) || receipt.saved !== true || !Number.isSafeInteger(receipt.episodeCount) || (receipt.episodeCount as number) < 0) {
          throw new Error('local history unavailable')
        }
        if (started !== epoch || controller.signal.aborted) return
        saved = true; failed.delete(id)
        message = failed.size ? 'Local history: some updates unavailable' : `Local history: saved (${receipt.episodeCount} episodes)`
        const query = new URLSearchParams({ key: episode.seriesKey, root: episode.rootSessionID })
        const agents = [...new Set(episode.sessions.map(s => s.agent).filter((s): s is string => Boolean(s)))].slice(0, 8)
        for (const agent of agents) query.append('agent', agent)
        const contextResponse = await fetcher(`/__series/context?${query}`, { signal: controller.signal, credentials: 'same-origin' })
        if (!contextResponse.ok) throw new Error('context unavailable')
        const context: unknown = await contextResponse.json()
        if (!isRecord(context) || context.key !== episode.seriesKey || !Number.isSafeInteger(context.episodeCount) ||
            !Array.isArray(context.bibles) || !Array.isArray(context.personas)) throw new Error('context unavailable')
        if (started === epoch && !controller.signal.aborted) cached.set(episode.seriesKey, context as CachedContext)
      } catch {
        if (started === epoch && !controller.signal.aborted) {
          if (!saved) {
            failed.add(id)
            if (retryable) {
              if (!queued.has(id)) queued.set(id, episode)
              retryTimer = setTimeout(() => { retryTimer = undefined; pump() }, 30_000)
            }
          }
          message = saved ? 'Local history: saved; context unavailable' : 'Local history: unavailable — work remains live'
          if (!saved && retryable) message += '; retrying in 30s'
        }
      } finally {
        if (active === controller) active = undefined
        if (started === epoch) changed()
        pump()
      }
    })()
  }
  const reset = () => {
    epoch++; active?.abort(); queued.clear(); scheduled.clear(); failed.clear(); cached.clear()
    clearTimeout(retryTimer); retryTimer = undefined
    replayMode = false
    message = 'Local history: waiting for project footage'
  }
  const update = (beats: Beat[], sessions: SessionInfo[], replay = false) => {
    if (replay) {
      if (!replayMode) { reset(); replayMode = true }
      message = 'Local history: replay (not saved)'; return
    }
    if (replayMode) reset()
    const index = new Map(sessions.map(s => [s.id, s]))
    const groups = new Map<string, Beat[]>()
    for (const beat of beats) {
      const root = rootFor(beat.sessionID, index)
      const group = groups.get(root) ?? []
      group.push(beat); groups.set(root, group)
    }
    const scenes = assembleScenes(beats, sessions)
    const beatIndex = new Map(beats.map(b => [b.id, b]))
    let knownScope = false
    for (const [root, evidence] of groups) {
      const seriesKey = seriesKeyForRoot(root, sessions)
      if (!seriesKey) continue
      knownScope = true
      const milestones = scenes.filter((s, i) => s.rootSessionID === root && (i < scenes.length - 1 || s.beats.length >= 12 ||
          Math.max(...s.beats.map(id => beatIndex.get(id)!.endAt)) - beatIndex.get(s.beats[0])!.at >= 90_000))
        .map(s => s.beats)
      const terminals = evidence.filter(b => b.sessionID === root && (b.kind === 'wrap' || b.kind === 'cut')).map(b => b.id)
      if (!milestones.length && !terminals.length) continue
      const snapshot = sessions.filter(s => rootFor(s.id, index) === root)
        .map(({ id, parentID, agent, model, seriesKey }) => ({ id, parentID, agent, model, seriesKey }))
      const candidate = { id: `ep:${root}`, rootSessionID: root, seriesKey, sessions: snapshot, beats: evidence }
      const id = identity(candidate)
      const trigger = JSON.stringify([milestones, terminals, snapshot])
      if (scheduled.get(id) === trigger) continue
      const episode = parseArchivedEpisode(candidate)
      if (!episode) { failed.add(id); message = 'Local history: unsupported or oversized evidence'; changed(); continue }
      scheduled.set(id, trigger)
      queued.set(id, episode)
    }
    if (!knownScope && beats.length) message = 'Local history: no project identity'
    pump()
  }
  return { update, reset, status: () => message, contexts: () => new Map(cached) }
}

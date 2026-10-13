/** Earlier-footage reads never write, spend, or enter current scene/stage evidence. */
import { rootFor } from '../narrative/cast'
import { seriesKeyForRoot } from '../narrative/scope'
import { parseRecap, type Recap } from '../narrative/recap'
import type { Beat, SessionInfo } from '../narrative/types'

type Read = { key: string; before: number; controller: AbortController; recap?: Recap; error: boolean }
export function createRecapClient(fetcher: typeof fetch = fetch, changed: () => void = () => {}) {
  const reads = new Map<string, Read>()
  let epoch = 0
  const reset = () => {
    epoch++
    for (const read of reads.values()) read.controller.abort()
    reads.clear()
  }
  const update = (beats: Beat[], sessions: SessionInfo[], replay = false) => {
    if (replay) { reset(); return }
    const index = new Map(sessions.map(s => [s.id, s]))
    const cutoffs = new Map<string, number>()
    for (const beat of beats) {
      if (!Number.isFinite(beat.at) || beat.at <= 0 || beat.at > Number.MAX_SAFE_INTEGER) continue
      const root = rootFor(beat.sessionID, index)
      cutoffs.set(root, Math.min(cutoffs.get(root) ?? Infinity, beat.at))
    }
    const wanted = new Set<string>()
    for (const [root, before] of cutoffs) {
      const key = seriesKeyForRoot(root, sessions)
      if (!key) continue
      wanted.add(root)
      const old = reads.get(root)
      if (old?.key === key && old.before === before) continue
      old?.controller.abort()
      const read: Read = { key, before, controller: new AbortController(), error: false }
      reads.set(root, read)
      const started = epoch
      const current = () => started === epoch && !read.controller.signal.aborted && reads.get(root) === read
      void (async () => {
        try {
          const query = new URLSearchParams({ key, root, before: String(before) })
          const response = await fetcher(`/__series/recap?${query}`, { signal: read.controller.signal, credentials: 'same-origin' })
          if (!response.ok) throw new Error('earlier footage unavailable')
          const recap = parseRecap(await response.json(), key, root, before)
          if (!recap) throw new Error('earlier footage unavailable')
          if (current()) read.recap = recap
        } catch { if (current()) read.error = true }
        finally { if (current()) changed() }
      })()
    }
    for (const [root, read] of reads) {
      if (!wanted.has(root)) { read.controller.abort(); reads.delete(root) }
    }
  }
  return { update, reset,
    recapFor: (key: string, root: string) => reads.get(root)?.key === key ? reads.get(root)?.recap : undefined,
    errorFor: (key: string, root: string) => reads.get(root)?.key === key && reads.get(root)?.error === true,
  }
}

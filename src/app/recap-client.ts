/** Earlier-footage reads never write, spend, or enter current scene/stage evidence. */
import { rootFor } from '../narrative/cast'
import { seriesKeyForRoot } from '../narrative/scope'
import { parseRecap, type Recap } from '../narrative/recap'
import type { Beat, SessionInfo } from '../narrative/types'
import { isRecord } from '../narrative/evidence'

type Read = { key: string; before: number; controller: AbortController; recap?: Recap; error: boolean;
  attempts: number; timer?: ReturnType<typeof setTimeout> }
export function createRecapClient(fetcher: typeof fetch = fetch, changed: () => void = () => {}) {
  const reads = new Map<string, Read>()
  let epoch = 0
  const cancel = (read: Read) => { read.controller.abort(); clearTimeout(read.timer) }
  const reset = () => {
    epoch++
    for (const read of reads.values()) cancel(read)
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
      if (old) cancel(old)
      const read: Read = { key, before, controller: new AbortController(), error: false, attempts: 0 }
      reads.set(root, read)
      const started = epoch
      const current = () => started === epoch && !read.controller.signal.aborted && reads.get(root) === read
      const load = async () => {
        if (!current()) return
        read.attempts++
        let retryable = true
        try {
          const query = new URLSearchParams({ key, root, before: String(before) })
          const response = await fetcher(`/__series/recap?${query}`, { signal: read.controller.signal, credentials: 'same-origin' })
          retryable = false
          if (!response.ok) {
            const problem: unknown = await response.json().catch(() => null)
            retryable = response.status === 423 || response.status === 429 || response.status >= 500 ||
              (response.status === 409 && isRecord(problem) && problem.code === 'unavailable')
            throw new Error('earlier footage unavailable')
          }
          const recap = parseRecap(await response.json(), key, root, before)
          if (!recap) throw new Error('earlier footage unavailable')
          if (current()) { read.recap = recap; read.error = false }
        } catch {
          if (current()) {
            read.error = true
            if (retryable && read.attempts < 4) read.timer = setTimeout(() => { read.timer = undefined; void load() }, 30_000)
          }
        }
        finally { if (current()) changed() }
      }
      void load()
    }
    for (const [root, read] of reads) {
      if (!wanted.has(root)) { cancel(read); reads.delete(root) }
    }
  }
  return { update, reset,
    recapFor: (key: string, root: string) => reads.get(root)?.key === key ? reads.get(root)?.recap : undefined,
    errorFor: (key: string, root: string) => reads.get(root)?.key === key && reads.get(root)?.error === true,
  }
}

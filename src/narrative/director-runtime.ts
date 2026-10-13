/** One active call, one newest waiting scene. The floor never awaits narration. */
import { rootFor } from './cast'
import { checkDirectorLines, type DirectorRequest } from './director'
import type { Line } from './line'
import { assembleScenes } from './scene'
import type { Beat, SessionInfo } from './types'

type Pending = { request: DirectorRequest; root: string; signature: string }
const finiteJSON = (v: unknown): boolean => typeof v === 'number' ? Number.isFinite(v) :
  Array.isArray(v) ? v.every(finiteJSON) : v !== null && typeof v === 'object' ? Object.values(v).every(finiteJSON) : true

export function createDirectorRuntime(request: (scene: DirectorRequest, signal: AbortSignal) => Promise<unknown>, changed: () => void) {
  let enabled = false
  let epoch = 0
  let current = new Map<string, Pending>()
  let queued: Pending | undefined
  let active: { pending: Pending; controller: AbortController } | undefined
  const considered = new Set<string>()
  const excluded = new Set<string>()
  const accepted = new Map<string, { signature: string; lines: Line[] }>()
  const allowed = (p: Pending) => enabled && !excluded.has(p.root) && current.get(p.request.sceneID)?.signature === p.signature
  const start = (pending: Pending) => {
    if (!allowed(pending)) return
    const controller = new AbortController()
    const started = epoch
    active = { pending, controller }
    void (async () => {
      try {
        const output = await request(pending.request, controller.signal)
        if (started !== epoch || controller.signal.aborted || !allowed(pending)) return
        if (output !== null && typeof output === 'object' && 'mode' in output && output.mode !== 'director') return
        const scene = assembleScenes(pending.request.beats, pending.request.sessions)[0]
        const result = checkDirectorLines(scene, output, pending.request.beats, pending.request.sessions)
        if (result.mode === 'director') accepted.set(scene.id, { signature: pending.signature, lines: result.lines.map(l => l.line) })
      } catch { /* Failure keeps the already-visible templates; never retry a scene. */ }
      finally {
        if (active?.controller === controller) active = undefined
        const next = queued
        queued = undefined
        if (next && allowed(next)) start(next)
        changed()
      }
    })()
  }
  const schedule = (pending: Pending[]) => {
    const fresh = pending.filter(p => !considered.has(p.request.sceneID) && !excluded.has(p.root))
    if (!enabled || !fresh.length) return
    for (const p of fresh) considered.add(p.request.sceneID)
    const latest = fresh[fresh.length - 1]
    if (active) queued = latest
    else start(latest)
  }
  let closed: Pending[] = []
  const update = (beats: Beat[], sessions: SessionInfo[], flush = false) => {
    const scenes = assembleScenes(beats, sessions)
    const index = new Map(beats.map(b => [b.id, b]))
    const sessionIndex = new Map(sessions.map(s => [s.id, s]))
    const next = new Map<string, Pending>()
    closed = []
    scenes.forEach((scene, i) => {
      const evidence = scene.beats.map(id => ({ ...index.get(id)!, eventIDs: [] }))
      const snapshot = sessions.filter(s => rootFor(s.id, sessionIndex) === scene.rootSessionID)
        .map(({ id, parentID, agent, model }) => ({ id, parentID, agent, model }))
      const payload: DirectorRequest = { sceneID: scene.id, beats: evidence, sessions: snapshot }
      const signature = JSON.stringify(payload)
      if (!finiteJSON(payload) || snapshot.length > 128 || new TextEncoder().encode(signature).length > 32_768) return
      const pending = { request: payload, root: scene.rootSessionID, signature }
      next.set(scene.id, pending)
      if (flush || i < scenes.length - 1 || scene.beats.length >= 12 ||
          Math.max(...evidence.map(b => b.endAt)) - evidence[0].at >= 90_000) closed.push(pending)
    })
    current = next
    for (const [id, result] of accepted) if (next.get(id)?.signature !== result.signature) accepted.delete(id)
    schedule(closed)
  }
  const results = () => new Map([...accepted].map(([id, result]) => [id, result.lines]))
  const setEnabled = (value: boolean) => {
    enabled = value
    if (!value) { epoch++; active?.controller.abort(); queued = undefined; accepted.clear() }
    else schedule(closed)
  }
  const setExcluded = (root: string, value: boolean) => {
    if (value) {
      excluded.add(root)
      if (active?.pending.root === root) active.controller.abort()
      if (queued?.root === root) queued = undefined
      for (const id of accepted.keys()) if (current.get(id)?.root === root) accepted.delete(id)
    } else { excluded.delete(root); schedule(closed) }
  }
  const reset = () => {
    epoch++; active?.controller.abort(); queued = undefined
    current.clear(); closed = []; considered.clear(); accepted.clear()
  }
  return { update, results, setEnabled, setExcluded, reset }
}

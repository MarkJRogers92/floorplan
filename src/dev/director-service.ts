import { checkDirectorLines, type DirectorRequest, type DirectorState, type DirectorResponse,
  type DirectorContinuity, type DirectorContinuityHooks } from '../narrative/director'
import { assembleScenes } from '../narrative/scene'
import { parseDirectorRequest } from './director-input'
import { DIRECTOR_MODEL } from './director-provider'

export type DirectorConfig = { key: string; enabled: boolean; episodeCapCents: number; runCapCents: number }

export function directorConfig(env: Record<string, string>): DirectorConfig {
  const cap = (key: string, fallback: number) => env[key] === undefined ? fallback :
    /^\d+$/.test(env[key]) && Number(env[key]) >= 3 && Number(env[key]) <= 10_000 ? Number(env[key]) : 0
  const episodeCapCents = cap('FLOORPLAN_DIRECTOR_EPISODE_CAP_CENTS', 30)
  const runCapCents = cap('FLOORPLAN_DIRECTOR_RUN_CAP_CENTS', 100)
  return { key: env.FLOORPLAN_DIRECTOR_KEY?.trim() ?? '',
    enabled: env.FLOORPLAN_DIRECTOR_ENABLED === 'true' && episodeCapCents > 0 && runCapCents > 0,
    episodeCapCents, runCapCents }
}

export function createDirectorService(config: DirectorConfig,
  complete: (request: DirectorRequest, signal: AbortSignal, context: DirectorContinuity) => Promise<unknown>,
  hooks: Partial<DirectorContinuityHooks> = {}) {
  const available = Boolean(config.key && config.enabled && Number.isInteger(config.episodeCapCents) &&
    Number.isInteger(config.runCapCents) && config.episodeCapCents >= 3 && config.runCapCents >= 3)
  let enabled = false
  let epoch = 0
  let reservedCents = 0
  let active: { root: string; controller: AbortController } | undefined
  const episodes = new Map<string, number>()
  const excluded = new Set<string>()
  const attempts = new Map<string, { signature: string; promise: Promise<DirectorResponse> }>()
  const state = (): DirectorState => ({ available, enabled, model: DIRECTOR_MODEL, episodeCapCents: config.episodeCapCents,
    runCapCents: config.runCapCents, reservedCents, excluded: [...excluded] })
  const control = (value: boolean) => {
    enabled = available && value
    if (!enabled) { epoch++; active?.controller.abort() }
    return state()
  }
  const optOut = (root: string, disabled: boolean) => {
    if (disabled) { excluded.add(root); if (active?.root === root) active.controller.abort() }
    else excluded.delete(root)
    return state()
  }
  const direct = async (input: DirectorRequest): Promise<DirectorResponse> => {
    const request = parseDirectorRequest(input)
    if (!request) return { lines: [], mode: 'templates', reason: 'invalid' }
    const scene = assembleScenes(request.beats, request.sessions)[0]
    const fallback = (reason: string): DirectorResponse => ({
      lines: checkDirectorLines(scene, undefined, request.beats, request.sessions).lines.map(l => l.line), mode: 'templates', reason,
    })
    if (!enabled) return fallback('disabled')
    const root = scene.rootSessionID
    if (excluded.has(root)) return fallback('opt-out')
    const identity = JSON.stringify([root, request.sceneID])
    const signature = JSON.stringify(request)
    const known = attempts.get(identity)
    if (known) return known.signature === signature ? known.promise : fallback('changed-evidence')
    if (active) return fallback('busy')
    const used = episodes.get(root) ?? 0
    if (used + 3 > config.episodeCapCents || reservedCents + 3 > config.runCapCents) return fallback('budget')
    // Never refund: an error or cancellation may still be billed by the provider.
    reservedCents += 3; episodes.set(root, used + 3)
    const controller = new AbortController()
    const started = epoch
    active = { root, controller }
    const promise = (async (): Promise<DirectorResponse> => {
      try {
        let context: DirectorContinuity = { bibles: [], personas: [] }
        if (request.seriesKey && hooks.loadContext) {
          const agents = [...new Set(request.beats.map(b => request.sessions.find(s => s.id === b.sessionID)?.agent)
            .filter((agent): agent is string => Boolean(agent) && agent !== 'unidentified'))]
          try { context = await hooks.loadContext(request, root, agents) } catch { /* Broken history is never invented. */ }
        }
        if (controller.signal.aborted || started !== epoch || !enabled || excluded.has(root)) return fallback('disabled')
        const output = await complete(request, controller.signal, context)
        if (controller.signal.aborted || started !== epoch || !enabled || excluded.has(root)) return fallback('disabled')
        const result = checkDirectorLines(scene, output, request.beats, request.sessions)
        if (result.mode === 'director' && request.seriesKey && hooks.savePersonas) {
          const proposals = output !== null && typeof output === 'object' && 'personas' in output ? output.personas : undefined
          try { await hooks.savePersonas(request, root, proposals) } catch { /* Local storage cannot block checked narration. */ }
          if (controller.signal.aborted || started !== epoch || !enabled || excluded.has(root)) return fallback('disabled')
        }
        return { lines: result.lines.map(l => l.line), mode: result.mode, reason: result.mode === 'director' ? 'checked' : 'invalid' }
      } catch { return fallback('failed') }
      finally { if (active?.controller === controller) active = undefined }
    })()
    attempts.set(identity, { signature, promise })
    return promise
  }
  return { state, control, optOut, direct }
}

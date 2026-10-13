import { authedFetch } from './api/client'
import type { Service } from './api/service'
import type { Frame } from './api/sse'
import { streamFrames } from './api/stream'
import { createFloor } from './app/floor'
import { directorCall, parseDirectorState } from './app/director-client'
import type { DirectorState } from './narrative/director'
import { createDirectorRuntime } from './narrative/director-runtime'
import { createRollup, flush as flushRollup, rollup as rollFrame, seedRollup } from './narrative/rollup'
import type { ScriptLine } from './narrative/script'
import type { Beat } from './narrative/types'
import { assembleEpisodeViews } from './narrative/views'
import { parseRecording } from './replay/parse'
import { replayFrames } from './replay/play'
import { createRoom } from './room/room'

const toolbar = document.getElementById('toolbar')!
const status = document.getElementById('status')!
const canvas = document.getElementById('canvas') as HTMLCanvasElement
const replayBtn = document.getElementById('replay') as HTMLButtonElement
const fileInput = document.getElementById('recording') as HTMLInputElement
const scriptEl = document.getElementById('script')!
const directorBtn = document.getElementById('director') as HTMLButtonElement
const directorStatus = document.getElementById('director-status')!

const floor = createFloor()
const room = createRoom(canvas)
let liveAbort: AbortController | null = null

function draw() {
  room.draw(floor.desks())
}

function setStatus(text: string, isError = false) {
  status.textContent = text
  status.classList.toggle('error', isError)
}

/**
 * The narrative consumer: the same frames the floor folds, run through the rollup
 * (§4.1) and assembled into the script (§5.1). It never blocks the floor — a beat it
 * cannot narrate is dropped, and the floor carries on.
 *
 * The cast is rebuilt from the rollup's own sessions, so a worker's name is the one the
 * stream gave it (§5.5), never a guess.
 */
let rollState = seedRollup(createRollup(), { sessions: [], permissions: [] })
let beats: Beat[] = []
let narrativeFlushed = false
let directorEnabled = false
let directorState: DirectorState | null = null
const excludedChats = new Set<string>()
const director = createDirectorRuntime((request, signal) => directorCall('scene', request, signal), () => {
  renderNarrative()
  void refreshDirectorState()
})

function directorControls() {
  directorBtn.disabled = !directorState?.available
  directorBtn.textContent = directorEnabled ? 'Disable Director' : 'Enable Director (sends scenes to OpenAI)'
  directorStatus.textContent = !directorState?.available ? 'Director: templates (not configured)' :
    `Director: ${directorEnabled ? 'on' : 'off'} · ${directorState.reservedCents}¢ reserved / ${directorState.runCapCents}¢ run cap`
}

async function refreshDirectorState() {
  try {
    const state = parseDirectorState(await directorCall('state'))
    if (!state) throw new Error('Director unavailable')
    directorState = state
    for (const root of state.excluded) { excludedChats.add(root); director.setExcluded(root, true) }
    if (!state.enabled || !state.available) { directorEnabled = false; director.setEnabled(false) }
  } catch { directorState = null; directorEnabled = false; director.setEnabled(false) }
  directorControls()
  renderNarrative()
}

directorBtn.addEventListener('click', async () => {
  const enable = !directorEnabled
  if (!enable) { directorEnabled = false; director.setEnabled(false); renderNarrative() }
  directorBtn.disabled = true
  try {
    const state = parseDirectorState(await directorCall('control', { enabled: enable }))
    if (!state) throw new Error('Director unavailable')
    directorState = state
    for (const root of state.excluded) { excludedChats.add(root); director.setExcluded(root, true) }
    directorEnabled = enable && state.available && state.enabled
    director.setEnabled(directorEnabled)
  } catch { directorState = null; directorEnabled = false; director.setEnabled(false) }
  directorControls()
  renderNarrative()
})

function chatOptOut(root: string) {
  const label = document.createElement('label')
  label.className = 'episode-optout'
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.checked = excludedChats.has(root)
  checkbox.disabled = !directorState?.available
  checkbox.addEventListener('change', async () => {
    const disabled = checkbox.checked
    if (disabled) excludedChats.add(root)
    else excludedChats.delete(root)
    director.setExcluded(root, disabled)
    renderNarrative()
    try {
      const state = parseDirectorState(await directorCall('opt-out', { rootSessionID: root, disabled }))
      if (!state) throw new Error('Director unavailable')
      directorState = state
    } catch { directorEnabled = false; director.setEnabled(false) }
    directorControls()
    renderNarrative()
  })
  label.append(checkbox, 'Templates only for this chat')
  return label
}

function resetNarrative() {
  director.reset()
  rollState = seedRollup(createRollup(), { sessions: [], permissions: [] })
  beats = []
  narrativeFlushed = false
  scriptEl.replaceChildren()
}

function scriptRow(line: ScriptLine, kind: 'episode' | 'scene' | 'line') {
  const row = document.createElement('div')
  row.className = kind
  row.dataset.beats = line.beatIDs.join(' ')
  row.tabIndex = 0
  if (kind === 'line') {
    row.dataset.delivery = line.delivery
    if (line.line.flashback) row.dataset.flashback = 'true'
  }
  const text = document.createElement('span')
  text.textContent = line.text
  const ids = document.createElement('span')
  ids.className = 'beats'
  ids.textContent = line.beatIDs.join(' ')
  row.append(text, ids)
  return row
}

/** Rebuild the pure episode view so newly learned cast names and scene cuts stay current. */
function narrate(arrived: Beat[], flushed = false) {
  beats.push(...arrived)
  if (flushed) narrativeFlushed = true
  director.update(beats, [...rollState.sessions.values()], narrativeFlushed)
  renderNarrative()
}

function renderNarrative() {
  const content = document.createDocumentFragment()
  for (const view of assembleEpisodeViews(beats, [...rollState.sessions.values()], director.results())) {
    const episode = document.createElement('section')
    episode.dataset.episode = view.episode.id
    episode.append(scriptRow(view.heading, 'episode'))
    episode.append(chatOptOut(view.episode.rootSessionID))
    for (const group of view.scenes) {
      const scene = document.createElement('section')
      scene.dataset.scene = group.scene.id
      scene.dataset.check = group.check.ok ? 'pass' : 'fail'
      scene.dataset.narration = group.mode
      if (!group.check.ok) scene.title = group.check.failures.join('\n')
      scene.append(scriptRow(group.heading, 'scene'))
      for (const line of group.lines) scene.append(scriptRow(line, 'line'))
      episode.append(scene)
    }
    content.append(episode)
  }
  scriptEl.replaceChildren(content)
  scriptEl.scrollTop = scriptEl.scrollHeight
}

function pushFrame(frame: Frame) {
  floor.push(frame)
  const priorSessions = rollState.sessions
  const folded = rollFrame(rollState, frame)
  rollState = folded.state
  if (folded.beats.length || priorSessions !== rollState.sessions) narrate(folded.beats)
  draw()
}

async function fetchService(): Promise<Service | null> {
  const res = await fetch('/__service')
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'unknown error' }))
    setStatus(body.error ?? `service route returned ${res.status}`, true)
    return null
  }
  return res.json()
}

async function seedFromREST(service: Service) {
  const [sessionsRes, permissionsRes, formsRes] = await Promise.all([
    authedFetch(service, '/api/session'),
    authedFetch(service, '/api/permission/request'),
    authedFetch(service, '/api/form'),
  ])

  if (!sessionsRes.ok) throw new Error(`sessions returned ${sessionsRes.status}`)
  const sessions = (await sessionsRes.json()).data ?? []

  const permissions = permissionsRes.ok
    ? ((await permissionsRes.json()).data ?? []).map((r: { id: string; sessionID: string }) => ({
        requestID: r.id,
        sessionID: r.sessionID,
      }))
    : []

  const forms = formsRes.ok
    ? ((await formsRes.json()).data ?? []).map((f: { id: string; sessionID: string }) => ({
        requestID: f.id,
        sessionID: f.sessionID,
      }))
    : []

  const requests = [...permissions, ...forms]
  floor.setSnapshot(sessions, requests)
  // Seed the narrative the same way (§4.1): a session we joined mid-turn still has a
  // root and a cast member. Sessions without a parentID on the wire are taken for roots.
  rollState = seedRollup(rollState, {
    sessions: sessions.map((s: { id: string; parentID?: string; agent?: string }) => ({
      id: s.id,
      parentID: s.parentID,
      agent: s.agent,
    })),
    permissions: requests,
  })
  draw()
}

async function startLive(service: Service) {
  liveAbort?.abort()
  liveAbort = new AbortController()
  setStatus('live')
  try {
    await streamFrames(service, '/api/event', pushFrame, liveAbort.signal)
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    setStatus((err as Error).message, true)
  }
}

async function connect(service: Service) {
  resetNarrative()
  await seedFromREST(service)
  startLive(service)
}

async function start() {
  try {
    const service = await fetchService()
    if (!service) return
    await connect(service)
  } catch (err) {
    setStatus((err as Error).message, true)
  }
}

replayBtn.addEventListener('click', () => {
  const file = fileInput.files?.[0]
  if (!file) {
    setStatus('choose a .jsonl recording first', true)
    return
  }
  liveAbort?.abort()
  resetNarrative()
  file
    .text()
    .then(text => {
      const frames = parseRecording(text)
      setStatus(`replaying ${frames.length} frames`)
      return replayFrames(frames, pushFrame, 250)
    })
    .then(() => {
      // §4.1's flush: runs still open when the footage stops close with the events they have.
      narrate(flushRollup(rollState), true)
      setStatus('replay done')
    })
    .catch(err => setStatus(err.message, true))
})

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  replayBtn.textContent = file ? `Replay ${file.name}` : 'Replay'
})

function resize() {
  const rect = canvas.parentElement!.getBoundingClientRect()
  canvas.width = Math.floor(rect.width)
  canvas.height = Math.floor(rect.height)
  draw()
}

window.addEventListener('resize', resize)
resize()
start()
void refreshDirectorState()

// Keep the canvas in sync with state changes that no frame announces, such as the
// success/failure hold falling back to idle after a timer.
function loop() {
  draw()
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)

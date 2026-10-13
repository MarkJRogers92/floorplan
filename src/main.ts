import { authedFetch } from './api/client'
import type { Service } from './api/service'
import type { Frame } from './api/sse'
import { streamFrames } from './api/stream'
import { createFloor } from './app/floor'
import { directorCall, parseDirectorState } from './app/director-client'
import { createSeriesClient } from './app/series-client'
import { createRecapClient } from './app/recap-client'
import { scriptRow, memoryElement, recapElement } from './app/script-view'
import { castMemoryCards } from './app/cast-memory'
import { mountWorkPanel } from './app/work-panel'
import { bindReplayControls } from './app/replay-controls'
import { createDemoPlayer } from './app/demo'
import { beatsForWork } from './app/work-scope'
import { scopeFromSnapshot, seriesKeyForRoot } from './narrative/scope'
import { rootFor } from './narrative/cast'
import type { DirectorState } from './narrative/director'
import { createDirectorRuntime } from './narrative/director-runtime'
import { createRollup, flush as flushRollup, rollup as rollFrame, seedRollup } from './narrative/rollup'
import type { Beat } from './narrative/types'
import { assembleEpisodeViews } from './narrative/views'
import { createRoom } from './room/room'
import { createStageRuntime } from './room/stage'

const welcome = document.getElementById('welcome')!
const liveBtn = document.getElementById('live') as HTMLButtonElement
const demoBtn = document.getElementById('demo') as HTMLButtonElement
const modeNotice = document.getElementById('mode-notice')!
const status = document.getElementById('status')!
const canvas = document.getElementById('canvas') as HTMLCanvasElement
const replayBtn = document.getElementById('replay') as HTMLButtonElement
const fileInput = document.getElementById('recording') as HTMLInputElement
const scriptEl = document.getElementById('script')!
const directorBtn = document.getElementById('director') as HTMLButtonElement
const directorStatus = document.getElementById('director-status')!
const historyStatus = document.getElementById('history-status')!
const stageCue = document.getElementById('stage-cue')!
const work = mountWorkPanel(document.getElementById('work-panel')!, () => { renderNarrative(); resize() }, session => {
  rollState = seedRollup(rollState, { sessions: [{ id: session.id, agent: session.agent, seriesKey: `directory:${session.directory}` }], permissions: [] })
  renderNarrative()
})

const floor = createFloor()
const workerImage = new Image()
workerImage.src = new URL('../assets/worker.png', import.meta.url).href
const room = createRoom(canvas, workerImage)
const stage = createStageRuntime()
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let lastStageBeat: Beat | undefined
let stageLine = ''
let liveAbort: AbortController | null = null

function draw() {
  const selected = work.selectedID()
  const desks = floor.desks().filter(d => {
    const root = rootFor(d.sessionID, rollState.sessions)
    return !replaying && selected ? root === selected : observedRoots.has(root)
  })
  const frames = stage.frames(performance.now(), reducedMotion.matches)
  welcome.hidden = replaying || !!selected || desks.length > 0
  room.draw(desks, frames, new Map([...rollState.sessions.values()].map(s => [s.id, s.agent ?? 'Unidentified'])))
  canvas.setAttribute('aria-label', desks.length ? desks.map(d => `${rollState.sessions.get(d.sessionID)?.agent ?? 'Unidentified'}: ${d.status}`).join('; ') : 'An empty office. No active cast observed.')
  const actor = lastStageBeat && 'childSessionID' in lastStageBeat.detail ? lastStageBeat.detail.childSessionID : lastStageBeat?.sessionID
  const frame = actor ? frames.get(actor) : undefined
  const visible = frame && desks.some(d => d.sessionID === frame.sessionID) && frame.beatID === lastStageBeat?.id
  const label = visible && stageLine ? `${stageLine} · dramatised` : desks.length ? 'Office reactions are dramatised. Desk labels show the actual state.' : 'The desks are ready. The coffee is theoretical.'
  const session = visible ? frame.sessionID : ''
  if (stageCue.textContent !== label || stageCue.dataset.session !== session) {
    stageCue.textContent = label
    stageCue.dataset.beat = visible ? frame.beatID : ''
    stageCue.dataset.session = session
  }
}

function setStatus(text: string, isError = false) {
  status.textContent = text
  status.classList.toggle('error', isError)
}

let rollState = seedRollup(createRollup(), { sessions: [], permissions: [] })
let beats: Beat[] = []
let observedRoots = new Set<string>()
let narrativeFlushed = false
let replaying = false
let demoMode = false
let directorEnabled = false
let directorState: DirectorState | null = null
const excludedChats = new Set<string>()
const history = createSeriesClient(fetch, () => {
  historyStatus.textContent = history.status()
  renderNarrative()
})
const recaps = createRecapClient(fetch, () => { renderNarrative() })
const director = createDirectorRuntime((request, signal) => directorCall('scene', request, signal), () => {
  renderNarrative()
  void refreshDirectorState()
})

function directorControls() {
  directorBtn.disabled = demoMode || !directorState?.available
  directorBtn.textContent = directorEnabled ? 'Disable Director' : 'Enable Director (sends scenes to OpenAI)'
  directorStatus.textContent = !directorState?.available ? 'Director: templates (not configured)' :
    `Director: ${directorEnabled ? 'on' : 'off'} · ${directorState.reservedCents}¢ reserved / ${directorState.runCapCents}¢ run cap`
}

async function refreshDirectorState() {
  if (demoMode) return
  const current = playback.current()
  try {
    const state = parseDirectorState(await directorCall('state'))
    if (!current() || demoMode) return
    if (!state) throw new Error('Director unavailable')
    directorState = state
    for (const root of state.excluded) { excludedChats.add(root); director.setExcluded(root, true) }
    if (!state.enabled || !state.available) { directorEnabled = false; director.setEnabled(false) }
  } catch { if (!current() || demoMode) return; directorState = null; directorEnabled = false; director.setEnabled(false) }
  directorControls()
  renderNarrative()
}

directorBtn.addEventListener('click', async () => {
  if (demoMode) return
  const current = playback.current()
  const enable = !directorEnabled
  if (!enable) { directorEnabled = false; director.setEnabled(false); renderNarrative() }
  directorBtn.disabled = true
  try {
    const state = parseDirectorState(await directorCall('control', { enabled: enable }))
    if (!current() || demoMode) return
    if (!state) throw new Error('Director unavailable')
    directorState = state
    for (const root of state.excluded) { excludedChats.add(root); director.setExcluded(root, true) }
    directorEnabled = enable && state.available && state.enabled
    director.setEnabled(directorEnabled)
  } catch { if (!current() || demoMode) return; directorState = null; directorEnabled = false; director.setEnabled(false) }
  directorControls()
  renderNarrative()
})

function chatOptOut(root: string) {
  const label = document.createElement('label')
  label.className = 'episode-optout'
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.checked = excludedChats.has(root)
  checkbox.disabled = demoMode || !directorState?.available
  checkbox.addEventListener('change', async () => {
    if (demoMode) return
    const current = playback.current()
    const disabled = checkbox.checked
    if (disabled) excludedChats.add(root)
    else excludedChats.delete(root)
    director.setExcluded(root, disabled)
    renderNarrative()
    try {
      const state = parseDirectorState(await directorCall('opt-out', { rootSessionID: root, disabled }))
      if (!current() || demoMode) return
      if (!state) throw new Error('Director unavailable')
      directorState = state
    } catch { if (!current() || demoMode) return; directorEnabled = false; director.setEnabled(false) }
    directorControls()
    renderNarrative()
  })
  label.append(checkbox, 'Templates only for this chat')
  return label
}

function resetNarrative() {
  director.reset()
  history.reset()
  recaps.reset()
  stage.reset(); lastStageBeat = undefined
  floor.setSnapshot([], [])
  rollState = seedRollup(createRollup(), { sessions: [], permissions: [] })
  beats = []
  observedRoots.clear()
  narrativeFlushed = false
  scriptEl.replaceChildren()
}

/** Rebuild the pure episode view so newly learned cast names and scene cuts stay current. */
function narrate(arrived: Beat[], flushed = false) {
  beats.push(...arrived)
  observedRoots = new Set(beats.map(b => rootFor(b.sessionID, rollState.sessions)))
  stage.update(arrived, performance.now())
  if (arrived.length) {
    lastStageBeat = arrived[arrived.length - 1]
    stageLine = assembleEpisodeViews([lastStageBeat!], [...rollState.sessions.values()]).flatMap(v => v.scenes.flatMap(s => s.lines)).at(-1)?.text ?? ''
  }
  if (flushed) narrativeFlushed = true
  if (!demoMode) {
    history.update(beats, [...rollState.sessions.values()], replaying)
    historyStatus.textContent = history.status()
    recaps.update(beats, [...rollState.sessions.values()], replaying)
  }
  renderNarrative()
}

function renderNarrative() {
  const openMemory = new Set([...scriptEl.querySelectorAll<HTMLDetailsElement>('details[data-memory]')]
    .filter(d => d.open).map(d => d.dataset.memory))
  const sessions = [...rollState.sessions.values()]
  const index = rollState.sessions
  const focused = beatsForWork(beats, index, work.selectedID(), replaying)
  if (!demoMode) director.update(focused, sessions, narrativeFlushed, !replaying)
  const content = document.createDocumentFragment()
  for (const view of assembleEpisodeViews(focused, sessions, director.results())) {
    const episode = document.createElement('section')
    episode.dataset.episode = view.episode.id
    episode.append(scriptRow(view.heading, 'episode'))
    if (!demoMode) episode.append(chatOptOut(view.episode.rootSessionID))
    const root = view.episode.rootSessionID
    const key = seriesKeyForRoot(root, sessions)
    if (!replaying && key) {
      const recap = recaps.recapFor(key, root)
      const rendered = recap ? recapElement(recap) : undefined
      if (rendered) episode.append(rendered)
      else if (recaps.errorFor(key, root)) {
        const notice = document.createElement('p')
        notice.className = 'recap-note'
        notice.textContent = 'Earlier footage unavailable — the live script continues.'
        episode.append(notice)
      }
    }
    const agents = sessions.filter(s => rootFor(s.id, index) === root).flatMap(s => s.agent ? [s.agent] : [])
    const cards = !replaying && key ? castMemoryCards(history.contextFor(key, root), agents) : []
    if (cards.length) {
      const id = JSON.stringify([key, root])
      episode.append(memoryElement(cards, id, openMemory.has(id)))
    }
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
  if (!scriptEl.childElementCount) scriptEl.textContent = 'Quiet, for now. Give your lead a brief below, or watch the demo. The office will have opinions.'
  scriptEl.scrollTop = scriptEl.scrollHeight
}

function pushFrame(frame: Frame) {
  floor.push(frame)
  const priorSessions = rollState.sessions
  const folded = rollFrame(rollState, frame)
  rollState = folded.state
  if (folded.beats.length || priorSessions !== rollState.sessions) narrate(folded.beats)
  if (!demoMode) work.push(frame)
  draw()
}

async function fetchService(current = () => true): Promise<Service | null> {
  const res = await fetch('/__service')
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'unknown error' }))
    if (current()) setStatus(body.error ?? `service route returned ${res.status}`, true)
    return null
  }
  return res.json()
}

async function seedFromREST(service: Service, current = () => true) {
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

  const rawForms = formsRes.ok ? ((await formsRes.json()).data ?? []) : []
  const forms = rawForms.map((f: { id: string; sessionID: string }) => ({
        requestID: f.id,
        sessionID: f.sessionID,
      }))

  if (!current()) return

  const requests = [...permissions, ...forms]
  floor.setSnapshot(sessions, requests)
  work.updateSessions(sessions)
  work.updateQuestions(rawForms)
  rollState = seedRollup(rollState, {
    sessions: sessions.map((s: { id: string; parentID?: string; agent?: string }) => ({
      id: s.id,
      parentID: s.parentID,
      agent: s.agent,
      seriesKey: scopeFromSnapshot(s),
    })),
    permissions: requests,
  })
  narrate([])
  draw()
}

async function startLive(service: Service) {
  liveAbort?.abort()
  const controller = new AbortController()
  liveAbort = controller
  setStatus('live')
  try {
    await streamFrames(service, '/api/event', frame => {
      if (liveAbort === controller && !controller.signal.aborted && !replaying) pushFrame(frame)
    }, controller.signal)
  } catch (err) {
    if ((err as Error).name === 'AbortError' || liveAbort !== controller || controller.signal.aborted) return
    setStatus((err as Error).message, true)
  }
}

async function connect(service: Service, current = () => true) {
  liveAbort?.abort()
  replaying = false
  setDemoMode(false)
  resetNarrative()
  work.connect(service)
  await seedFromREST(service, current)
  if (current()) startLive(service)
}

async function start() {
  const current = playback.current()
  try {
    const service = await fetchService(current)
    if (!service || !current()) return
    await connect(service, current)
  } catch (err) {
    if (current()) setStatus((err as Error).message, true)
  }
}

const demo = createDemoPlayer(pushFrame, () => { narrate(flushRollup(rollState), true); setStatus('Demo finished — fictional') })
function setDemoMode(enabled: boolean) {
  demo.cancel(); demoMode = enabled
  document.body.dataset.mode = enabled ? 'demo' : 'live'
  modeNotice.hidden = !enabled; liveBtn.hidden = !replaying
  demoBtn.textContent = enabled ? 'Restart demo' : 'Watch demo'
  if (enabled) { directorEnabled = false; director.setEnabled(false) }
  directorControls()
}
function playDemo() {
  playback.cancel(); liveAbort?.abort(); replaying = true
  setDemoMode(true); work.setReplay(true, true); resetNarrative()
  historyStatus.textContent = 'Demo: no local history'
  setStatus('Demo — fictional'); renderNarrative(); draw(); demo.play()
}
demoBtn.addEventListener('click', playDemo)
document.getElementById('demo-welcome')!.addEventListener('click', playDemo)
const playback = bindReplayControls(replayBtn, fileInput, liveBtn, {
  enterReplay() { liveAbort?.abort(); replaying = true; setDemoMode(false); work.setReplay(true); resetNarrative(); draw() },
  push: pushFrame,
  finish: () => narrate(flushRollup(rollState), true),
  status: setStatus,
  async returnLive(current) {
    const service = await fetchService(current)
    if (service && current()) await connect(service, current)
    if (current() && !demoMode) void refreshDirectorState()
  },
})

function resize() {
  const rect = canvas.parentElement!.getBoundingClientRect()
  canvas.width = Math.floor(rect.width)
  canvas.height = Math.floor(rect.height)
  draw()
}

window.addEventListener('resize', resize)
document.addEventListener('toggle', resize, true)
resize()
if (new URLSearchParams(location.search).get('demo') === '1') playDemo()
else { document.body.dataset.mode = 'live'; start(); void refreshDirectorState() }

// Keep the canvas in sync with state changes that no frame announces, such as the
// success/failure hold falling back to idle after a timer.
function loop() {
  draw()
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)

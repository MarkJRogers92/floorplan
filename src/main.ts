import { authedFetch } from './api/client'
import type { Service } from './api/service'
import type { Frame } from './api/sse'
import { streamFrames } from './api/stream'
import { createFloor } from './app/floor'
import { parseRecording } from './replay/parse'
import { replayFrames } from './replay/play'
import { createRoom } from './room/room'

const toolbar = document.getElementById('toolbar')!
const status = document.getElementById('status')!
const canvas = document.getElementById('canvas') as HTMLCanvasElement
const replayBtn = document.getElementById('replay') as HTMLButtonElement
const fileInput = document.getElementById('recording') as HTMLInputElement

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

function pushFrame(frame: Frame) {
  floor.push(frame)
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

  floor.setSnapshot(sessions, [...permissions, ...forms])
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
  file
    .text()
    .then(text => {
      const frames = parseRecording(text)
      setStatus(`replaying ${frames.length} frames`)
      return replayFrames(frames, pushFrame, 250)
    })
    .then(() => setStatus('replay done'))
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

// Keep the canvas in sync with state changes that no frame announces, such as the
// success/failure hold falling back to idle after a timer.
function loop() {
  draw()
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)

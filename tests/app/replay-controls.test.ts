import { it, expect, vi, afterEach } from 'vitest'
import { bindReplayControls } from '../../src/app/replay-controls'

afterEach(() => vi.useRealTimers())
function control() {
  const listeners = new Map<string, () => void>()
  return { addEventListener: (type: string, fn: () => void) => listeners.set(type, fn), click: () => listeners.get('click')?.(), textContent: '' }
}
const recording = JSON.stringify({ id: 'event', type: 'session.created', created: 1, data: { sessionID: 'ses_demo' } })
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
it('returning to live drops delayed replay frames and terminal flush callbacks', async () => {
  let release!: (text: string) => void
  const text = new Promise<string>(resolve => { release = resolve })
  const replay = control(), live = control()
  const input = { files: [{ name: 'demo.jsonl', text: () => text }], addEventListener: () => {} }
  let frames = 0, finishes = 0, liveCalls = 0
  bindReplayControls(replay as unknown as HTMLButtonElement, input as unknown as HTMLInputElement, live as unknown as HTMLButtonElement, {
    enterReplay: () => {}, push: () => { frames++ }, finish: () => { finishes++ }, status: () => {},
    returnLive: async current => { if (current()) liveCalls++ },
  })
  replay.click(); live.click(); release(recording); await tick()
  expect([frames, finishes, liveCalls]).toEqual([0, 0, 1])
})
it('a newer replay supersedes an older delayed file and delivers only its own footage', async () => {
  vi.useFakeTimers()
  let release!: (text: string) => void
  const old = new Promise<string>(resolve => { release = resolve })
  const replay = control(), live = control()
  let chosen = { name: 'old.jsonl', text: () => old }
  const input = { get files() { return [chosen] }, addEventListener: () => {} }
  const ids: (string | undefined)[] = []
  let finishes = 0
  bindReplayControls(replay as unknown as HTMLButtonElement, input as unknown as HTMLInputElement, live as unknown as HTMLButtonElement, {
    enterReplay: () => {}, push: frame => ids.push(frame.id), finish: () => { finishes++ }, status: () => {}, returnLive: async () => {},
  })
  replay.click()
  chosen = { name: 'new.jsonl', text: async () => recording.replace('"event"', '"new-event"') }
  replay.click(); await tick(); await vi.advanceTimersByTimeAsync(1000)
  release(recording); await tick(); await vi.advanceTimersByTimeAsync(1000)
  expect(ids).toEqual(['new-event'])
  expect(finishes).toBe(1)
})
it('choosing replay without a file does not enter replay or cancel live work', () => {
  const replay = control(), live = control(), input = { files: [], addEventListener: () => {} }
  let entered = 0, errors = 0
  const gate = bindReplayControls(replay as unknown as HTMLButtonElement, input as unknown as HTMLInputElement, live as unknown as HTMLButtonElement, {
    enterReplay: () => { entered++ }, push: () => {}, finish: () => {}, status: (_message, error) => { if (error) errors++ }, returnLive: async () => {},
  })
  const current = gate.current()
  replay.click()
  expect([entered, errors, current()]).toEqual([0, 1, true])
})
it('starting an offline demo invalidates a pending startup/live or file-playback generation', async () => {
  const replay = control(), live = control(), input = { files: [], addEventListener: () => {} }
  const gate = bindReplayControls(replay as unknown as HTMLButtonElement, input as unknown as HTMLInputElement, live as unknown as HTMLButtonElement, {
    enterReplay: () => {}, push: () => {}, finish: () => {}, status: () => {}, returnLive: async () => {},
  })
  const pending = gate.current()
  gate.cancel()
  expect(pending()).toBe(false)
})

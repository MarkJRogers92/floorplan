import type { Frame } from '../api/sse'
import { parseRecording } from '../replay/parse'
import { replayFrames } from '../replay/play'

/** A mode switch invalidates old files, deliveries and completion callbacks, not live jobs. */
export function bindReplayControls(replay: HTMLButtonElement, input: HTMLInputElement, live: HTMLButtonElement, actions: {
  enterReplay(): void; push(frame: Frame): void; finish(): void
  status(message: string, error?: boolean): void
  returnLive(current: () => boolean): Promise<void>
}) {
  let generation = 0
  const current = () => { const started = generation; return () => started === generation }
  replay.addEventListener('click', () => {
    const file = input.files?.[0]
    if (!file) { actions.status('choose a .jsonl recording first', true); return }
    generation++
    const valid = current()
    actions.enterReplay()
    void (async () => {
      try {
        const text = await file.text()
        if (!valid()) return
        const frames = parseRecording(text)
        actions.status(`replaying ${frames.length} frames`)
        await replayFrames(frames, frame => { if (valid()) actions.push(frame) }, 250)
        if (valid()) { actions.finish(); actions.status('replay done') }
      } catch (error) { if (valid()) actions.status((error as Error).message, true) }
    })()
  })
  live.addEventListener('click', () => {
    generation++
    const valid = current()
    void actions.returnLive(valid).catch(() => { if (valid()) actions.status('Could not return to live.', true) })
  })
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    replay.textContent = file ? `Replay ${file.name}` : 'Replay'
  })
  return { current, cancel: () => { generation++ } }
}

import type { Frame } from '../api/sse'

/**
 * Wait `ms`, or less if `signal` aborts first. Resolves (never rejects) either way,
 * clears its timer on abort and removes its listener on both paths, so a long replay
 * leaves nothing behind.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/**
 * Emit frames one at a time, `stepMs` apart, so the room visibly evolves. Pure and
 * browser-safe — no node: imports — so the page can replay a recording it already
 * holds. Resolves early, without throwing, as soon as `signal` aborts, including
 * mid-delay.
 */
export async function replayFrames(
  frames: Frame[],
  onFrame: (f: Frame) => void,
  stepMs = 250,
  signal?: AbortSignal,
): Promise<void> {
  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) return
    if (i > 0 && stepMs > 0) await delay(stepMs, signal)
    if (signal?.aborted) return
    onFrame(frames[i])
  }
}

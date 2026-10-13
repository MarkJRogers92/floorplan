import { readFileSync } from 'node:fs'
import type { Frame } from '../api/sse'
import { parseRecording } from './parse'

/** Read a recording from disk. Node-only; the parsing itself is `parseRecording`. */
export function readFrames(file: string): Frame[] {
  return parseRecording(readFileSync(file, 'utf8'))
}

/**
 * Emit a recording's frames one at a time, `stepMs` apart, so the room visibly
 * evolves. Feed `onFrame` into the same registry the live stream uses. Resolves early,
 * without throwing, once `signal` aborts.
 */
export async function replay(
  file: string,
  onFrame: (f: Frame) => void,
  stepMs = 250,
  signal?: AbortSignal,
): Promise<void> {
  const frames = readFrames(file)
  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) return
    if (i > 0 && stepMs > 0) await new Promise(r => setTimeout(r, stepMs))
    if (signal?.aborted) return
    onFrame(frames[i])
  }
}

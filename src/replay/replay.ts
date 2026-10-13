import { readFileSync } from 'node:fs'
import type { Frame } from '../api/sse'
import { parseRecording } from './parse'
import { replayFrames } from './play'

/** Read a recording from disk. Node-only; the parsing itself is `parseRecording`. */
export function readFrames(file: string): Frame[] {
  return parseRecording(readFileSync(file, 'utf8'))
}

/**
 * Node wrapper: read a recording from disk and play it with `replayFrames`. Feed
 * `onFrame` into the same registry the live stream uses. Resolves early, without
 * throwing, once `signal` aborts. The page imports `replayFrames` from `./play`
 * directly, never this module.
 */
export async function replay(
  file: string,
  onFrame: (f: Frame) => void,
  stepMs = 250,
  signal?: AbortSignal,
): Promise<void> {
  return replayFrames(readFrames(file), onFrame, stepMs, signal)
}

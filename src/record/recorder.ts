import { openSync, writeSync } from 'node:fs'
import type { Frame } from '../api/sse'

/**
 * Append every frame to `file` as one JSON line: `{ id, type, data }`.
 *
 * Node-only, like `readService`: recording is a terminal concern and this module
 * is never imported by the page. The descriptor is opened once in append mode and
 * each frame is a single synchronous write with no buffering of our own, so a kill
 * loses at most the line in flight — which replay skips (Task 9).
 */
export function createRecorder(file: string): (frame: Frame) => void {
  const fd = openSync(file, 'a')
  return frame => {
    writeSync(fd, JSON.stringify({ id: frame.id, type: frame.type, data: frame.data }) + '\n')
  }
}

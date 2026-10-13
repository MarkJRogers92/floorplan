// src/cli/connect.ts — a script, not a library. Run: bun run src/cli/connect.ts
//
// Streams OpenCode's events, records every frame to fixtures/raw/<timestamp>.jsonl,
// and prints one line per frame with its type only — never its data, which carries
// prompts, paths and command output. Ctrl-C prints a count and exits.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readService } from '../api/service'
import { streamFrames } from '../api/stream'
import { createRecorder } from '../record/recorder'

const rawDir = fileURLToPath(new URL('../../fixtures/raw/', import.meta.url))
mkdirSync(rawDir, { recursive: true })
const file = join(rawDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)

let service
try {
  service = readService()
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}

const record = createRecorder(file)
const abort = new AbortController()
let count = 0

const finish = (why: string) => {
  console.log(`\n${why}: recorded ${count} frame${count === 1 ? '' : 's'} to ${file}`)
  process.exit(0)
}
process.on('SIGINT', () => {
  abort.abort()
  finish('stopped')
})

console.log(`recording ${service.url}/api/event → ${file}  (Ctrl-C to stop)`)
// A failure to write the recording (ENOSPC, EIO, ...) is ours, not the stream's: tag it
// so it is not reported as a stream failure, and stop the stream so nothing is lost silently.
class RecordingError extends Error {}

try {
  await streamFrames(service, '/api/event', frame => {
    try {
      record(frame)
    } catch (err) {
      abort.abort()
      throw new RecordingError((err as Error).message)
    }
    count++
    console.log(frame.type)
  }, abort.signal)
  finish('stream ended')
} catch (err) {
  // Neither message ever contains the password: one names a filesystem error, the
  // other a status code or a connection failure.
  if (err instanceof RecordingError) {
    console.error(`could not write the recording to ${file}: ${err.message}`)
    process.exit(1)
  }
  if (abort.signal.aborted) finish('stopped')
  console.error(`could not read the event stream at ${service.url}: ${(err as Error).message}`)
  process.exit(1)
}

import { authedFetch } from './client'
import type { Service } from './service'
import { parseFrames, type Frame } from './sse'

/**
 * Open a server-sent event stream and call `onFrame` for every whole frame.
 * Reads the response body incrementally so frames split across chunk boundaries
 * are not lost. Throws when the response is not OK or has no body so callers
 * can retry/reconnect.
 */
export async function streamFrames(
  service: Service,
  path: string,
  onFrame: (f: Frame) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await authedFetch(service, path, { signal })
  if (!res.ok) throw new Error(`OpenCode stream returned ${res.status} ${res.statusText}`)
  if (!res.body) throw new Error('OpenCode stream response has no body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let rest = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    const { frames, rest: newRest } = parseFrames(rest + chunk)
    rest = newRest
    for (const frame of frames) onFrame(frame)
  }

  // Flush any trailing bytes into final frames.
  const { frames } = parseFrames(rest + decoder.decode())
  for (const frame of frames) onFrame(frame)
}

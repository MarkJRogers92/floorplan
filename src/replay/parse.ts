import { toFrame, type Frame } from '../api/sse'

/**
 * Turn a recording's text into frames. Pure and browser-safe. Never throws on
 * content: blank lines, lines that do not parse (such as a final line cut off by a
 * kill mid-write) and lines without a string `type` are dropped, not fatal. Each line
 * is normalised exactly as a live SSE payload is, so replay and live cannot disagree.
 */
export function parseRecording(text: string): Frame[] {
  const frames: Frame[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    const frame = toFrame(value)
    if (frame) frames.push(frame)
  }
  return frames
}

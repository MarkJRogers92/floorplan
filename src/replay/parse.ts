import type { Frame } from '../api/sse'

/**
 * Turn a recording's text into frames. Pure and browser-safe. Never throws on
 * content: blank lines, lines that do not parse (such as a final line cut off by a
 * kill mid-write) and lines without a string `type` are dropped, not fatal.
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
    if (typeof value !== 'object' || value === null) continue
    const { id, type, data } = value as Partial<Frame>
    if (typeof type !== 'string') continue
    frames.push(typeof id === 'string' ? { id, type, data } : { type, data })
  }
  return frames
}

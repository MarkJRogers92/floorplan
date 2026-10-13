// src/api/sse.ts
/**
 * One parsed SSE frame. OpenCode puts id/type/data inside the JSON payload, and on
 * session frames also `created` (ms) and `location` (which project); the narrative
 * layer needs both for timing and for grouping chats into a series.
 */
export type Frame = { id?: string; created?: number; type: string; location?: { directory?: string }; data: unknown }

/** Normalise one decoded payload into a Frame, or undefined if it has no string type. */
export function toFrame(payload: unknown): Frame | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const { id, created, type, location, data } = payload as Record<string, unknown>
  if (typeof type !== 'string') return undefined
  const frame: Frame = { type, data }
  if (typeof id === 'string') frame.id = id
  if (typeof created === 'number' && Number.isFinite(created)) frame.created = created
  if (typeof location === 'object' && location !== null) {
    const directory = (location as Record<string, unknown>).directory
    if (typeof directory === 'string') frame.location = { directory }
  }
  return frame
}

/**
 * Split a buffer into whole frames. `\n\n` (an empty line) terminates an SSE
 * frame; a bare `\n` only separates field lines inside one frame, so the text
 * after the last `\n\n` may still be a live frame and is returned untouched as
 * `rest` for the caller to prepend to the next chunk.
 */
export function parseFrames(buffer: string): { frames: Frame[]; rest: string } {
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  const frames: Frame[] = []
  for (const block of blocks) {
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue // heartbeat comment
      if (line.startsWith('data:')) dataLines.push(line.slice(5))
      // other fields (event:, id:) carry nothing OpenCode does not also put in the payload
    }
    let payload: unknown
    try {
      payload = JSON.parse(dataLines.join('\n'))
    } catch {
      continue // not JSON: drop the frame rather than throw
    }
    const frame = toFrame(payload)
    if (frame) frames.push(frame)
  }
  return { frames, rest }
}

// src/api/sse.ts
/** One parsed SSE frame. OpenCode puts id/type/data inside the JSON payload. */
export type Frame = { id?: string; type: string; data: unknown }

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
    if (typeof payload !== 'object' || payload === null) continue
    const { id, type, data } = payload as Partial<Frame>
    if (typeof type !== 'string') continue
    frames.push(typeof id === 'string' ? { id, type, data } : { type, data })
  }
  return { frames, rest }
}

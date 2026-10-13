import type { IncomingMessage, ServerResponse } from 'node:http'

export class HTTPError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export function assertLocal(req: IncomingMessage, post = false): void {
  const host = req.headers.host ?? ''
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host) ||
      (req.headers.origin !== undefined && req.headers.origin !== `http://${host}`) ||
      (post && req.headers.origin !== `http://${host}`)) throw new HTTPError(403, 'forbidden')
}
export function sendJSON(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(value))
}
export async function readJSONBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new HTTPError(415, 'JSON required')
  if (Number(req.headers['content-length']) > maxBytes) throw new HTTPError(413, 'request too large')
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
    size += bytes.byteLength
    if (size > maxBytes) throw new HTTPError(413, 'request too large')
    chunks.push(bytes)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder().decode(bytes)) }
  catch { throw new HTTPError(400, 'invalid request') }
}

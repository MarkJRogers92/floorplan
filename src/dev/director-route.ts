import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_SCENE_BYTES, parseDirectorRequest } from './director-input'
import type { createDirectorService } from './director-service'

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export function createDirectorHandler(service: ReturnType<typeof createDirectorService>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, value: unknown) => {
      if (res.destroyed) return
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(JSON.stringify(value))
    }
    const host = req.headers.host ?? ''
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host) ||
        (req.headers.origin !== undefined && req.headers.origin !== `http://${host}`)) return send(403, { error: 'forbidden' })
    const path = req.url ?? ''
    if (path === '/state' && req.method === 'GET') return send(200, service.state())
    if (!['/control', '/opt-out', '/scene'].includes(path)) return send(404, { error: 'not found' })
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' })
    if (req.headers.origin !== `http://${host}`) return send(403, { error: 'forbidden' })
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return send(415, { error: 'JSON required' })
    const declared = req.headers['content-length']
    if (declared && Number(declared) > MAX_SCENE_BYTES) return send(413, { error: 'request too large' })
    try {
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of req) {
        const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
        size += bytes.byteLength
        if (size > MAX_SCENE_BYTES) { send(413, { error: 'request too large' }); return }
        chunks.push(bytes)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
      if (path === '/control' && object(body) && Object.keys(body).length === 1 && typeof body.enabled === 'boolean') {
        return send(200, service.control(body.enabled))
      }
      if (path === '/opt-out' && object(body) && Object.keys(body).length === 2 && typeof body.rootSessionID === 'string' &&
          body.rootSessionID.length > 0 && body.rootSessionID.length <= 256 && typeof body.disabled === 'boolean') {
        return send(200, service.optOut(body.rootSessionID, body.disabled))
      }
      if (path === '/scene') {
        const request = parseDirectorRequest(body)
        if (request) return send(200, await service.direct(request))
      }
      send(400, { error: 'invalid request' })
    } catch { send(400, { error: 'invalid request' }) }
  }
}

import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_SCENE_BYTES, parseDirectorRequest } from './director-input'
import type { createDirectorService } from './director-service'
import { assertLocal, readJSONBody, sendJSON, HTTPError } from './http-guard'

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export function createDirectorHandler(service: ReturnType<typeof createDirectorService>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      assertLocal(req)
      const path = req.url ?? ''
      if (path === '/state' && req.method === 'GET') return sendJSON(res, 200, service.state())
      if (!['/control', '/opt-out', '/scene'].includes(path)) throw new HTTPError(404, 'not found')
      if (req.method !== 'POST') throw new HTTPError(405, 'method not allowed')
      assertLocal(req, true)
      const body = await readJSONBody(req, MAX_SCENE_BYTES)
      if (path === '/control' && object(body) && Object.keys(body).length === 1 && typeof body.enabled === 'boolean') {
        return sendJSON(res, 200, service.control(body.enabled))
      }
      if (path === '/opt-out' && object(body) && Object.keys(body).length === 2 && typeof body.rootSessionID === 'string' &&
          body.rootSessionID.length > 0 && body.rootSessionID.length <= 256 && typeof body.disabled === 'boolean') {
        return sendJSON(res, 200, service.optOut(body.rootSessionID, body.disabled))
      }
      if (path === '/scene') {
        const request = parseDirectorRequest(body)
        if (request) return sendJSON(res, 200, await service.direct(request))
      }
      throw new HTTPError(400, 'invalid request')
    } catch (error) { sendJSON(res, error instanceof HTTPError ? error.status : 400,
      { error: error instanceof HTTPError ? error.message : 'invalid request' }) }
  }
}

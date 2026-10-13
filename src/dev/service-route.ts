import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Service } from '../api/service'

/**
 * Development-only handler: serves the OpenCode service credentials to our own page.
 *
 * The browser cannot read `~/.local/state/opencode/service.json`, so Vite mounts this
 * at `GET /__service` and the page fetches it for `{url, password}`. A shippable build
 * will need a real credential path instead of this route.
 *
 * The password is never logged or rendered. Errors return 404 with a generic message
 * and do not echo the path or password.
 */
export function createServiceHandler(read: () => Service): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== undefined) {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'method not allowed' }))
      return
    }

    try {
      const service = read()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(service))
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'OpenCode service not found' }))
    }
  }
}

import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createServiceHandler } from '../../src/dev/service-route'

async function serve(read: () => unknown) {
  const s = createServer(createServiceHandler(read as never))
  s.listen(0, '127.0.0.1'); await once(s, 'listening')
  const { port } = s.address() as { port: number }
  const r = await fetch(`http://127.0.0.1:${port}/__service`)
  const body = await r.text()
  s.close()
  return { status: r.status, body }
}

describe('createServiceHandler', () => {
  it('serves the service as JSON', async () => {
    const { status, body } = await serve(() => ({ url: 'http://127.0.0.1:1', password: 'pw' }))
    expect(status).toBe(200)
    expect(JSON.parse(body)).toEqual({ url: 'http://127.0.0.1:1', password: 'pw' })
  })

  it('reports a failure without echoing a path or a password', async () => {
    const { status, body } = await serve(() => {
      throw new Error('OpenCode service file not found at /x/service.json')
    })
    expect(status).toBe(404)
    expect(JSON.parse(body).error).toMatch(/not found/i)
    expect(body).not.toMatch(/secret|password/i)
  })
})

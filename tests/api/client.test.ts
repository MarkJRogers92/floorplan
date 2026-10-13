import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { authedFetch } from '../../src/api/client'

async function stub(handler: (req: any, res: any) => void) {
  const s = createServer(handler); s.listen(0, '127.0.0.1'); await once(s, 'listening')
  const { port } = s.address() as any
  return { url: `http://127.0.0.1:${port}`, close: () => s.close() }
}

describe('authedFetch', () => {
  it('sends HTTP Basic opencode:<password>', async () => {
    let seen = ''
    const s = await stub((req, res) => { seen = req.headers.authorization ?? ''; res.end('{}') })
    await authedFetch({ url: s.url, password: 'pw' }, '/api/model')
    expect(seen).toBe('Basic ' + Buffer.from('opencode:pw').toString('base64'))
    s.close()
  })

  it('joins base url and path without doubling slashes', async () => {
    let seen = ''
    const s = await stub((req, res) => { seen = req.url ?? ''; res.end('{}') })
    await authedFetch({ url: s.url + '/', password: 'pw' }, '/api/model')
    expect(seen).toBe('/api/model')
    s.close()
  })

  it('returns the response on a 404 rather than throwing', async () => {
    const s = await stub((_req, res) => { res.statusCode = 404; res.end('nope') })
    const r = await authedFetch({ url: s.url, password: 'pw' }, '/api/nope')
    expect(r.status).toBe(404)
    s.close()
  })
})

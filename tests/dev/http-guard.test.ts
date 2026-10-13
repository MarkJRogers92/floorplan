import { it, expect } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { assertLocal, readJSONBody, sendJSON, HTTPError } from '../../src/dev/http-guard'

async function serverTest(run: (base: string) => Promise<void>) {
  const server = createServer(async (req, res) => {
    try {
      assertLocal(req, true)
      const data = await readJSONBody(req, 1024)
      sendJSON(res, 200, data)
      sendJSON(res, 500, { error: 'late completion must not double-send' })
    } catch (error) { sendJSON(res, error instanceof HTTPError ? error.status : 400, { error: 'rejected' }) }
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`) }
  finally { server.closeAllConnections(); server.close(); await once(server, 'close') }
}
it('same-origin JSON succeeds once even if a late result tries to send again', () => serverTest(async base => {
  const response = await fetch(base, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{"ok":true}' })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
}))
it('foreign/missing Origin and forged host fail before reading a body', () => serverTest(async base => {
  for (const headers of [{ Origin: 'https://elsewhere.example' }, { Origin: '' }, { Origin: 'null' }]) {
    expect((await fetch(base, { method: 'POST', headers, body: 'not JSON' })).status).toBe(403)
  }
  expect((await fetch(base, { method: 'POST', headers: { Host: 'evil.example', Origin: 'http://evil.example' } })).status).toBe(403)
}))
it('byte limits and content-type guards are real HTTP boundaries', () => serverTest(async base => {
  expect((await fetch(base, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify('x'.repeat(1025)) })).status).toBe(413)
  expect((await fetch(base, { method: 'POST', headers: { Origin: base, 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415)
}))

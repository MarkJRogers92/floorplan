import { it, expect } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createDirectorHandler } from '../../src/dev/director-route'
import { createDirectorService } from '../../src/dev/director-service'

async function serve(run: (base: string, service: ReturnType<typeof createDirectorService>, calls: () => number) => Promise<void>) {
  let calls = 0
  const service = createDirectorService({ key: 'synthetic-route-secret', enabled: true, episodeCapCents: 30, runCapCents: 100 }, async () => {
    calls++
    return { lines: [{ speaker: 'narrator', template: 'An administrative victory.', cites: ['a'], flashback: false }] }
  })
  const server = createServer(createDirectorHandler(service))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try { await run(base, service, () => calls) }
  finally { server.closeAllConnections(); server.close(); await once(server, 'close') }
}
const payload = { sceneID: 'scene:a', sessions: [{ id: 'root', agent: 'build' }], beats: [{
  id: 'a', at: 0, endAt: 0, eventIDs: ['e'], sessionID: 'root', kind: 'wrap', detail: { kind: 'wrap' },
}] }
const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body),
})

it('serves safe state and requires explicit control before scene generation', () => serve(async (base, _, calls) => {
  const state = await (await fetch(base + '/state')).text()
  expect(state).not.toContain('synthetic-route-secret')
  expect(JSON.parse(state)).toMatchObject({ available: true, enabled: false, reservedCents: 0 })
  expect((await (await post(base, '/scene', payload)).json()).mode).toBe('templates')
  expect(calls()).toBe(0)
  await post(base, '/control', { enabled: true })
  expect((await (await post(base, '/scene', payload)).json()).mode).toBe('director')
  expect(calls()).toBe(1)
}))
it('rejects foreign/missing origins and forged Host before spending', () => serve(async (base, _, calls) => {
  const cases: Record<string, string>[] = [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: '' }, { Host: 'evil.example', Origin: 'http://evil.example' }]
  for (const headers of cases) {
    expect((await post(base, '/control', { enabled: true }, headers)).status).toBe(403)
    expect((await post(base, '/scene', payload, headers)).status).toBe(403)
  }
  expect(calls()).toBe(0)
}))
it('rejects oversize, wrong content type, invalid JSON/shape and methods', () => serve(async (base, service, calls) => {
  service.control(true)
  expect((await post(base, '/scene', { text: 'x'.repeat(33_000) })).status).toBe(413)
  expect((await post(base, '/scene', payload, { 'Content-Type': 'text/plain' })).status).toBe(415)
  expect((await post(base, '/scene', { raw: 'not beats' })).status).toBe(400)
  expect((await fetch(base + '/scene', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400)
  expect((await fetch(base + '/scene')).status).toBe(405)
  expect((await fetch(base + '/missing')).status).toBe(404)
  expect(calls()).toBe(0)
}))
it('opt-out excludes guests in the root chat and disable stops all calls', () => serve(async (base, service, calls) => {
  service.control(true)
  await post(base, '/opt-out', { rootSessionID: 'root', disabled: true })
  expect((await (await post(base, '/scene', payload)).json()).reason).toBe('opt-out')
  await post(base, '/control', { enabled: false })
  expect((await (await post(base, '/scene', payload)).json()).reason).toBe('disabled')
  expect(calls()).toBe(0)
}))

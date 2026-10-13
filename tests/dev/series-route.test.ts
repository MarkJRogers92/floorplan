import { it, expect } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm, chmod, readdir } from 'node:fs/promises'
import { createSeriesHandler } from '../../src/dev/series-route'
import { createSeriesStore } from '../../server/series-store'

const key = 'directory:/fake/project'
const episode = (root = 'root', beatIDs = ['a']) => ({
  id: `ep:${root}`, rootSessionID: root, seriesKey: key, sessions: [{ id: root, agent: 'build' }],
  beats: beatIDs.map(id => ({ id, at: 0, endAt: 0, eventIDs: [id], kind: 'wrap', sessionID: root, detail: { kind: 'wrap' } })),
})

async function serve(run: (base: string, root: string) => Promise<void>) {
  const root = await mkdtemp('/private/var/folders/q6/wd0w60596vg_rnm736shphw00000gn/T/opencode/floorplan-route-')
  const server = createServer(createSeriesHandler(createSeriesStore(root)))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try { await run(base, root) }
  finally {
    server.closeAllConnections(); server.close(); await once(server, 'close')
    await chmod(root, 0o700); await rm(root, { recursive: true, force: true })
  }
}
const post = (base: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + '/episode', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body),
})
const context = (base: string, query: Record<string, string>) =>
  fetch(`${base}/context?${new URLSearchParams(query)}`, { headers: { Origin: base } })

it('persists a valid episode and serves only aggregated previous history', () => serve(async (base, root) => {
  expect(await (await post(base, episode('old', ['old']))).json()).toEqual({ saved: true, episodeCount: 1 })
  expect(await (await post(base, episode('root', ['now']))).json()).toEqual({ saved: true, episodeCount: 2 })
  const response = await context(base, { key, root: 'root', agent: 'build' })
  expect(response.status).toBe(200)
  const raw = await response.text()
  const body = JSON.parse(raw)
  expect(Object.keys(body).sort()).toEqual(['bibles', 'episodeCount', 'key', 'personas'])
  expect(body).toMatchObject({ key, episodeCount: 2, personas: [] })
  expect(body.bibles).toHaveLength(1)
  expect(body.bibles[0]).toMatchObject({ agent: 'build', episodes: ['ep:old'],
    wraps: { count: 1, refs: [{ episodeID: 'ep:old', beatID: 'old' }] } })
  // Aggregates and proof refs only: no archived beat bodies or raw event IDs.
  expect(raw).not.toContain('eventIDs')
  expect(raw).not.toContain('"beats"')
  expect((await (await context(base, { key, root: 'root', agent: 'explore' })).json()).bibles).toEqual([])
  expect((await (await post(base, episode('root', ['more']))).json()).episodeCount).toBe(2)
  expect(await readdir(root)).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)])
}))

it('rejects foreign/missing/null Origin and forged Host before writing anything', () => serve(async (base, root) => {
  const cases: Record<string, string>[] = [{ Origin: 'https://evil.example' }, { Origin: '' }, { Origin: 'null' },
    { Host: 'evil.example', Origin: 'http://evil.example' }]
  for (const headers of cases) expect((await post(base, episode(), headers)).status).toBe(403)
  const anonymous = await fetch(base + '/episode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(episode()) })
  expect(anonymous.status).toBe(403)
  expect((await fetch(base + '/context?key=x', { headers: { Origin: 'https://evil.example' } })).status).toBe(403)
  expect(await readdir(root)).toEqual([])
}))

it('rejects oversize bodies, wrong content type, invalid shape, unknown paths and methods', () => serve(async (base, root) => {
  expect((await post(base, { note: 'x'.repeat(2 * 1024 * 1024 + 128) })).status).toBe(413)
  expect((await post(base, episode(), { 'Content-Type': 'text/plain' })).status).toBe(415)
  expect((await post(base, { raw: 'not beats' })).status).toBe(400)
  expect((await post(base, { ...episode(), id: 'ep:other' })).status).toBe(400)
  expect((await fetch(base + '/episode', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400)
  expect((await fetch(base + '/missing', { headers: { Origin: base } })).status).toBe(404)
  expect((await fetch(base + '/episode', { method: 'GET', headers: { Origin: base } })).status).toBe(405)
  expect((await post(base, episode('root', ['x']), { Origin: '' })).status).toBe(403)
  expect(await readdir(root)).toEqual([])
}))

it('rejects invalid series keys without escaping the store root', () => serve(async (base, root) => {
  for (const bad of ['../escape', 'not-a-scope', '', 'directory:']) {
    expect((await post(base, { ...episode(), seriesKey: bad })).status).toBe(400)
    expect((await context(base, { key: bad, root: 'root', agent: 'build' })).status).toBe(400)
  }
  expect((await context(base, { root: 'root', agent: 'build' })).status).toBe(400)
  expect((await context(base, { key: key, agent: 'build' })).status).toBe(400)
  expect(await readdir(root)).toEqual([])
}))

it('keeps older beat ids when a partial episode is re-saved', () => serve(async (base, root) => {
  expect(await (await post(base, episode('root', ['a']))).json()).toEqual({ saved: true, episodeCount: 1 })
  expect(await (await post(base, episode('root', ['b']))).json()).toEqual({ saved: true, episodeCount: 1 })
  const archive = await createSeriesStore(root).load(key)
  expect(archive.episodes.map(e => e.id)).toEqual(['ep:root'])
  expect(archive.episodes[0].beats.map(b => b.id).sort()).toEqual(['a', 'b'])
  expect(archive.episodes[0].seriesKey).toBe(key)
}))

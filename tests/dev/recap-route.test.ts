import { it, expect } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createSeriesStore } from '../../server/series-store'
import { createSeriesHandler } from '../../src/dev/series-route'
import type { ArchivedEpisode } from '../../src/narrative/series'

const key = 'directory:/synthetic/recap'
const episode = (root: string, at: number, kind: 'wrap' | 'tool-fails' = 'wrap'): ArchivedEpisode => ({
  id: `ep:${root}`, rootSessionID: root, seriesKey: key, sessions: [{ id: root, agent: 'build' }],
  beats: [{ id: 'same', sessionID: root, at, endAt: at, eventIDs: [`event:${root}`], kind,
    detail: kind === 'wrap' ? { kind } : { kind, tool: 'shell', exit: 7 } }],
})
async function serve(run: (base: string, root: string, store: ReturnType<typeof createSeriesStore>) => Promise<void>) {
  const root = await mkdtemp('/private/var/folders/q6/wd0w60596vg_rnm736shphw00000gn/T/opencode/floorplan-recap-http-')
  const store = createSeriesStore(root)
  const server = createServer(createSeriesHandler(store))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try { await run(base, root, store) }
  finally { server.closeAllConnections(); server.close(); await once(server, 'close'); await rm(root, { recursive: true, force: true }) }
}
const fileFor = (root: string) => join(root, createHash('sha256').update(key).digest('hex'), 'series.json')
const query = (base: string, params: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  fetch(`${base}/recap?${new URLSearchParams({ key, root: 'current', before: '1000', ...params })}`, { headers })

it('serves bounded proved earlier clips without changing archive bytes or conflating episode beat IDs', () => serve(async (base, root, store) => {
  for (const [id, at] of [['older', 100], ['recent', 200], ['current', 800], ['future', 2000], ['unknown', 0]] as const) {
    await store.saveEpisode(episode(id, at, 'tool-fails'))
  }
  const before = await readFile(fileFor(root))
  const response = await query(base)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  const body = await response.json()
  expect(body).toMatchObject({ key, rootSessionID: 'current', before: 1000, coverage: 'partial' })
  expect(body.moments.map((m: any) => [m.episodeID, m.beat.id, m.session.agent])).toEqual([
    ['ep:older', 'same', 'build'], ['ep:recent', 'same', 'build'],
  ])
  expect(await readFile(fileFor(root))).toEqual(before)
}))
it('missing local history stays empty and creates no directories', () => serve(async (base, root) => {
  const response = await query(base)
  expect(response.status).toBe(200)
  expect((await response.json()).moments).toEqual([])
  expect(await readdir(root)).toEqual([])
}))
it('rejects bad scope/root/clock/method and foreign origin before archive access', () => serve(async (base, root) => {
  for (const before of ['', '0', '-1', 'NaN', 'Infinity', '100x', '1e300']) expect((await query(base, { before })).status).toBe(400)
  expect((await query(base, { key: '../escape' })).status).toBe(400)
  expect((await query(base, { root: '' })).status).toBe(400)
  expect((await query(base, {}, { Origin: 'https://foreign.example' })).status).toBe(403)
  expect((await fetch(`${base}/recap?key=x`, { method: 'POST', headers: { Origin: base } })).status).toBe(405)
  expect(await readdir(root)).toEqual([])
}))
it('corrupt history is refused intact, never repaired for a recap', () => serve(async (base, root, store) => {
  await store.saveEpisode(episode('older', 100))
  await writeFile(fileFor(root), '{corrupt', { mode: 0o600 })
  const response = await query(base)
  expect(response.status).toBe(409)
  expect(await readFile(fileFor(root), 'utf8')).toBe('{corrupt')
}))

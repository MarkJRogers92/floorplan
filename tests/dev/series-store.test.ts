import { it, expect } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, stat, symlink, chmod, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createSeriesStore } from '../../server/series-store'
import type { ArchivedEpisode } from '../../src/narrative/series'

const key = 'directory:/fake/project'
const ep = (ids = ['a'], root = 'root'): ArchivedEpisode => ({ id: `ep:${root}`, rootSessionID: root, seriesKey: key,
  sessions: [{ id: root, agent: 'build', seriesKey: key }], beats: ids.map(id => ({ id, at: 0, endAt: 0, eventIDs: [id],
    kind: 'wrap', sessionID: root, detail: { kind: 'wrap' } })) })
const approvedTemp = '/private/var/folders/q6/wd0w60596vg_rnm736shphw00000gn/T/opencode'
async function temp(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(approvedTemp, 'floorplan-series-'))
  try { await run(root) } finally { await chmod(root, 0o700); await rm(root, { recursive: true, force: true }) }
}
const dir = (root: string, k = key) => join(root, createHash('sha256').update(k).digest('hex'))
const file = (root: string) => join(dir(root), 'series.json')

it('persists additive episode snapshots across independent store instances', () => temp(async root => {
  const first = createSeriesStore(root)
  expect((await first.load(key)).episodes).toEqual([])
  await first.saveEpisode(ep(['a', 'b']))
  await createSeriesStore(root).saveEpisode(ep(['b', 'c']))
  await first.saveEpisode(ep(['d'], 'other'))
  const archive = await createSeriesStore(root).load(key)
  expect(archive.episodes.map(e => e.id)).toEqual(['ep:root', 'ep:other'])
  expect(archive.episodes[0].beats.map(b => b.id)).toEqual(['a', 'b', 'c'])
  expect(await readdir(dir(root))).toEqual(['series.json'])
}))
it('uses hashed paths and private file/directory permissions, not a browser path', () => temp(async root => {
  const evilKey = 'directory:../../unrelated'
  await createSeriesStore(root).saveEpisode({ ...ep(), seriesKey: evilKey, sessions: [{ id: 'root', agent: 'build' }] })
  expect((await stat(dir(root, evilKey))).mode & 0o777).toBe(0o700)
  expect((await stat(join(dir(root, evilKey), 'series.json'))).mode & 0o777).toBe(0o600)
  expect((await readdir(root)).length).toBe(1)
  await expect(createSeriesStore(root).load('../not-a-key')).rejects.toThrow()
}))
it('corrupt files and immutable conflicts are reported without replacing bytes', () => temp(async root => {
  const store = createSeriesStore(root)
  await store.saveEpisode(ep())
  const before = await readFile(file(root), 'utf8')
  const changed = ep(); changed.beats[0].at = 10
  await expect(store.saveEpisode(changed)).rejects.toThrow()
  expect(await readFile(file(root), 'utf8')).toBe(before)
  await writeFile(file(root), '{not json', { mode: 0o600 })
  await expect(store.saveEpisode(ep(['b']))).rejects.toThrow()
  expect(await readFile(file(root), 'utf8')).toBe('{not json')
}))
it('refuses symlinked archive files and preserves the target', () => temp(async root => {
  const store = createSeriesStore(root)
  await store.saveEpisode(ep())
  const target = join(root, 'protected.json')
  await writeFile(target, 'protected', { mode: 0o600 })
  await rm(file(root)); await symlink(target, file(root))
  await expect(store.load(key)).rejects.toThrow()
  await expect(store.saveEpisode(ep(['b']))).rejects.toThrow()
  expect(await readFile(target, 'utf8')).toBe('protected')
}))
it('refuses symlinked series directories and stale/symlink locks', () => temp(async root => {
  const target = join(root, 'target'); await mkdir(target, { mode: 0o700 })
  await symlink(target, dir(root))
  await expect(createSeriesStore(root).saveEpisode(ep())).rejects.toThrow()
  expect(await readdir(target)).toEqual([])
  await rm(dir(root)); await mkdir(dir(root), { mode: 0o700 })
  const lock = join(dir(root), '.lock')
  await writeFile(lock, 'owned by another writer', { mode: 0o600 })
  await expect(createSeriesStore(root).saveEpisode(ep())).rejects.toThrow()
  expect(await readFile(lock, 'utf8')).toBe('owned by another writer')
  await rm(lock); await symlink(target, lock)
  await expect(createSeriesStore(root).saveEpisode(ep())).rejects.toThrow()
}))
it('concurrent stores never overwrite one another silently', () => temp(async root => {
  const store = createSeriesStore(root)
  await store.saveEpisode(ep())
  const results = await Promise.allSettled([store.saveEpisode(ep(['b'])), createSeriesStore(root).saveEpisode(ep(['c']))])
  expect(results.filter(r => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
  const ids = (await store.load(key)).episodes[0].beats.map(b => b.id)
  expect(ids).toContain('a')
  for (const [i, result] of results.entries()) if (result.status === 'fulfilled') expect(ids).toContain(i === 0 ? 'b' : 'c')
}))
it('does not weaken existing readonly permissions to force a save', () => temp(async root => {
  const store = createSeriesStore(root)
  await store.saveEpisode(ep())
  const before = await readFile(file(root), 'utf8')
  await chmod(file(root), 0o400)
  await expect(store.saveEpisode(ep(['b']))).rejects.toThrow()
  expect(await readFile(file(root), 'utf8')).toBe(before)
  expect((await stat(file(root))).mode & 0o777).toBe(0o400)
}))
it('saves a fictional profile once with a real debut, preserves valid hand edits', () => temp(async root => {
  const store = createSeriesStore(root)
  await store.savePersonas(key, ep(), [{ agent: 'build', text: 'A weary foreman with a desperate need for order.' }])
  const first = (await store.load(key)).personas[0]
  expect(first.debut).toEqual({ episodeID: 'ep:root', beatID: 'a' })
  await store.savePersonas(key, ep(['b']), [{ agent: 'build', text: 'A confident newcomer.' }, { agent: 'explore', text: 'An impostor.' }])
  expect((await store.load(key)).personas).toEqual([first])
  const edited = await store.load(key); edited.personas[0].text = 'A suspiciously serene foreman.'
  await writeFile(file(root), JSON.stringify(edited), { mode: 0o600 })
  await store.savePersonas(key, ep(['c']), [{ agent: 'build', text: 'Another mood.' }])
  expect((await store.load(key)).personas[0].text).toBe('A suspiciously serene foreman.')
}))
it('previous-history context excludes the current root and unrelated characters', () => temp(async root => {
  const store = createSeriesStore(root)
  await store.saveEpisode(ep(['old'], 'old'))
  await store.saveEpisode(ep(['now'], 'root'))
  const context = await store.context(key, 'root', ['build'])
  expect(context.bibles[0].wraps).toEqual({ count: 1, refs: [{ episodeID: 'ep:old', beatID: 'old' }] })
  expect((await store.context(key, 'root', ['explore'])).bibles).toEqual([])
}))

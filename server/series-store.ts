/** Private local archive. No caller-selected paths, truncating saves or corruption repair. */
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { computeBibles } from '../src/narrative/bible'
import { validSeriesKey } from '../src/narrative/scope'
import { isRecord } from '../src/narrative/evidence'
import { parseArchivedEpisode, parseSeriesArchive, mergeEpisode, validPersonaText,
  MAX_ARCHIVE_BYTES, type ArchivedEpisode, type SeriesArchive } from '../src/narrative/series'

export class SeriesStoreError extends Error {
  constructor(public code: 'invalid' | 'corrupt' | 'unsafe' | 'busy' | 'conflict' | 'full' | 'unavailable') {
    super('local history unavailable')
  }
}
const privateNode = (stats: Stats) => !stats.isSymbolicLink() && (stats.mode & 0o077) === 0 &&
  (typeof process.getuid !== 'function' || stats.uid === process.getuid())

async function directory(path: string, create: boolean): Promise<boolean> {
  try {
    let stats: Stats
    try { stats = await lstat(path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (!create) return false
      await mkdir(path, { recursive: true, mode: 0o700 })
      stats = await lstat(path)
    }
    if (!privateNode(stats) || !stats.isDirectory()) throw new SeriesStoreError('unsafe')
    return true
  } catch (error) { if (error instanceof SeriesStoreError) throw error; throw new SeriesStoreError('unavailable') }
}

export function createSeriesStore(root = join(homedir(), '.local/state/floorplan/series')) {
  const paths = (key: string) => {
    if (!validSeriesKey(key)) throw new SeriesStoreError('invalid')
    const dir = join(root, createHash('sha256').update(key).digest('hex'))
    return { dir, file: join(dir, 'series.json'), lock: join(dir, '.lock') }
  }
  const empty = (key: string): SeriesArchive => ({ version: 1, key, episodes: [], personas: [] })
  const load = async (key: string): Promise<SeriesArchive> => {
    const { dir, file } = paths(key)
    if (!await directory(root, false) || !await directory(dir, false)) return empty(key)
    let handle: Awaited<ReturnType<typeof open>>
    try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty(key)
      throw new SeriesStoreError('unsafe')
    }
    try {
      const stats = await handle.stat()
      if (!privateNode(stats) || !stats.isFile()) throw new SeriesStoreError('unsafe')
      if (stats.size > MAX_ARCHIVE_BYTES) throw new SeriesStoreError('full')
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) {
        size += chunk.byteLength
        if (size > MAX_ARCHIVE_BYTES) throw new SeriesStoreError('full')
        chunks.push(chunk)
      }
      const raw = Buffer.concat(chunks).toString('utf8')
      let decoded: unknown
      try { decoded = JSON.parse(raw) } catch { throw new SeriesStoreError('corrupt') }
      const archive = parseSeriesArchive(decoded)
      if (!archive || archive.key !== key) throw new SeriesStoreError('corrupt')
      return archive
    } finally { await handle.close() }
  }
  const merge = (archive: SeriesArchive, episode: ArchivedEpisode) => {
    const index = archive.episodes.findIndex(e => e.id === episode.id)
    if (index === -1) archive.episodes.push(episode)
    else {
      try { archive.episodes[index] = mergeEpisode(archive.episodes[index], episode) }
      catch { throw new SeriesStoreError('conflict') }
    }
  }
  const update = async (key: string, change: (archive: SeriesArchive) => void): Promise<SeriesArchive> => {
    const { dir, file, lock } = paths(key)
    await directory(root, true); await directory(dir, true)
    let held: Awaited<ReturnType<typeof open>>
    try { held = await open(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) }
    catch (error) { throw new SeriesStoreError((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'busy' : 'unavailable') }
    const temp = join(dir, `.series-${randomUUID()}.tmp`)
    try {
      const archive = await load(key)
      try {
        const current = await lstat(file)
        if (!privateNode(current) || !current.isFile() || !(current.mode & 0o200)) throw new SeriesStoreError('unsafe')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      change(archive)
      const validated = parseSeriesArchive(archive)
      if (!validated) throw new SeriesStoreError('full')
      const serialized = JSON.stringify(validated)
      const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { await handle.writeFile(serialized); await handle.sync() }
      finally { await handle.close() }
      // Atomic replacement: failures before rename leave the previous archive untouched.
      await rename(temp, file)
      const folder = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      try { await folder.sync() } finally { await folder.close() }
      return validated
    } catch (error) {
      if (error instanceof SeriesStoreError) throw error
      throw new SeriesStoreError('unavailable')
    } finally {
      await unlink(temp).catch(() => {})
      await held.close()
      await unlink(lock).catch(() => {})
    }
  }
  const saveEpisode = async (value: ArchivedEpisode) => {
    const episode = parseArchivedEpisode(value)
    if (!episode) throw new SeriesStoreError('invalid')
    return update(episode.seriesKey, archive => merge(archive, episode))
  }
  const savePersonas = async (key: string, value: ArchivedEpisode, proposals: unknown) => {
    const episode = parseArchivedEpisode(value)
    if (!episode || episode.seriesKey !== key) throw new SeriesStoreError('invalid')
    return update(key, archive => {
      merge(archive, episode)
      if (!Array.isArray(proposals)) return
      for (const p of proposals.slice(0, 2)) {
        if (!isRecord(p) || Object.keys(p).some(k => !['agent', 'text'].includes(k)) || typeof p.agent !== 'string' ||
            p.agent === 'unidentified' || !validPersonaText(p.text) || archive.personas.some(old => old.agent === p.agent)) continue
        const beat = episode.beats.find(b => episode.sessions.find(s => s.id === b.sessionID)?.agent === p.agent)
        if (!beat) continue
        archive.personas.push({ agent: p.agent, text: p.text, debut: { episodeID: episode.id, beatID: beat.id } })
      }
    })
  }
  const context = async (key: string, currentRoot: string, agents: string[]) => {
    const archive = await load(key)
    return { key, episodeCount: archive.episodes.length,
      bibles: computeBibles(archive.episodes.filter(e => e.rootSessionID !== currentRoot)).filter(b => agents.includes(b.agent)),
      personas: archive.personas.filter(p => agents.includes(p.agent)) }
  }
  return { load, saveEpisode, savePersonas, context }
}

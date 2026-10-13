import type { IncomingMessage, ServerResponse } from 'node:http'
import type { createSeriesStore } from '../../server/series-store'
import { SeriesStoreError } from '../../server/series-store'
import { parseArchivedEpisode, MAX_EPISODE_BYTES } from '../narrative/series'
import { isID } from '../narrative/evidence'
import { validSeriesKey } from '../narrative/scope'
import { buildRecap } from '../narrative/recap'
import { assertLocal, readJSONBody, sendJSON, HTTPError } from './http-guard'

export function createSeriesHandler(store: ReturnType<typeof createSeriesStore>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      assertLocal(req)
      const url = new URL(req.url ?? '', 'http://127.0.0.1')
      if (!['/context', '/episode', '/recap'].includes(url.pathname)) throw new HTTPError(404, 'not found')
      if (url.pathname === '/recap') {
        if (req.method !== 'GET') throw new HTTPError(405, 'method not allowed')
        const key = url.searchParams.get('key')
        const root = url.searchParams.get('root')
        const raw = url.searchParams.get('before')
        const before = Number(raw)
        if (!validSeriesKey(key) || !isID(root) || !raw || !Number.isFinite(before) || before <= 0 || before > Number.MAX_SAFE_INTEGER) {
          throw new HTTPError(400, 'invalid request')
        }
        return sendJSON(res, 200, buildRecap(await store.load(key), root, before))
      }
      if (url.pathname === '/context') {
        if (req.method !== 'GET') throw new HTTPError(405, 'method not allowed')
        const key = url.searchParams.get('key')
        const root = url.searchParams.get('root')
        const agents = url.searchParams.getAll('agent')
        if (!validSeriesKey(key) || !isID(root) || agents.length > 8 || agents.some(a => !isID(a))) {
          throw new HTTPError(400, 'invalid request')
        }
        const context = await store.context(key, root, agents)
        if (new TextEncoder().encode(JSON.stringify(context)).length > MAX_EPISODE_BYTES) throw new HTTPError(413, 'history context too large')
        return sendJSON(res, 200, context)
      }
      if (req.method !== 'POST') throw new HTTPError(405, 'method not allowed')
      assertLocal(req, true)
      const episode = parseArchivedEpisode(await readJSONBody(req, MAX_EPISODE_BYTES))
      if (!episode) throw new HTTPError(400, 'invalid request')
      const archive = await store.saveEpisode(episode)
      sendJSON(res, 200, { saved: true, episodeCount: archive.episodes.length })
    } catch (error) {
      if (error instanceof HTTPError) sendJSON(res, error.status, { error: error.message })
      else sendJSON(res, error instanceof SeriesStoreError && error.code === 'busy' ? 423 : 409,
        { error: 'local history unavailable', code: error instanceof SeriesStoreError ? error.code : 'unavailable' })
    }
  }
}

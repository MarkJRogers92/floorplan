import { it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { createSeriesStore, createContinuityHooks } from '../../server/series-store'
import { createDirectorService } from '../../src/dev/director-service'
import { createDirectorProvider } from '../../src/dev/director-provider'
import { parseDirectorRequest } from '../../src/dev/director-input'
import type { DirectorRequest, DirectorContinuity } from '../../src/narrative/director'

const key = 'directory:/fake/project'
const config = { key: 'synthetic-only', enabled: true, episodeCapCents: 30, runCapCents: 100 }
const request = (id = 'a'): DirectorRequest => ({ sceneID: `scene:${id}`, seriesKey: key,
  sessions: [{ id: 'root', agent: 'build' }], beats: [{ id, at: 0, endAt: 0, eventIDs: [id], sessionID: 'root', kind: 'wrap', detail: { kind: 'wrap' } }] })
const output = (id = 'a', text = 'A weary foreman with a desperate need for order.') => ({
  lines: [{ speaker: 'narrator', template: 'A monument to office morale.', cites: [id], flashback: false }], personas: [{ agent: 'build', text }],
})
async function temp(run: (store: ReturnType<typeof createSeriesStore>) => Promise<void>) {
  const root = await mkdtemp('/private/var/folders/q6/wd0w60596vg_rnm736shphw00000gn/T/opencode/floorplan-continuity-')
  try { await run(createSeriesStore(root)) } finally { await rm(root, { recursive: true, force: true }) }
}
it('accepts only a real optional series key in Director request', () => {
  expect(parseDirectorRequest(request())?.seriesKey).toBe(key)
  expect(parseDirectorRequest({ ...request(), seriesKey: '../escape' })).toBeUndefined()
})
it('one existing completion saves a persona once and reuses it with previous-root-only facts', () => temp(async store => {
  await store.saveEpisode({ id: 'ep:old', rootSessionID: 'old', seriesKey: key, sessions: [{ id: 'old', agent: 'build' }],
    beats: [{ ...request().beats[0], id: 'old', sessionID: 'old', eventIDs: ['old'] }] })
  const contexts: DirectorContinuity[] = []
  let calls = 0
  const service = createDirectorService(config, async (req, _, context) => {
    calls++; contexts.push(context)
    return output(req.beats[0].id, calls === 1 ? 'A weary foreman with a desperate need for order.' : 'A confident newcomer.')
  }, createContinuityHooks(store))
  service.control(true)
  expect((await service.direct(request())).mode).toBe('director')
  expect(contexts[0].bibles[0].wraps.count).toBe(1)
  expect((await store.load(key)).personas[0].debut).toEqual({ episodeID: 'ep:root', beatID: 'a' })
  await service.direct(request('b'))
  expect(contexts[1].bibles[0].episodes).toEqual(['ep:old'])
  expect(contexts[1].personas[0].text).toBe('A weary foreman with a desperate need for order.')
  expect((await store.load(key)).personas[0].text).toBe(contexts[1].personas[0].text)
  expect(calls).toBe(2)
  expect(service.state().reservedCents).toBe(6)
}))
it('no key/page opt-in never reads history or creates a profile', async () => {
  let history = 0
  const service = createDirectorService({ ...config, key: '' }, async () => { throw new Error('must not call') }, {
    loadContext: async () => { history++; return { bibles: [], personas: [] } }, savePersonas: async () => { history++ },
  })
  service.control(true)
  expect((await service.direct(request())).mode).toBe('templates')
  expect(history).toBe(0)
  expect(service.state().reservedCents).toBe(0)
})
it('invalid persona or missing/corrupt storage does not destroy checked narration', () => temp(async store => {
  const service = createDirectorService(config, async () => output('a', 'It failed twice.'), createContinuityHooks(store))
  service.control(true)
  expect((await service.direct(request())).mode).toBe('director')
  expect((await store.load(key)).personas).toEqual([])
  const broken = createDirectorService(config, async () => output(), {
    loadContext: async () => { throw new Error('storage private failure') }, savePersonas: async () => { throw new Error('private failure') },
  })
  broken.control(true)
  expect((await broken.direct(request())).mode).toBe('director')
  expect(broken.state().reservedCents).toBe(3)
}))
it('a disable during context loading never starts a provider request', async () => {
  let release!: (v: DirectorContinuity) => void
  let calls = 0
  const wait = new Promise<DirectorContinuity>(resolve => { release = resolve })
  const service = createDirectorService(config, async () => { calls++; return output() }, { loadContext: () => wait })
  service.control(true)
  const pending = service.direct(request())
  service.control(false)
  release({ bibles: [], personas: [] })
  expect((await pending).mode).toBe('templates')
  expect(calls).toBe(0)
})
it('a scoped-out replay can narrate but cannot create archived episodes or personas', async () => {
  let storage = 0
  const service = createDirectorService(config, async () => output(), {
    loadContext: async () => { storage++; return { bibles: [], personas: [] } },
    savePersonas: async () => { storage++ },
  })
  service.control(true)
  const replay = request(); delete replay.seriesKey
  expect((await service.direct(replay)).mode).toBe('director')
  expect(storage).toBe(0)
  expect(service.state().reservedCents).toBe(3)
})
it('provider receives bounded advisory continuity, no old quotes/event IDs and unchanged output cap', async () => {
  let body!: Record<string, any>
  const provider = createDirectorProvider('synthetic-only', async (_, options) => {
    body = JSON.parse(String(options!.body))
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output()) } }] }))
  })
  const refs = Array.from({ length: 1000 }, (_, i) => ({ episodeID: 'ep:old', beatID: `past${i}` }))
  const context: DirectorContinuity = { personas: [], bibles: [{ agent: 'build', episodes: ['ep:old'], tools: {},
    thinks: { runs: 1000, deltas: 1000, refs }, wraps: { count: 0, refs: [] }, cuts: { count: 0, refs: [] }, knocks: { count: 0, refs: [] } }] }
  await provider(request(), new AbortController().signal, context)
  const input = JSON.parse(body.messages[1].content)
  expect(input.continuity.bibles[0].agent).toBe('build')
  expect(new TextEncoder().encode(JSON.stringify(input.continuity)).length).toBeLessThanOrEqual(8192)
  expect(String(body.messages[1].content)).not.toContain('eventIDs')
  expect(body.max_completion_tokens).toBe(1024)
  expect(body.response_format.json_schema.schema.properties.personas).toBeDefined()
})

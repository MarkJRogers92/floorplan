import { it, expect } from 'vitest'
import { createSeriesClient } from '../../src/app/series-client'
import type { Beat } from '../../src/narrative/types'

const beat = (id: string, kind: 'wrap' | 'human-asks' | 'uses-tool' = 'human-asks'): Beat => ({ id, at: 0, endAt: 0, eventIDs: [id],
  sessionID: 'root', kind, detail: kind === 'uses-tool' ? { kind, tool: 'read' } : { kind } })
const sessions = [{ id: 'root', agent: 'build', seriesKey: 'directory:/fake/project' }]
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const context = { key: sessions[0].seriesKey, episodeCount: 1, bibles: [], personas: [] }

it('saves only live scene milestones, then caches local context without re-saving identical input', async () => {
  const posts: any[] = []
  const fetcher: typeof fetch = async (url, options) => {
    if (options?.method === 'POST') { posts.push(JSON.parse(String(options.body))); return Response.json({ saved: true, episodeCount: 1 }) }
    expect(String(url)).toContain('/__series/context?')
    return Response.json(context)
  }
  const client = createSeriesClient(fetcher)
  client.update([beat('a')], sessions)
  await tick(); expect(posts).toHaveLength(0)
  client.update([beat('a'), beat('b', 'wrap')], sessions)
  await tick()
  expect(posts[0].beats.map((b: Beat) => b.id)).toEqual(['a', 'b'])
  expect(client.status()).toContain('saved')
  expect(client.contexts().get(sessions[0].seriesKey)?.episodeCount).toBe(1)
  client.update([beat('a'), beat('b', 'wrap')], sessions)
  await tick(); expect(posts).toHaveLength(1)
})
it('replay and unknown project identity never write to disk routes', async () => {
  let requests = 0
  const client = createSeriesClient(async () => { requests++; return Response.json({}) })
  client.update([beat('a', 'wrap')], sessions, true)
  await tick(); expect(client.status()).toContain('replay')
  client.reset()
  client.update([beat('a', 'wrap')], [{ id: 'root', agent: 'build' }])
  await tick(); expect(requests).toBe(0)
  expect(client.status()).toContain('project')
})
it('queues only the latest cumulative snapshot per chat while storage is busy', async () => {
  let release!: (v: Response) => void
  const wait = new Promise<Response>(r => { release = r })
  const posts: any[] = []
  const client = createSeriesClient(async (_, options) => {
    if (options?.method === 'POST') {
      posts.push(JSON.parse(String(options.body)))
      return posts.length === 1 ? wait : Response.json({ saved: true, episodeCount: 1 })
    }
    return Response.json(context)
  })
  client.update([beat('a', 'wrap')], sessions)
  client.update([beat('a', 'wrap'), beat('b', 'wrap')], sessions)
  client.update([beat('a', 'wrap'), beat('b', 'wrap'), beat('c', 'wrap')], sessions)
  expect(posts).toHaveLength(1)
  release(Response.json({ saved: true, episodeCount: 1 }))
  await tick()
  expect(posts).toHaveLength(2)
  expect(posts[1].beats.map((b: Beat) => b.id)).toEqual(['a', 'b', 'c'])
})
it('storage failure is visible, not thrown into the floor consumer', async () => {
  const client = createSeriesClient(async () => { throw new Error('private upstream failure') })
  expect(() => client.update([beat('a', 'wrap')], sessions)).not.toThrow()
  await tick()
  expect(client.status()).toContain('unavailable')
  expect(client.status()).not.toContain('private')
})
it('reset/replay rejects late storage acknowledgements and aborts the request', async () => {
  let release!: (v: Response) => void
  let signal!: AbortSignal
  const wait = new Promise<Response>(r => { release = r })
  const client = createSeriesClient(async (_, options) => { signal = options!.signal as AbortSignal; return wait })
  client.update([beat('a', 'wrap')], sessions)
  client.reset()
  client.update([beat('a', 'wrap')], sessions, true)
  expect(signal.aborted).toBe(true)
  release(Response.json({ saved: true, episodeCount: 1 }))
  await tick()
  expect(client.status()).toContain('replay')
  expect(client.contexts().size).toBe(0)
})
it('a capped ninety-second scene is a save milestone without a later frame', async () => {
  let posts = 0
  const client = createSeriesClient(async (_, options) => {
    if (options?.method === 'POST') { posts++; return Response.json({ saved: true, episodeCount: 1 }) }
    return Response.json(context)
  })
  client.update([{ ...beat('long', 'uses-tool'), endAt: 90_000 }], sessions)
  await tick()
  expect(posts).toBe(1)
})
it('switching directly to replay also invalidates a pending live acknowledgement', async () => {
  let release!: (v: Response) => void
  const wait = new Promise<Response>(r => { release = r })
  const client = createSeriesClient(async () => wait)
  client.update([beat('a', 'wrap')], sessions)
  client.update([beat('a', 'wrap')], sessions, true)
  release(Response.json({ saved: true, episodeCount: 1 }))
  await tick()
  expect(client.status()).toContain('replay')
  expect(client.contexts().size).toBe(0)
})

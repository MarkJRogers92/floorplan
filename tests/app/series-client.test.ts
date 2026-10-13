import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSeriesClient } from '../../src/app/series-client'
import type { Beat } from '../../src/narrative/types'

const beat = (id: string, kind: 'wrap' | 'human-asks' | 'uses-tool' = 'human-asks'): Beat => ({ id, at: 0, endAt: 0, eventIDs: [id],
  sessionID: 'root', kind, detail: kind === 'uses-tool' ? { kind, tool: 'read' } : { kind } })
const sessions = [{ id: 'root', agent: 'build', seriesKey: 'directory:/fake/project' }]
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const context = { key: sessions[0].seriesKey, episodeCount: 1, bibles: [], personas: [] }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

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
it('retries a failed terminal save without another frame, preserving all tail evidence', async () => {
  const posts: any[] = []
  const client = createSeriesClient(async (_, options) => {
    if (options?.method !== 'POST') return Response.json(context)
    posts.push(JSON.parse(String(options.body)))
    return posts.length === 1 ? new Response('', { status: 423 }) : Response.json({ saved: true, episodeCount: 1 })
  })
  client.update([beat('tail'), beat('end', 'wrap')], sessions)
  await tick()
  expect(client.status()).toContain('unavailable')
  await vi.advanceTimersByTimeAsync(30_000)
  await tick()
  expect(posts).toHaveLength(2)
  expect(posts[1].beats.map((b: Beat) => b.id)).toEqual(['tail', 'end'])
  expect(client.status()).toContain('saved')
  expect(client.status()).not.toContain('unavailable')
})
it('a retry coalesces to newer cumulative evidence instead of restoring the failed snapshot', async () => {
  const posts: any[] = []
  const client = createSeriesClient(async (_, options) => {
    if (options?.method !== 'POST') return Response.json(context)
    posts.push(JSON.parse(String(options.body)))
    if (posts.length === 1) throw new Error('offline')
    return Response.json({ saved: true, episodeCount: 1 })
  })
  client.update([beat('a', 'wrap')], sessions)
  await tick()
  client.update([beat('a', 'wrap'), beat('b', 'wrap')], sessions)
  await tick()
  expect(posts).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(posts[1].beats.map((b: Beat) => b.id)).toEqual(['a', 'b'])
})
it('switching to replay cancels a failed live save retry', async () => {
  let posts = 0
  const client = createSeriesClient(async () => { posts++; throw new Error('offline') })
  client.update([beat('a', 'wrap')], sessions)
  await tick()
  client.update([beat('a', 'wrap')], sessions, true)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(posts).toBe(1)
  expect(client.status()).toContain('replay')
})
it('a permanently unavailable static-build route is not retried automatically', async () => {
  let posts = 0
  const client = createSeriesClient(async () => { posts++; return new Response('', { status: 404 }) })
  client.update([beat('a', 'wrap')], sessions)
  await tick()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(posts).toBe(1)
  expect(client.status()).toContain('unavailable')
})
it('retries the mounted route unavailable error but leaves an immutable conflict for inspection', async () => {
  for (const [code, expectedPosts] of [['unavailable', 2], ['conflict', 1]] as const) {
    let posts = 0
    const client = createSeriesClient(async (_, options) => {
      if (options?.method !== 'POST') return Response.json(context)
      posts++
      return posts === 1 ? Response.json({ error: 'local history unavailable', code }, { status: 409 }) :
        Response.json({ saved: true, episodeCount: 1 })
    })
    client.update([beat('end', 'wrap')], sessions)
    await tick()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(posts, code).toBe(expectedPosts)
    client.reset()
  }
})

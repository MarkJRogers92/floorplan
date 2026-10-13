import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRecapClient } from '../../src/app/recap-client'
import type { Beat } from '../../src/narrative/types'

const key = 'directory:/synthetic/recap'
const sessions = [{ id: 'root', agent: 'build', seriesKey: key }]
const beat = (id = 'now', at = 1000): Beat => ({ id, sessionID: 'root', at, endAt: at, eventIDs: [id],
  kind: 'human-asks', detail: { kind: 'human-asks' } })
const response = (before = 1000, responseKey = key) => ({ key: responseKey, rootSessionID: 'root', before, coverage: 'partial',
  moments: [{ episodeID: 'ep:old', session: { id: 'old', agent: 'review' },
    beat: { id: 'past', sessionID: 'old', at: 100, endAt: 100, eventIDs: ['past'], kind: 'wrap', detail: { kind: 'wrap' } } }] })
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('reads once for observed known scope/cutoff and never posts or reads metadata-only roots', async () => {
  const gets: string[] = []
  const client = createRecapClient(async (url, options) => {
    expect(options?.method).not.toBe('POST')
    gets.push(String(url)); return Response.json(response())
  })
  client.update([], sessions); await tick(); expect(gets).toHaveLength(0)
  client.update([beat()], sessions); await tick()
  expect(gets).toHaveLength(1)
  const params = new URL(gets[0], 'http://local').searchParams
  expect([params.get('key'), params.get('root'), params.get('before')]).toEqual([key, 'root', '1000'])
  expect(client.recapFor(key, 'root')?.moments[0].episodeID).toBe('ep:old')
  client.update([beat(), beat('later', 1200)], sessions); await tick(); expect(gets).toHaveLength(1)
})
it('unknown scope, unknown clock and replay never read archives', async () => {
  let calls = 0
  const client = createRecapClient(async () => { calls++; throw new Error('should not call') })
  client.update([beat()], [{ id: 'root', agent: 'build' }])
  client.update([beat('no-time', 0)], sessions)
  client.update([beat()], sessions, true)
  await tick(); expect(calls).toBe(0)
})
it('backdated cutoff supersedes the old read and refuses its late reply', async () => {
  let release!: (v: Response) => void
  let signal!: AbortSignal
  const wait = new Promise<Response>(r => { release = r })
  let calls = 0
  const client = createRecapClient(async (_, options) => {
    calls++
    if (calls === 1) { signal = options!.signal as AbortSignal; return wait }
    return Response.json(response(900))
  })
  client.update([beat()], sessions)
  client.update([beat(), beat('backdated', 900)], sessions)
  await tick(); expect(signal.aborted).toBe(true)
  release(Response.json(response())); await tick()
  expect(client.recapFor(key, 'root')?.before).toBe(900)
})
it('scope changes never show a previous project reply under the new key', async () => {
  const otherKey = 'directory:/synthetic/other'
  let release!: (v: Response) => void
  const wait = new Promise<Response>(r => { release = r })
  let calls = 0
  const client = createRecapClient(async () => ++calls === 1 ? wait : Response.json(response(1000, otherKey)))
  client.update([beat()], sessions)
  client.update([beat()], [{ ...sessions[0], seriesKey: otherKey }]); await tick()
  release(Response.json(response())); await tick()
  expect(client.recapFor(key, 'root')).toBeUndefined()
  expect(client.recapFor(otherKey, 'root')?.key).toBe(otherKey)
})
it('replay/reset aborts and rejects late recap without new calls', async () => {
  let release!: (v: Response) => void
  let signal!: AbortSignal
  const wait = new Promise<Response>(r => { release = r })
  const client = createRecapClient(async (_, options) => { signal = options!.signal as AbortSignal; return wait })
  client.update([beat()], sessions)
  client.update([beat()], sessions, true)
  expect(signal.aborted).toBe(true)
  release(Response.json(response())); await tick()
  expect(client.recapFor(key, 'root')).toBeUndefined()
})
it('failure and malformed proof stay isolated from the floor and expose no private error', async () => {
  const client = createRecapClient(async () => { throw new Error('private archive path detail') })
  expect(() => client.update([beat()], sessions)).not.toThrow()
  await tick(); expect(client.errorFor(key, 'root')).toBe(true)
  expect(client.recapFor(key, 'root')).toBeUndefined()
  const bad = createRecapClient(async () => Response.json({ ...response(), text: 'made-up history' }))
  bad.update([beat()], sessions); await tick(); expect(bad.errorFor(key, 'root')).toBe(true)
})

it('a transient failure recovers after 30s without new footage or a reload', async () => {
  let calls = 0
  const client = createRecapClient(async () => {
    if (++calls === 1) throw new Error('synthetic network failure')
    return Response.json(response())
  })
  client.update([beat()], sessions); await tick()
  for (let i = 0; i < 50; i++) client.update([beat()], sessions)
  await vi.advanceTimersByTimeAsync(29_999)
  expect(calls).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(calls).toBe(2)
  expect(client.recapFor(key, 'root')?.moments[0].beat.id).toBe('past')
  expect(client.errorFor(key, 'root')).toBe(false)
  await vi.advanceTimersByTimeAsync(90_000)
  expect(calls).toBe(2)
})
it('transient retries stop after three additional attempts, never an unbounded read loop', async () => {
  let calls = 0
  const client = createRecapClient(async () => { calls++; return Response.json({}, { status: 503 }) })
  client.update([beat()], sessions); await tick()
  await vi.advanceTimersByTimeAsync(90_000)
  expect(calls).toBe(4)
  client.update([beat(), beat('later', 1100)], sessions)
  await vi.advanceTimersByTimeAsync(300_000)
  expect(calls).toBe(4)
  expect(client.errorFor(key, 'root')).toBe(true)
})
it.each([423, 429, 500, 503])('retries transient HTTP %i, but only with bounded spacing', async status => {
  let calls = 0
  const client = createRecapClient(async () => ++calls === 1 ? Response.json({}, { status }) : Response.json(response()))
  client.update([beat()], sessions); await tick()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(client.recapFor(key, 'root')?.before).toBe(1000)
  expect(calls).toBe(2)
})
it('distinguishes temporarily unavailable storage from a corrupt archive', async () => {
  let calls = 0
  const client = createRecapClient(async () => ++calls === 1 ?
    Response.json({ code: 'unavailable' }, { status: 409 }) : Response.json(response()))
  client.update([beat()], sessions); await tick()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(client.recapFor(key, 'root')?.moments[0].beat.id).toBe('past')
  expect(calls).toBe(2)
})
it('unsafe/corrupt archives, absent routes and malformed proof are not retried', async () => {
  for (const result of [Response.json({ code: 'corrupt' }, { status: 409 }), new Response('', { status: 404 }),
    Response.json({ ...response(), text: 'unproved' })]) {
    let calls = 0
    const client = createRecapClient(async () => { calls++; return result })
    client.update([beat()], sessions); await tick()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(calls).toBe(1)
    expect(client.errorFor(key, 'root')).toBe(true)
  }
})
it.each(['reset', 'replay', 'removed-root', 'new-cutoff', 'new-scope'] as const)('cancels scheduled retries on %s', async action => {
  let calls = 0
  const client = createRecapClient(async () => {
    if (++calls === 1) throw new Error('synthetic network failure')
    return Response.json(action === 'new-scope' ? response(1000, 'directory:/synthetic/other') : response(900))
  })
  client.update([beat()], sessions); await tick()
  if (action === 'reset') client.reset()
  if (action === 'replay') client.update([beat()], sessions, true)
  if (action === 'removed-root') client.update([], sessions)
  if (action === 'new-cutoff') client.update([beat('earlier', 900)], sessions)
  if (action === 'new-scope') client.update([beat()], [{ ...sessions[0], seriesKey: 'directory:/synthetic/other' }])
  await vi.advanceTimersByTimeAsync(120_000)
  expect(calls).toBe(action === 'new-cutoff' || action === 'new-scope' ? 2 : 1)
})
it('an in-flight retry cannot install a late recap after reset, even if fetch ignores abort', async () => {
  let calls = 0
  let release!: (value: Response) => void
  let signal!: AbortSignal
  const pending = new Promise<Response>(resolve => { release = resolve })
  const client = createRecapClient(async (_, options) => {
    if (++calls === 1) throw new Error('synthetic transient failure')
    signal = options!.signal as AbortSignal
    return pending
  })
  client.update([beat()], sessions); await tick()
  await vi.advanceTimersByTimeAsync(30_000)
  client.reset()
  expect(signal.aborted).toBe(true)
  release(Response.json(response())); await tick()
  expect(client.recapFor(key, 'root')).toBeUndefined()
  await vi.advanceTimersByTimeAsync(120_000)
  expect(calls).toBe(2)
})

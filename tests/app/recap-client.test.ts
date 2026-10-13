import { it, expect } from 'vitest'
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

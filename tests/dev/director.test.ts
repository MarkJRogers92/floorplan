import { describe, it, expect } from 'vitest'
import { createDirectorService, directorConfig } from '../../src/dev/director-service'
import { parseDirectorRequest } from '../../src/dev/director-input'
import { createDirectorProvider } from '../../src/dev/director-provider'
import type { DirectorRequest } from '../../src/narrative/director'

const request = (id = 'a', root = 'root'): DirectorRequest => ({ sceneID: `scene:${id}`, sessions: [{ id: root, agent: 'build' }], beats: [{
  id, at: 0, endAt: 0, eventIDs: ['e'], sessionID: root, kind: 'wrap', detail: { kind: 'wrap' },
}] })
const output = { lines: [{ speaker: 'narrator', template: 'An administrative victory.', cites: ['a'], flashback: false }] }
const config = { key: 'synthetic-test-key', enabled: true, episodeCapCents: 6, runCapCents: 9 }
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

describe('scene input trust boundary', () => {
  it('accepts a real shaped scene and rejects invalid timestamps/details/caps/duplicates', () => {
    expect(parseDirectorRequest(request())).toEqual(request())
    expect(parseDirectorRequest({ ...request(), beats: [{ ...request().beats[0], at: Infinity }] })).toBeUndefined()
    expect(parseDirectorRequest({ ...request(), beats: [{ ...request().beats[0], detail: { kind: 'wrap', secret: 'not footage' } }] })).toBeUndefined()
    expect(parseDirectorRequest({ ...request(), beats: Array(13).fill(request().beats[0]) })).toBeUndefined()
    expect(parseDirectorRequest({ ...request(), beats: [request().beats[0], request().beats[0]] })).toBeUndefined()
    expect(parseDirectorRequest({ ...request(), sceneID: 'wrong' })).toBeUndefined()
  })
  it('rejects mixed roots/desks, unknown kinds, parent cycles and oversized UTF-8 input', () => {
    expect(parseDirectorRequest({ ...request(), beats: [request().beats[0], request('b', 'other').beats[0]] })).toBeUndefined()
    expect(parseDirectorRequest({ ...request(), beats: [{ ...request().beats[0], kind: 'made-up' }] })).toBeUndefined()
    expect(parseDirectorRequest({ ...request(), sessions: [{ id: 'root', parentID: 'root' }] })).toBeUndefined()
    expect(parseDirectorRequest({ ...request(), sessions: [{ id: 'root', agent: '💀'.repeat(9000) }] })).toBeUndefined()
  })
})

describe('reservation and controls', () => {
  it('requires both key/config and explicit control opt-in, never echoes a key', async () => {
    let calls = 0
    const complete = async () => { calls++; return output }
    for (const cfg of [{ ...config, key: '' }, { ...config, enabled: false }, config]) {
      const service = createDirectorService(cfg, complete)
      expect((await service.direct(request())).mode).toBe('templates')
      if (!cfg.key || !cfg.enabled) {
        service.control(true)
        expect((await service.direct(request())).mode).toBe('templates')
      }
      expect(JSON.stringify(service.state())).not.toContain(config.key)
    }
    expect(calls).toBe(0)
  })
  it('charges exactly three integer cents once per scene, including concurrent duplicates', async () => {
    const wait = deferred<unknown>()
    const service = createDirectorService(config, () => wait.promise)
    service.control(true)
    const first = service.direct(request())
    const duplicate = service.direct(request())
    expect(service.state().reservedCents).toBe(3)
    wait.resolve(output)
    expect((await first).mode).toBe('director')
    expect((await duplicate).mode).toBe('director')
    expect((await service.direct(request())).mode).toBe('director')
    expect(service.state().reservedCents).toBe(3)
  })
  it('caps each chat and the server run, including failed or refused attempts', async () => {
    const service = createDirectorService(config, async () => { throw new Error('secret provider failure') })
    service.control(true)
    expect((await service.direct(request('a'))).reason).toBe('failed')
    expect((await service.direct(request('b'))).reason).toBe('failed')
    expect((await service.direct(request('c'))).reason).toBe('budget')
    expect((await service.direct(request('d', 'other'))).reason).toBe('failed')
    expect((await service.direct(request('e', 'third'))).reason).toBe('budget')
    expect(service.state().reservedCents).toBe(9)
    expect(JSON.stringify(await service.direct(request('f')))).not.toContain('secret')
  })
  it('rejects a changed scene under a spent identity without spending again', async () => {
    const service = createDirectorService(config, async () => output)
    service.control(true)
    await service.direct(request())
    const changed = request()
    changed.beats[0].at = 10
    changed.beats[0].endAt = 10
    expect((await service.direct(changed)).reason).toBe('changed-evidence')
    expect(service.state().reservedCents).toBe(3)
  })
  it.each(['disable', 'opt-out'])('aborts %s and discards a provider reply that ignores the abort', async action => {
    const wait = deferred<unknown>()
    let signal!: AbortSignal
    const service = createDirectorService(config, (_, s) => { signal = s; return wait.promise })
    service.control(true)
    const pending = service.direct(request())
    if (action === 'disable') service.control(false)
    else service.optOut('root', true)
    expect(signal.aborted).toBe(true)
    wait.resolve(output)
    expect((await pending).mode).toBe('templates')
    expect(service.state().reservedCents).toBe(3)
  })
  it('rejects overlapping distinct calls instead of increasing concurrency', async () => {
    const wait = deferred<unknown>()
    const service = createDirectorService(config, () => wait.promise)
    service.control(true)
    const first = service.direct(request())
    expect((await service.direct(request('b'))).reason).toBe('busy')
    expect(service.state().reservedCents).toBe(3)
    wait.resolve(output)
    await first
  })
  it('parses integer caps and fails closed for invalid configuration', () => {
    expect(directorConfig({})).toMatchObject({ key: '', enabled: false, episodeCapCents: 30, runCapCents: 100 })
    expect(directorConfig({ FLOORPLAN_DIRECTOR_KEY: 'test', FLOORPLAN_DIRECTOR_ENABLED: 'true', FLOORPLAN_DIRECTOR_EPISODE_CAP_CENTS: '6' })).toMatchObject({ enabled: true, episodeCapCents: 6 })
    expect(directorConfig({ FLOORPLAN_DIRECTOR_KEY: 'test', FLOORPLAN_DIRECTOR_ENABLED: 'true', FLOORPLAN_DIRECTOR_RUN_CAP_CENTS: 'NaN' }).enabled).toBe(false)
  })
})

describe('fixed provider wire contract', () => {
  it('sends only bounded scene evidence and a schema, not raw event IDs or client secrets', async () => {
    let sent!: RequestInit
    let url = ''
    const provider = createDirectorProvider(config.key, async (input, init) => {
      url = String(input); sent = init!
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }))
    })
    expect(await provider(request(), new AbortController().signal)).toEqual(output)
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    const body = JSON.parse(String(sent.body))
    expect(body.model).toBe('gpt-4.1-mini-2025-04-14')
    expect(body.max_completion_tokens).toBe(1024)
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(String(sent.body)).not.toContain(config.key)
    expect(String(sent.body)).not.toContain('eventIDs')
  })
  it.each([
    { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { refusal: 'No', content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] },
  ])('rejects truncation, refusal and malformed responses: %j', body => {
    const provider = createDirectorProvider('test', async () => new Response(JSON.stringify(body)))
    return expect(provider(request(), new AbortController().signal)).rejects.toThrow()
  })
  it('bounds provider error and response bodies without exposing upstream errors', async () => {
    const provider = createDirectorProvider('test', async () => new Response('x'.repeat(70_000)))
    await expect(provider(request(), new AbortController().signal)).rejects.toThrow()
    const bad = createDirectorProvider('test', async () => new Response('secret', { status: 401 }))
    await expect(bad(request(), new AbortController().signal)).rejects.not.toThrow('secret')
  })
})

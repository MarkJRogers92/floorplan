import { it, expect } from 'vitest'
import { directorCall, parseDirectorState } from '../../src/app/director-client'

const state = { available: false, enabled: false, model: 'gpt-4.1-mini-2025-04-14', episodeCapCents: 30, runCapCents: 100, reservedCents: 0, excluded: [] }
it('accepts public state without retaining unexpected secret fields, rejects broken shape', () => {
  expect(parseDirectorState({ ...state, key: 'not-public' })).toEqual(state)
  expect(parseDirectorState({ ...state, available: 'yes' })).toBeNull()
  expect(parseDirectorState({ ...state, reservedCents: NaN })).toBeNull()
})
it('uses only a same-origin dev route and sends explicit control as JSON', async () => {
  let endpoint = ''
  let options!: RequestInit
  const fetcher: typeof fetch = async (url, init) => { endpoint = String(url); options = init!; return new Response(JSON.stringify(state)) }
  expect(await directorCall('control', { enabled: true }, undefined, fetcher)).toEqual(state)
  expect(endpoint).toBe('/__director/control')
  expect(options.method).toBe('POST')
  expect(options.body).toBe('{"enabled":true}')
})
it('an absent dev route is a generic unavailable error, never an upstream body', async () => {
  const fetcher: typeof fetch = async () => new Response('private upstream error', { status: 404 })
  await expect(directorCall('state', undefined, undefined, fetcher)).rejects.toThrow('Director unavailable')
})

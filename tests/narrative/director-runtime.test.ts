import { it, expect } from 'vitest'
import { createDirectorRuntime } from '../../src/narrative/director-runtime'
import type { Beat } from '../../src/narrative/types'
import type { DirectorRequest } from '../../src/narrative/director'

const b = (id: string, at = 0): Beat => ({ id, at, endAt: at, eventIDs: [id], sessionID: 'root', kind: 'human-asks', detail: { kind: 'human-asks' } })
const sessions = [{ id: 'root', agent: 'build' }]
const output = (id: string) => ({ lines: [{ speaker: 'narrator', template: 'Existence is paperwork.', cites: [id], flashback: false }] })
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(r => { resolve = r }); return { promise, resolve } }

it('is disabled by default and requests only closed scenes, once', async () => {
  const sent: DirectorRequest[] = []
  const runtime = createDirectorRuntime(async request => { sent.push(request); return output(request.beats[0].id) }, () => {})
  runtime.update([b('a')], sessions)
  runtime.setEnabled(true)
  await tick()
  expect(sent).toHaveLength(0)
  runtime.update([b('a'), b('b')], sessions)
  await tick()
  expect(runtime.results().get('scene:a')?.[0].cites).toEqual(['a'])
  runtime.update([b('a'), b('b')], sessions)
  await tick()
  expect(sent).toHaveLength(1)
  runtime.update([b('a'), b('b')], sessions, true)
  await tick()
  expect(runtime.results().get('scene:b')?.[0].cites).toEqual(['b'])
})
it('keeps only the latest queued scene and never backfills skipped scenes', async () => {
  const wait = deferred()
  const ids: string[] = []
  const runtime = createDirectorRuntime(async request => {
    ids.push(request.sceneID)
    return ids.length === 1 ? wait.promise : output(request.beats[0].id)
  }, () => {})
  runtime.setEnabled(true)
  runtime.update([b('a'), b('b')], sessions)
  runtime.update([b('a'), b('b'), b('c'), b('d')], sessions)
  wait.resolve(output('a'))
  await tick()
  expect(ids).toEqual(['scene:a', 'scene:c'])
  runtime.update([b('a'), b('b'), b('c'), b('d')], sessions)
  await tick()
  expect(runtime.results().has('scene:b')).toBe(false)
  expect(ids).toHaveLength(2)
})
it.each(['disable', 'opt-out', 'reset', 'cast-change'])('discards a late reply after %s', async action => {
  const wait = deferred()
  let signal!: AbortSignal
  const runtime = createDirectorRuntime((_, s) => { signal = s; return wait.promise }, () => {})
  runtime.setEnabled(true)
  runtime.update([b('a'), b('b')], sessions)
  if (action === 'disable') runtime.setEnabled(false)
  if (action === 'opt-out') runtime.setExcluded('root', true)
  if (action === 'reset') runtime.reset()
  if (action === 'cast-change') runtime.update([b('a'), b('b')], [{ id: 'root', agent: 'explore' }])
  if (action !== 'cast-change') expect(signal.aborted).toBe(true)
  wait.resolve(output('a'))
  await tick()
  expect(runtime.results().size).toBe(0)
})
it('invalidates already completed narration when evidence/cast changes', async () => {
  const runtime = createDirectorRuntime(async () => output('a'), () => {})
  runtime.setEnabled(true)
  runtime.update([b('a'), b('b')], sessions)
  await tick()
  expect(runtime.results().size).toBe(1)
  runtime.update([b('a'), b('b')], [{ id: 'root', agent: 'explore' }])
  expect(runtime.results().size).toBe(0)
})
it('request rejection or malformed output stays template-only without retry', async () => {
  let attempts = 0
  const runtime = createDirectorRuntime(async () => { attempts++; throw new Error('unavailable') }, () => {})
  runtime.setEnabled(true)
  runtime.update([b('a'), b('b')], sessions)
  await tick()
  runtime.update([b('a'), b('b')], sessions)
  await tick()
  expect(runtime.results().size).toBe(0)
  expect(attempts).toBe(1)
})
it('never labels a server template fallback as Director output', async () => {
  const runtime = createDirectorRuntime(async () => ({ ...output('a'), mode: 'templates', reason: 'budget' }), () => {})
  runtime.setEnabled(true)
  runtime.update([b('a'), b('b')], sessions)
  await tick()
  expect(runtime.results().size).toBe(0)
})
it('oversize/non-finite scenes and complete snapshots over the session limit never request', async () => {
  let attempts = 0
  const runtime = createDirectorRuntime(async () => { attempts++; return output('a') }, () => {})
  runtime.setEnabled(true)
  runtime.update([b('a', NaN), b('b')], sessions)
  runtime.reset()
  const huge: Beat = { ...b('a'), kind: 'says', detail: { kind: 'says', deltas: 1, text: '💀'.repeat(10_000) } }
  runtime.update([huge, b('b')], sessions)
  runtime.reset()
  runtime.update([b('a'), b('b')], [...sessions, ...Array.from({ length: 128 }, (_, i) => ({ id: `kid${i}`, parentID: 'root', agent: 'build' }))])
  await tick()
  expect(attempts).toBe(0)
})
it('sends the complete chat snapshot, preserving duplicate-agent suffixes, not other chats', async () => {
  let sent!: DirectorRequest
  const runtime = createDirectorRuntime(async request => { sent = request; return output('a') }, () => {})
  runtime.setEnabled(true)
  runtime.update([b('a'), b('b')], [...sessions, { id: 'kid', parentID: 'root', agent: 'build' }, { id: 'other', agent: 'build' }])
  await tick()
  expect(sent.sessions.map(s => s.id)).toEqual(['root', 'kid'])
  expect(sent.beats[0].eventIDs).toEqual(['a'])
})
it('carries the observed root project scope for local continuity lookup', async () => {
  let sent!: DirectorRequest
  const runtime = createDirectorRuntime(async request => { sent = request; return output('a') }, () => {})
  runtime.setEnabled(true)
  runtime.update([b('a'), b('b')], [{ id: 'root', agent: 'build', seriesKey: 'directory:/fake/project' }])
  await tick()
  expect(sent.seriesKey).toBe('directory:/fake/project')
})
it('a replay request has no durable series identity even when its frames name a project', async () => {
  let sent!: DirectorRequest
  const runtime = createDirectorRuntime(async request => { sent = request; return output('a') }, () => {})
  runtime.setEnabled(true)
  runtime.update([b('a'), b('b')], [{ id: 'root', agent: 'build', seriesKey: 'directory:/fake/replay' }], false, false)
  await tick()
  expect(sent.seriesKey).toBeUndefined()
})

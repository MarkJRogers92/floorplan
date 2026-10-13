// tests/replay/play.test.ts — the browser-safe, timed replay (review fixes 1 and 2)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { replayFrames } from '../../src/replay/play'

const frames = (...types: string[]) => types.map(type => ({ type, data: {} }))

describe('replayFrames', () => {
  it('lives in a module with no node: imports, so the page can import it', () => {
    const source = readFileSync('src/replay/play.ts', 'utf8')
    expect(source).not.toMatch(/from ['"]node:/)
  })

  it('emits every frame in order', async () => {
    const seen: string[] = []
    await replayFrames(frames('a', 'b', 'c'), f => seen.push(f.type), 0)
    expect(seen).toEqual(['a', 'b', 'c'])
  })

  it('emits nothing when the signal is already aborted', async () => {
    const abort = new AbortController()
    abort.abort()
    const seen: string[] = []
    await replayFrames(frames('a', 'b'), f => seen.push(f.type), 0, abort.signal)
    expect(seen).toEqual([])
  })

  it('stops emitting once its signal aborts', async () => {
    const abort = new AbortController()
    const seen: string[] = []
    await replayFrames(frames('a', 'b', 'c'), f => { seen.push(f.type); abort.abort() }, 1, abort.signal)
    expect(seen).toEqual(['a'])
  })

  it('resolves promptly when aborted during the step delay, not when the timer fires', async () => {
    const abort = new AbortController()
    const seen: string[] = []
    const start = Date.now()
    setTimeout(() => abort.abort(), 10)
    await replayFrames(frames('a', 'b'), f => seen.push(f.type), 1000, abort.signal)
    expect(Date.now() - start).toBeLessThan(200)
    expect(seen).toEqual(['a'])
  })

  it('removes its abort listener after each step, so a long replay does not leak them', async () => {
    let added = 0
    let removed = 0
    const abort = new AbortController()
    const signal = abort.signal
    const add = signal.addEventListener.bind(signal)
    const remove = signal.removeEventListener.bind(signal)
    signal.addEventListener = ((...args: Parameters<typeof add>) => { added++; add(...args) }) as typeof add
    signal.removeEventListener = ((...args: Parameters<typeof remove>) => { removed++; remove(...args) }) as typeof remove
    await replayFrames(frames('a', 'b', 'c', 'd'), () => {}, 1, signal)
    expect(added).toBeGreaterThan(0)
    expect(removed).toBe(added)
  })
})

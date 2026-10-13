// tests/app/demo.test.ts — the local fictional demo (Task 2). Synthetic footage only:
// no network, no files, no real clock, no engine.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { demoFrames, createDemoPlayer } from '../../src/app/demo'
import { createFloor } from '../../src/app/floor'
import { createRollup, seedRollup, rollup, flush } from '../../src/narrative/rollup'
import { assembleEpisodeViews } from '../../src/narrative/views'
import type { Frame } from '../../src/api/sse'

const times = (frames: Frame[]): number[] => frames.map(f => f.created!)

const rollAll = (frames: Frame[]) => {
  let state = seedRollup(createRollup(), { sessions: [], permissions: [] })
  const beats: any[] = []
  for (const frame of frames) { const r = rollup(state, frame); state = r.state; beats.push(...r.beats) }
  return { state, beats: beats.concat(flush(state)) }
}

describe('demoFrames', () => {
  it('is a fresh deep copy every call — array, frames, location and nested data', () => {
    const a = demoFrames()
    const b = demoFrames()
    expect(a).not.toBe(b)
    expect(a[0]).not.toBe(b[0])
    expect(a[0].data).not.toBe(b[0].data)
    ;(a[0].data as any).sessionID = 'mutated'
    a[0].location!.directory = '/mutated'
    expect((b[0].data as any).sessionID).toBe('ses_demo_lead')
    expect(b[0].location).toEqual({ directory: '/demo/fictional-office' })
    expect((demoFrames()[0].data as any).sessionID).toBe('ses_demo_lead')
  })

  it('uses fixed synthetic clocks, not the real one: identical across calls, monotonic and positive', () => {
    const frames = demoFrames()
    expect(times(frames)).toEqual(times(demoFrames()))
    const clock = times(frames)
    expect(clock[0]).toBeGreaterThan(0)
    for (let i = 1; i < clock.length; i++) expect(clock[i]).toBeGreaterThan(clock[i - 1])
  })

  it('gives every frame a unique id and labels all of it fiction in the demo directory', () => {
    const frames = demoFrames()
    expect(new Set(frames.map(f => f.id)).size).toBe(frames.length)
    for (const frame of frames) {
      expect(typeof frame.id).toBe('string')
      expect(frame.location).toEqual({ directory: '/demo/fictional-office' })
    }
  })

  it('ends exactly at the script’s last offset, inside the ~20s budget', () => {
    const clock = times(demoFrames())
    const span = clock[clock.length - 1] - clock[0]
    expect(span).toBe(19_400)
    expect(span).toBeLessThanOrEqual(20_000)
  })

  it('names only ses_demo_* actors, at most three characters', () => {
    const frames = demoFrames()
    const actors = frames.flatMap(f => {
      const data = f.data as any
      const input = typeof data.input === 'object' && data.input !== null ? (data.input as any).sessionID : undefined
      return [data.sessionID, input].filter((id): id is string => typeof id === 'string')
    })
    expect(actors.length).toBeGreaterThan(0)
    expect(actors.every(id => id.startsWith('ses_demo_'))).toBe(true)
    expect(new Set(actors).size).toBeLessThanOrEqual(3)
  })

  it('puts fictional banter in the footage so even demo speech uses the checked citation path', () => {
    const { beats, state } = rollAll(demoFrames())
    const lines = assembleEpisodeViews(beats, [...state.sessions.values()]).flatMap(v => v.scenes.flatMap(s => s.lines))
    expect(lines.map(l => l.text)).toContain('The compiler has declined our vision.')
    expect(lines.map(l => l.text)).toContain('It works. Nobody touch anything.')
    expect(lines.find(l => l.text === 'The compiler has declined our vision.')!.beatIDs.length).toBeGreaterThan(0)
  })
  it('the fictional reviewer actually clocks in, not an idle ghost pretending to review', () => {
    const floor = createFloor()
    for (const f of demoFrames().filter(f => f.created! <= demoFrames()[0].created! + 8000)) floor.push(f)
    expect(floor.desks().find(d => d.sessionID === 'ses_demo_review')?.status).toBe('working')
  })

  it('imports nothing but the Frame type — no fetch, no node:, no other module', () => {
    const source = readFileSync('src/app/demo.ts', 'utf8')
    expect(source.match(/^import.*$/gm)).toEqual(["import type { Frame } from '../api/sse'"])
    expect(source).not.toMatch(/\bfetch\(/)
    expect(source).not.toMatch(/node:/)
  })
})

describe('the demo rolls up to the promised beats', () => {
  it('traces root job, guest, failures, approvals and the wrap', () => {
    const kinds = rollAll(demoFrames()).beats.map(b => b.kind)
    for (const kind of ['episode-opens', 'human-asks', 'thinks', 'says', 'uses-tool',
      'tool-fails', 'retry', 'knocks', 'answered', 'guest-arrives', 'briefing', 'guest-leaves', 'wrap']) {
      expect(kinds).toContain(kind)
    }
    expect(kinds.filter(k => k === 'tool-fails')).toHaveLength(2)
    expect(kinds.filter(k => k === 'retry')).toHaveLength(2)
  })

  it('has one root and one guest, and no ghost desk', () => {
    const { state } = rollAll(demoFrames())
    expect([...state.roots]).toEqual(['ses_demo_lead'])
    expect([...state.sessions.keys()].sort()).toEqual(['ses_demo_lead', 'ses_demo_review'])
  })

  it('proves each compiler failure by tool name and exit code', () => {
    const fails = rollAll(demoFrames()).beats.filter(b => b.kind === 'tool-fails')
    expect(fails.map(b => b.detail)).toEqual([
      { kind: 'tool-fails', tool: 'shell', callID: 'call_demo_shell_1', exit: 1 },
      { kind: 'tool-fails', tool: 'shell', callID: 'call_demo_check_1', exit: 1 },
    ])
  })

  it('raises the guest on the call that hired it, then the briefing; answers the knock; wraps last', () => {
    const { beats } = rollAll(demoFrames())
    const arrival = beats.findIndex(b => b.kind === 'guest-arrives')
    expect(beats[arrival].detail).toMatchObject({ childSessionID: 'ses_demo_review', callID: 'call_demo_guest_1' })
    expect(beats[arrival + 1].kind).toBe('briefing')
    expect(beats.find(b => b.kind === 'knocks')!.detail).toEqual({ kind: 'knocks', requestID: 'perm_demo_1' })
    expect(beats.find(b => b.kind === 'answered')!.detail).toEqual({ kind: 'answered', reply: 'once' })
    const wrap = beats.find(b => b.kind === 'wrap')!
    expect(wrap.at).toBe(times(demoFrames()).pop())
    expect(beats[beats.length - 1].kind).toBe('wrap')
  })

  it('produces unique beat ids and one synthetic clock throughout', () => {
    const { beats } = rollAll(demoFrames())
    expect(new Set(beats.map(b => b.id)).size).toBe(beats.length)
    expect(beats.every(b => b.kind !== 'silence' && b.at > 0)).toBe(true)
  })
})

describe('createDemoPlayer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const started = () => {
    const pushed: Frame[] = []
    let finishes = 0
    const player = createDemoPlayer(f => pushed.push(f), () => { finishes++ })
    return { player, pushed, finishes: () => finishes }
  }

  it('delivers every frame in order and finishes exactly at the last frame’s offset', async () => {
    const frames = demoFrames()
    const { player, pushed, finishes } = started()
    expect(player.running()).toBe(false)

    player.play()
    expect(player.running()).toBe(true)
    const span = frames[frames.length - 1].created! - frames[0].created!

    await vi.advanceTimersByTimeAsync(span - 1)
    expect(pushed).toHaveLength(frames.length - 1)
    expect(finishes()).toBe(0)
    expect(player.running()).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    expect(pushed.map(f => f.id)).toEqual(frames.map(f => f.id))
    expect(finishes()).toBe(1)
    expect(player.running()).toBe(false)
  })

  it('follows the frames’ own clock: each gap delivers exactly the next frame', async () => {
    const frames = demoFrames()
    const { player, pushed } = started()
    player.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(pushed.map(f => f.id)).toEqual([frames[0].id])
    for (let i = 1; i < frames.length; i++) {
      await vi.advanceTimersByTimeAsync(frames[i].created! - frames[i - 1].created!)
      expect(pushed.map(f => f.id)).toEqual(frames.slice(0, i + 1).map(f => f.id))
    }
  })

  it('cancel stops every future frame and the finish callback, and reports not running', async () => {
    const { player, pushed, finishes } = started()
    player.play()
    await vi.advanceTimersByTimeAsync(5_000)
    const delivered = pushed.length
    expect(delivered).toBeGreaterThan(0)

    player.cancel()
    expect(player.running()).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pushed).toHaveLength(delivered)
    expect(finishes()).toBe(0)
  })

  it('stops mid-delivery when a push cancels the player, and never finishes', async () => {
    const pushed: string[] = []
    let finishes = 0
    const player = createDemoPlayer(f => { pushed.push(f.id!); if (pushed.length === 1) player.cancel() },
      () => { finishes++ })
    player.play()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pushed).toHaveLength(1)
    expect(finishes).toBe(0)
    expect(player.running()).toBe(false)
  })

  it('restart drops every old timer: one delivery per frame, in order', async () => {
    const frames = demoFrames()
    const { player, pushed, finishes } = started()
    player.play()
    await vi.advanceTimersByTimeAsync(2_000)
    const firstRun = pushed.length
    expect(firstRun).toBeGreaterThan(0)

    player.play()
    expect(player.running()).toBe(true)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(pushed).toHaveLength(firstRun + frames.length)
    expect(pushed.slice(firstRun).map(f => f.id)).toEqual(frames.map(f => f.id))
    expect(finishes()).toBe(1)
  })

  it('never reuses a frame object between runs', async () => {
    const frames = demoFrames()
    const { player, pushed } = started()
    player.play()
    await vi.advanceTimersByTimeAsync(20_000)
    player.play()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(pushed[0]).not.toBe(pushed[frames.length])
    expect(pushed[0].data).not.toBe(pushed[frames.length].data)
    expect(pushed[0]).toEqual(expect.objectContaining({ id: frames[0].id }))
  })

  it('is also a floor snapshot: two desks, no ghost employee', () => {
    const floor = createFloor()
    for (const frame of demoFrames()) floor.push(frame)
    expect(floor.desks().map(d => d.sessionID)).toEqual(['ses_demo_lead', 'ses_demo_review'])
  })
})

describe('the demo is proved by the real checker and templates', () => {
  const views = () => {
    const { state, beats } = rollAll(demoFrames())
    return assembleEpisodeViews(beats, [...state.sessions.values()])
  }

  it('assembles one episode whose every line is proved by cited footage', () => {
    const episodes = views()
    expect(episodes).toHaveLength(1)
    expect(episodes[0].scenes.length).toBeGreaterThan(0)
    for (const scene of episodes[0].scenes) {
      expect(scene.check.failures).toEqual([])
      expect(scene.heading?.text).toBeTruthy()
    }
  })

  it('renders the deadpan literal lines the template layer promises', () => {
    const texts = views()[0].scenes.flatMap(s => s.lines.map(l => l.text))
    expect(texts).toContain('build called shell; the result was exit 1.')
    expect(texts).toContain('The knock was answered: once.')
    expect(texts).toContain('review arrived.')
    expect(texts).toContain('The episode wrapped.')
    expect(texts).toContain('A retry was scheduled.')
  })

  it('casts the two hired workers and nobody else', () => {
    expect(views()[0].episode.cast.sort()).toEqual(['build', 'review'])
  })
})

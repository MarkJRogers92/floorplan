import { describe, it, expect } from 'vitest'
import { createStageRuntime } from '../../src/room/stage'
import type { Beat, BeatDetail, BeatKind } from '../../src/narrative/types'

// Synthetic beats only: archived `at`/`endAt` are epoch-ish to prove the runtime reads
// the reception clock passed in, never the beat's own timestamps.
const DETAILS: Record<BeatKind, BeatDetail> = {
  'episode-opens': { kind: 'episode-opens' },
  'human-asks': { kind: 'human-asks' },
  briefing: { kind: 'briefing', childSessionID: 'ses_child' },
  thinks: { kind: 'thinks', deltas: 12 },
  says: { kind: 'says', deltas: 3, text: 'on it' },
  'uses-tool': { kind: 'uses-tool', tool: 'read' },
  'tool-fails': { kind: 'tool-fails', tool: 'bash', exit: 1 },
  'guest-arrives': { kind: 'guest-arrives', childSessionID: 'ses_child' },
  'guest-leaves': { kind: 'guest-leaves', childSessionID: 'ses_child' },
  knocks: { kind: 'knocks', requestID: 'req_1' },
  answered: { kind: 'answered', reply: 'yes' },
  retry: { kind: 'retry', attempt: 2 },
  'memory-wipe': { kind: 'memory-wipe' },
  wrap: { kind: 'wrap' },
  cut: { kind: 'cut', reason: 'interrupted' },
  silence: { kind: 'silence', fromEventID: 'e1', toEventID: 'e2', ms: 900 },
}

const beat = (kind: BeatKind, sessionID = 'ses_a', id = `b:${kind}`): Beat => ({
  id,
  at: 1_700_000_000_000,
  endAt: 1_700_000_000_500,
  eventIDs: [id],
  kind,
  sessionID,
  detail: DETAILS[kind],
})

describe('stage runtime', () => {
  it('maps every beat kind to its pose, wrapping never reads as success', () => {
    const expected: Record<BeatKind, string> = {
      thinks: 'think',
      says: 'speak',
      'uses-tool': 'work',
      'tool-fails': 'recoil',
      knocks: 'alert',
      answered: 'alert',
      'guest-arrives': 'arrive',
      'guest-leaves': 'leave',
      wrap: 'wrap',
      cut: 'cut',
      'memory-wipe': 'forget',
      retry: 'retry',
      'episode-opens': 'idle',
      'human-asks': 'idle',
      briefing: 'idle',
      silence: 'idle',
    }
    for (const [kind, pose] of Object.entries(expected)) {
      const stage = createStageRuntime()
      stage.update([beat(kind as BeatKind)], 0)
      // one beat in, one frame out; which desk it lands on is asserted below
      const frames = [...stage.frames(0).values()]
      expect(frames.length, kind).toBe(1)
      expect(frames[0].pose, kind).toBe(pose)
    }
  })

  it('cites the original beat id and echoes its kind', () => {
    const stage = createStageRuntime()
    stage.update([beat('uses-tool', 'ses_a', 'b:evt_42')], 0)
    const frame = stage.frames(0).get('ses_a')
    expect(frame?.beatID).toBe('b:evt_42')
    expect(frame?.kind).toBe('uses-tool')
  })

  it('stages guest arrivals, departures and briefings on the child, not the parent', () => {
    for (const kind of ['guest-arrives', 'guest-leaves', 'briefing'] as const) {
      const stage = createStageRuntime()
      stage.update([beat(kind, 'ses_parent')], 0)
      const frames = stage.frames(0)
      expect([...frames.keys()], kind).toEqual(['ses_child'])
      expect(frames.get('ses_child')?.sessionID, kind).toBe('ses_child')
    }
  })

  it('invents no actor: a child cue leaves no frame for the parent', () => {
    const stage = createStageRuntime()
    stage.update([beat('guest-arrives', 'ses_parent')], 0)
    expect(stage.frames(0).has('ses_parent')).toBe(false)
  })

  it('keeps one cue per actor and replaces it with the newest', () => {
    const stage = createStageRuntime()
    stage.update([beat('thinks', 'ses_a', 'b:one')], 0)
    stage.update([beat('says', 'ses_a', 'b:two')], 100)
    const frames = stage.frames(150)
    expect(frames.size).toBe(1)
    expect(frames.get('ses_a')?.beatID).toBe('b:two')
    expect(frames.get('ses_a')?.pose).toBe('speak')
  })

  it('keeps other actors visible while one actor re-cues', () => {
    const stage = createStageRuntime()
    stage.update([beat('thinks', 'ses_a', 'b:one'), beat('uses-tool', 'ses_b', 'b:two')], 0)
    stage.update([beat('wrap', 'ses_a', 'b:three')], 50)
    const frames = stage.frames(60)
    expect([...frames.keys()].sort()).toEqual(['ses_a', 'ses_b'])
    expect(frames.get('ses_a')?.beatID).toBe('b:three')
    expect(frames.get('ses_b')?.beatID).toBe('b:two')
  })

  it('ignores a repeat of the same session and beat id instead of replaying it', () => {
    const stage = createStageRuntime()
    stage.update([beat('says', 'ses_a', 'b:once')], 0)
    stage.update([beat('says', 'ses_a', 'b:once')], 1500)
    expect(stage.frames(1999).has('ses_a')).toBe(true)
    expect(stage.frames(2000).has('ses_a')).toBe(false)
  })

  it('ignores the same beat id arriving for a different session', () => {
    const stage = createStageRuntime()
    stage.update([beat('says', 'ses_a', 'b:shared'), beat('says', 'ses_b', 'b:shared')], 0)
    const frames = stage.frames(0)
    expect([...frames.keys()].sort()).toEqual(['ses_a', 'ses_b'])
    expect(frames.get('ses_b')?.beatID).toBe('b:shared')
  })

  it('expires a cue 2000ms after reception, not after the beat timestamps', () => {
    const stage = createStageRuntime()
    stage.update([beat('tool-fails', 'ses_a')], 1000)
    expect(stage.frames(2999).get('ses_a')?.pose).toBe('recoil')
    expect(stage.frames(3000).has('ses_a')).toBe(false)
  })

  it('ignores updates with a non-finite, negative or backwards clock', () => {
    for (const now of [Number.NaN, Infinity, -1, -0.5]) {
      const stage = createStageRuntime()
      stage.update([beat('says')], now)
      expect(stage.frames(0).size, String(now)).toBe(0)
    }
    const stage = createStageRuntime()
    stage.update([beat('says')], 500)
    stage.update([beat('wrap')], 499)
    expect(stage.frames(600).get('ses_a')?.beatID).toBe('b:says')
  })

  it('produces no frame for a non-finite, negative or backwards frame clock', () => {
    const stage = createStageRuntime()
    stage.update([beat('says')], 500)
    expect(stage.frames(Number.NaN).size).toBe(0)
    expect(stage.frames(-1).size).toBe(0)
    expect(stage.frames(499).size).toBe(0)
    expect(stage.frames(500).size).toBe(1)
  })

  it('flattens every moving pose to 0/0 under reduced motion', () => {
    const moving: BeatKind[] = [
      'thinks', 'says', 'uses-tool', 'tool-fails', 'knocks', 'answered',
      'guest-arrives', 'guest-leaves', 'wrap', 'cut', 'memory-wipe', 'retry',
    ]
    for (const kind of moving) {
      const stage = createStageRuntime()
      stage.update([beat(kind)], 0)
      const frame = [...stage.frames(10, true).values()][0]
      expect([frame.dx, frame.dy], kind).toEqual([0, 0])
    }
  })

  it('leaves an idle pose still, reduced motion or not', () => {
    const stage = createStageRuntime()
    stage.update([beat('silence')], 0)
    expect(stage.frames(10).get('ses_a')).toMatchObject({ pose: 'idle', dx: 0, dy: 0 })
  })

  it('offsets a moving pose by bounded integers that vary and stay deterministic', () => {
    const moving: BeatKind[] = [
      'thinks', 'says', 'uses-tool', 'tool-fails', 'knocks', 'answered',
      'guest-arrives', 'guest-leaves', 'wrap', 'cut', 'memory-wipe', 'retry',
    ]
    const offsets = moving.map((kind, i) => {
      const stage = createStageRuntime()
      stage.update([beat(kind, 'ses_a', `b:${i}`)], 0)
      const frame = [...stage.frames(10).values()][0]
      for (const d of [frame.dx, frame.dy]) {
        expect(Number.isInteger(d), kind).toBe(true)
        expect(Math.abs(d), kind).toBeLessThanOrEqual(3)
      }
      // same beat, fresh runtime: identical offset, never jittering per render
      const again = createStageRuntime()
      again.update([beat(kind, 'ses_a', `b:${i}`)], 0)
      expect([...again.frames(10).values()][0], kind).toMatchObject({ dx: frame.dx, dy: frame.dy })
      return `${frame.dx},${frame.dy}`
    })
    expect(new Set(offsets).size, 'motion poses must not share one offset').toBeGreaterThan(1)
  })

  it('resets cues, dedupe and the clock', () => {
    const stage = createStageRuntime()
    stage.update([beat('says', 'ses_a', 'b:once')], 5000)
    expect(stage.frames(6999).get('ses_a')?.beatID).toBe('b:once')
    stage.reset()
    expect(stage.frames(10).size).toBe(0)
    // dedupe cleared and the clock restarts, so the same beat may cue again from a low now
    stage.update([beat('says', 'ses_a', 'b:once')], 20)
    expect(stage.frames(30).get('ses_a')?.beatID).toBe('b:once')
  })
})

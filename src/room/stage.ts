import type { Beat, BeatKind } from '../narrative/types'

/** The staged reaction poses. There is no `success`: a `wrap` is a wrap, not a win. */
export type StagePose =
  | 'idle'
  | 'think'
  | 'speak'
  | 'work'
  | 'recoil'
  | 'alert'
  | 'arrive'
  | 'leave'
  | 'wrap'
  | 'cut'
  | 'forget'
  | 'retry'

export type StageFrame = {
  /**
   * The actor whose desk carries the pose — a guest cue names the child, never the
   * parent, so a caller cannot draw an arrival on the wrong desk. Same value as the
   * frame's map key. Cite `beatID` for provenance; `at`/`endAt` are never exposed.
   */
  sessionID: string
  /** The source beat's own id: the citation a caption shows. */
  beatID: string
  kind: BeatKind
  pose: StagePose
  dx: number
  dy: number
}

const POSES: Partial<Record<BeatKind, StagePose>> = {
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
}

const CUE_MS = 2000

/** Guests act on their own desk; every other beat acts where it happened. */
function actorOf(beat: Beat): string {
  return 'childSessionID' in beat.detail ? beat.detail.childSessionID : beat.sessionID
}

/** Deterministic integer in [-3,3] from the beat's identity, so a redraw cannot jitter. */
function offsetOf(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return (Math.abs(h) % 7) - 3
}

/**
 * Pure stage cue runtime: real beats in, per-actor pose frames out. No DOM, no canvas,
 * no timers, no clock of its own — `now` is the caller's reception clock, so
 * replay follows reception time; callers keep archived recap beats out of update. Actor ids are handed back
 * untouched; the room decides which of them still have a desk.
 */
export function createStageRuntime() {
  const cues = new Map<string, { beat: Beat; at: number }>()
  const seen = new Set<string>()
  let last = 0

  /** Accepts only a finite, nonnegative, non-decreasing reception clock. */
  function clock(now: number): boolean {
    if (!Number.isFinite(now) || now < last) return false
    last = now
    return true
  }

  return {
    update(arrived: Beat[], now: number): void {
      if (!clock(now)) return
      for (const beat of arrived) {
        const key = JSON.stringify([beat.sessionID, beat.id])
        if (seen.has(key)) continue
        seen.add(key)
        cues.set(actorOf(beat), { beat, at: now })
      }
    },

    frames(now: number, reducedMotion = false): Map<string, StageFrame> {
      const out = new Map<string, StageFrame>()
      if (!clock(now)) return out
      for (const [actor, cue] of cues) {
        if (now - cue.at >= CUE_MS) continue
        const { beat } = cue
        const pose = POSES[beat.kind] ?? 'idle'
        const still = reducedMotion || pose === 'idle'
        const phase = Math.floor((now - cue.at) / 120) % 4
        const seed = `${JSON.stringify([actor, beat.id])}:${phase}`
        out.set(actor, {
          sessionID: actor,
          beatID: beat.id,
          kind: beat.kind,
          pose,
          dx: still ? 0 : offsetOf(seed),
          dy: still ? 0 : offsetOf(`${seed}\u0001`),
        })
      }
      return out
    },

    reset(): void {
      cues.clear()
      seen.clear()
      last = 0
    },
  }
}

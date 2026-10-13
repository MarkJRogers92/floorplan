/**
 * The local fictional demo (office-experiment design §"The demo is the onboarding").
 *
 * A ~20s scripted scene that drives the existing frame → floor/rollup/script path with
 * synthetic footage: the lead gets a job, hits a compiler failure, retries, asks for
 * approval, hires a guest who hits its own failure, then wraps. Frames are OpenCode V2
 * event shapes the rollup already folds, and the whole scene is fiction: fixed synthetic
 * clocks (never the real one), ses_demo_* actors, one `/demo/fictional-office` directory.
 * Scripted speech is explicitly fictional footage, checked and cited like any other run.
 * No real model, file or job claim. Pure: no I/O, no fetch, no clock; the only import is Frame.
 */

import type { Frame } from '../api/sse'

const DEMO_DIRECTORY = '/demo/fictional-office'
// Fixed synthetic epoch + offsets: replaying the script twice must be byte-identical, so
// no real clock is ever consulted (the player normalises the first offset to 0 anyway).
const DEMO_BASE = 1_700_000_000_000
const LEAD = 'ses_demo_lead'
const REVIEW = 'ses_demo_review'
const HOME = { sessionID: LEAD }
const GUEST = { sessionID: REVIEW }

/** [offset ms from the first frame, event type, data]. Offsets increase; last = 19_400ms. */
const SCRIPT: ReadonlyArray<readonly [number, string, Record<string, unknown>]> = [
  // Act one: the Human asks, the lead thinks, and its first shell command fails.
  [0, 'session.created', { ...HOME, agent: 'build' }],
  [400, 'inbox.enqueued', { ...HOME, item: { type: 'user' } }], // the Human asking
  [800, 'execution.started', { ...HOME }],
  [1000, 'step.started', { ...HOME, agent: 'build' }],
  [1200, 'reasoning.started', { ...HOME }],
  [1400, 'reasoning.delta', { ...HOME }],
  [1600, 'reasoning.delta', { ...HOME }],
  [1800, 'reasoning.delta', { ...HOME }],
  [2000, 'reasoning.ended', { ...HOME }],
  [2200, 'tool.input.started', { ...HOME, id: 'call_demo_shell_1', name: 'shell' }],
  [2400, 'tool.called', { ...HOME, id: 'call_demo_shell_1' }],
  [2600, 'tool.progress', { ...HOME, id: 'call_demo_shell_1', metadata: { shellID: 'shell_demo_1' } }],
  [2800, 'shell.exited', { ...HOME, id: 'shell_demo_1', exit: 1 }],
  // A non-zero exit arrives as tool.success carrying metadata.exit — the §4.1 amendment.
  [3000, 'tool.success', { ...HOME, id: 'call_demo_shell_1', metadata: { exit: 1 } }],
  [3200, 'retry.scheduled', { ...HOME, attempt: 2 }],
  [3400, 'text.started', { ...HOME }],
  [3600, 'text.delta', { ...HOME }],
   [3800, 'text.ended', { ...HOME, text: 'The compiler has declined our vision.' }],

  // Act two: it knocks, and the Human answers.
  [4000, 'permission.asked', { ...HOME, id: 'perm_demo_1' }],
  [4200, 'permission.replied', { ...HOME, requestID: 'perm_demo_1', reply: 'once' }],
  [4400, 'text.started', { ...HOME }],
  [4600, 'text.delta', { ...HOME }],
  [4800, 'text.delta', { ...HOME }],
   [5000, 'text.ended', { ...HOME, text: 'Permission granted. Responsibility remains unclear.' }],

  // Act three: a lull, then the guest is hired, briefed, and finds the same failure.
  [6400, 'tool.input.started', { ...HOME, id: 'call_demo_guest_1', name: 'subagent', input: { sessionID: REVIEW } }],
  [6600, 'tool.called', { ...HOME, id: 'call_demo_guest_1' }],
  [6800, 'session.created', { ...GUEST, agent: 'review', parentID: LEAD }],
   [7000, 'inbox.enqueued', { ...GUEST, item: { type: 'user' } }], // the briefing
   [7100, 'execution.started', { ...GUEST }],
   [7180, 'step.started', { ...GUEST, agent: 'review' }],
  [7200, 'text.started', { ...GUEST }],
  [7400, 'text.delta', { ...GUEST }],
  [7600, 'text.delta', { ...GUEST }],
   [7800, 'text.ended', { ...GUEST, text: 'Independent review: I independently dislike it.' }],
  [8000, 'tool.input.started', { ...GUEST, id: 'call_demo_check_1', name: 'shell' }],
  [8200, 'tool.called', { ...GUEST, id: 'call_demo_check_1' }],
  [8400, 'tool.progress', { ...GUEST, id: 'call_demo_check_1', metadata: { shellID: 'shell_demo_2' } }],
  [8600, 'shell.exited', { ...GUEST, id: 'shell_demo_2', exit: 1 }],
  [8800, 'tool.success', { ...GUEST, id: 'call_demo_check_1', metadata: { exit: 1 } }],
   [9000, 'retry.scheduled', { ...GUEST, attempt: 2 }],
   [9100, 'execution.failed', { ...GUEST }],

  // Act four: the guest leaves, the retry passes (exit 0), and the episode wraps.
  [9200, 'tool.success', { ...HOME, id: 'call_demo_guest_1', metadata: { sessionID: REVIEW } }],
  [9800, 'text.started', { ...HOME }],
  [10_400, 'text.delta', { ...HOME }],
   [11_000, 'text.ended', { ...HOME, text: 'Useful feedback. I will file it under morale.' }],
  [11_600, 'reasoning.started', { ...HOME }],
  [12_200, 'reasoning.delta', { ...HOME }],
  [12_800, 'reasoning.delta', { ...HOME }],
  [13_400, 'reasoning.ended', { ...HOME }],
  [14_000, 'tool.input.started', { ...HOME, id: 'call_demo_shell_2', name: 'shell' }],
  [14_600, 'tool.called', { ...HOME, id: 'call_demo_shell_2' }],
  [15_200, 'tool.progress', { ...HOME, id: 'call_demo_shell_2', metadata: { shellID: 'shell_demo_3' } }],
  [15_800, 'shell.exited', { ...HOME, id: 'shell_demo_3', exit: 0 }],
  [16_400, 'tool.success', { ...HOME, id: 'call_demo_shell_2', metadata: { exit: 0 } }],
  [17_000, 'text.started', { ...HOME }],
  [17_600, 'text.delta', { ...HOME }],
  [18_200, 'text.delta', { ...HOME }],
   [18_800, 'text.ended', { ...HOME, text: 'It works. Nobody touch anything.' }],
  [19_400, 'execution.succeeded', { ...HOME }],
]

/**
 * A fresh copy of the scripted scene. Ids are index-derived so they stay unique, and the
 * data is cloned per call: a caller (or a test) that mutates one frame must never change
 * what the next call — or a later replay — receives.
 */
export function demoFrames(): Frame[] {
  return SCRIPT.map(([offset, type, data], i) => ({
    id: `demo-evt-${i}`,
    created: DEMO_BASE + offset,
    type: type.startsWith('session.') || type.startsWith('permission.') ? type : `session.${type}`,
    location: { directory: DEMO_DIRECTORY },
    data: structuredClone(data),
  }))
}

/**
 * Play the demo by its own clock: frame offsets relative to the first. Delivery is a
 * timer per frame; `cancel` drops every timer and prevents both later frames and the
 * finish callback, and `play` restarts from the top (clearing any run still in flight).
 * The callbacks are re-checked after every push, so a cancellation raised *from* a
 * delivery stops the run rather than letting the last frame finish it.
 */
export function createDemoPlayer(push: (frame: Frame) => void, finish: () => void): {
  play(): void
  cancel(): void
  running(): boolean
} {
  let timers: ReturnType<typeof setTimeout>[] = []
  let playing = false

  const stop = () => {
    for (const timer of timers) clearTimeout(timer)
    timers = []
    playing = false
  }

  return {
    play() {
      stop()
      const frames = demoFrames()
      const first = frames[0]!.created!
      playing = true
      frames.forEach((frame, i) => {
        timers.push(setTimeout(() => {
          if (!playing) return
          push(frame)
          if (!playing) return // a push may have cancelled us
          if (i === frames.length - 1) {
            playing = false
            finish()
          }
        }, frame.created! - first))
      })
    },
    cancel() {
      stop()
    },
    running() {
      return playing
    },
  }
}

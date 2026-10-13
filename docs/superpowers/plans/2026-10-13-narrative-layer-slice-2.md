# The narrative layer, slice 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Episodes with scenes the checker has passed, rendered on the page — still template-narrated, still with no model anywhere. The Director (slice 3) then has checked scenes to work on and a contract to satisfy.

**Architecture:** Three pure layers stack on slice 1's beats: `assembleScenes` cuts the beat list into scenes (§4.2's four closing rules), `assembleEpisodes` groups scenes by root (§5.6), and `checkScene` enforces §5.2's five checks over a scene's lines. The page renders scenes under headings inside an episode view instead of its current location-only grouping. Task 1 first pays down every deferred item the Director would otherwise stand on.

**Tech Stack:** TypeScript, Vite, vitest, bun. No framework, no new dependency, no model calls, no key, no spending in this slice.

**Spec:** `docs/superpowers/specs/2026-10-12-narrative-layer-design.md` — read §4.2 (scene rules), §5.2 (the five checks), §5.3 (the cold open), §5.5–5.6 (cast, episodes), §6 (the data model) and §12 (the settled decisions).

**Execution status:** Tasks 1–5 are implemented. The original examples below are a
historical plan, not the final interfaces: see the execution notes at the end,
especially D2's chat identity overriding the contradictory Task 3 timeout examples.

## Global Constraints

- **OpenCode is never modified.** This is a client. No patches, no forks, no plugins.
- **Nothing in the narrative invents work.** Every string a renderer shows is a `Line` with at least one cited beat. A line no slot can fill is dropped, never repaired.
- **Everything new in Tasks 1–4 is pure.** No model, no clock, no I/O, no `Date.now()`, no timers. All time comes from frames' `created` or beats' `at`/`endAt`. A replay of the same fixture must produce identical scenes, episodes and verdicts.
- No `Buffer`, `process`, `require`, `__dirname` or `node:` imports in `src/`. `node:` in `tests/` is expected.
- **Recordings are sensitive.** `fixtures/raw/` is git-ignored; a committed fixture is scrubbed first. The service password is never committed, logged or printed.
- No file over ~400 lines. No mock state in a shipped path. MIT-compatible deps only; no new dependency.
- **`bun run test` and `bun run typecheck` must both pass before every commit.**

## Review Focus

Inputs and failure modes the spec implies but no task's tests would otherwise exercise, most likely to bite first. Each is pinned to a test in the task that owns the code.

1. **A reconnect re-seed merging explicit `undefined` over stream-learned fields** — a child re-seeded without its `parentID` must not become a root, and a session re-seeded without its `agent` must not lose its name. → Task 1.
2. **An arrival separated from its briefing** — the arrival opens the guest scene and the briefing follows into it; order across the boundary must be preserved, never re-sorted. → Task 2.
3. **An episode whose end is decided by a root frame that never comes** — flush must close it; a scene that never closes must not strand its beats unnarrated. → Task 3.
4. **The checker judging template-only lines** — with no Director yet, an honest scene must still pass; the §5.3 cold open is the fixture that proves it. → Task 4.
5. **Scenes changing under a live stream** — lines are keyed by beat id and scenes are recomputed from the beat list, never incrementally mutated, so a re-cut cannot renarrate or drop a beat. → Task 5.

---

### Task 1: Pay down what the Director stands on

**Files:**
- Modify: `src/narrative/types.ts`, `src/narrative/rollup.ts`, `src/narrative/calls.ts`, `src/narrative/silence.ts`, `src/narrative/line.ts`, `src/narrative/templates.ts`, `src/narrative/cast.ts`, `src/narrative/vocabulary.ts`
- Test: `tests/narrative/debt.test.ts` (new; plus small additions to existing files where the fix lives next to its rule)

**Interfaces:**
- Consumes: everything from slice 1
- Produces: `endAt: number` on every `Beat`; `closed?: boolean` on the line `Ctx`; no other signature changes (only `vocabulary.ts`'s comment and `raisesToolFails`'s export change shape, and neither is imported elsewhere)

Twelve small fixes, each with its test. They are independent — implement in any order, commit once.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/narrative/debt.test.ts
import { describe, it, expect } from 'vitest'
import { createRollup, seedRollup, rollup, flush } from '../../src/narrative/rollup'
import { renderLine, type Line } from '../../src/narrative/line'
import type { Beat } from '../../src/narrative/types'

const f = (type: string, data: unknown = {}, extra: any = {}) => ({ type, data, ...extra })
const seeded = () =>
  seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
const drive = (st: any, frames: any[]) => {
  const beats: any[] = []
  for (const fr of frames) { const r = rollup(st, fr); st = r.state; beats.push(...r.beats) }
  return { state: st, beats }
}

describe('beats carry their end', () => {
  it('a run beat ends where its closing frame is', () => {
    const { beats } = drive(seeded(), [
      f('reasoning.started', { sessionID: 'x' }, { id: 'a', created: 1000 }),
      f('reasoning.delta', { sessionID: 'x' }, { id: 'b', created: 2000 }),
      f('reasoning.ended', { sessionID: 'x' }, { id: 'c', created: 9000 }),
    ])
    expect(beats[0].at).toBe(1000)
    expect(beats[0].endAt).toBe(9000)
  })

  it('an immediate beat ends where it starts', () => {
    const { beats } = drive(seeded(), [
      f('permission.asked', { sessionID: 'x', id: 'p1' }, { id: 'a', created: 500 }),
    ])
    expect(beats[0].endAt).toBe(500)
  })

  it('{dur:} measures to the last event, not the first', () => {
    const beats = new Map<string, Beat>([
      ['b:1', { id: 'b:1', at: 0, endAt: 1000, eventIDs: ['e1'], kind: 'uses-tool', sessionID: 'x', detail: { kind: 'uses-tool', tool: 'read', callID: 'c1' } }],
      ['b:2', { id: 'b:2', at: 2000, endAt: 9000, eventIDs: ['e2'], kind: 'uses-tool', sessionID: 'x', detail: { kind: 'uses-tool', tool: 'read', callID: 'c2' } }],
    ])
    const ctx: any = { cast: () => 'build', beats: [...beats.values()] }
    const line: Line = { id: 'l', speaker: 'narrator', template: 'It took {dur:b:1..b:2}.', cites: ['b:1', 'b:2'] }
    expect(renderLine(line, beats, ctx)).toEqual({ text: 'It took nine seconds.', delivery: 'narration' })
  })
})

describe('{never:} needs a closed episode', () => {
  const toolBeat = (id: string): Beat =>
    ({ id, at: 0, endAt: 0, eventIDs: [id], kind: 'uses-tool', sessionID: 'x', detail: { kind: 'uses-tool', tool: 'read', callID: 'c1' } })
  const line: Line = { id: 'l', speaker: 'narrator', template: 'It {never:wrap}.', cites: ['b:0'] }

  it('renders when the context is closed and no cited range contains one', () => {
    const beats = new Map<string, Beat>([['b:0', toolBeat('b:0')]])
    const ctx: any = { cast: () => 'build', beats: [...beats.values()], closed: true }
    expect(renderLine(line, beats, ctx)).toHaveProperty('text')
  })

  it('rejects when the context is still open', () => {
    const beats = new Map<string, Beat>([['b:0', toolBeat('b:0')]])
    const ctx: any = { cast: () => 'build', beats: [...beats.values()] }
    expect(renderLine(line, beats, ctx)).toHaveProperty('rejected')
  })
})

describe('a missing beat is a rejection, never a throw', () => {
  it('rejects a slot whose beat is in the order but absent from the map', () => {
    const beats = new Map<string, Beat>()
    beats.set('b:1', { id: 'b:1', at: 0, endAt: 0, eventIDs: ['e1'], kind: 'uses-tool', sessionID: 'x', detail: { kind: 'uses-tool', tool: 'read', callID: 'c1' } })
    const ctx: any = { cast: () => 'build', beats: [
      { id: 'b:1', at: 0, endAt: 0, eventIDs: ['e1'], kind: 'uses-tool', sessionID: 'x', detail: { kind: 'uses-tool', tool: 'read', callID: 'c1' } },
      { id: 'b:9', at: 9, endAt: 9, eventIDs: ['e9'], kind: 'uses-tool', sessionID: 'x', detail: { kind: 'uses-tool', tool: 'read', callID: 'c9' } },
    ] }
    const line: Line = { id: 'l', speaker: 'narrator', template: 'It ran {again:b:1,b:9}.', cites: ['b:1'] }
    expect(() => renderLine(line, beats, ctx)).not.toThrow()
    expect(renderLine(line, beats, ctx)).toHaveProperty('rejected')
  })
})

describe('re-seed never forgets what the stream taught it', () => {
  it('skips undefined snapshot fields instead of spreading them over learned ones', () => {
    let st = seedRollup(createRollup(), { sessions: [{ id: 'x', parentID: 'p', agent: 'build' }], permissions: [] })
    st = seedRollup(st, { sessions: [{ id: 'x', parentID: undefined, agent: undefined }], permissions: [] })
    const s = st.sessions.get('x')
    expect(s.parentID).toBe('p')
    expect(s.agent).toBe('build')
    expect(st.roots.has('x')).toBe(false)
  })
})

describe('small correctness', () => {
  it('uses-tool carries the success’s own exit when no shell join arrived', () => {
    const { beats } = drive(seeded(), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'bash' }, { id: 'a' }),
      f('tool.success', { sessionID: 'x', id: 'c1', metadata: { exit: 0 } }, { id: 'b' }),
    ])
    expect(beats[0].detail).toMatchObject({ tool: 'bash', exit: 0 })
  })

  it('formatDuration clamps a non-finite gap instead of rendering NaN', () => {
    const beats = new Map<string, Beat>()
    beats.set('b:1', { id: 'b:1', at: 0, endAt: 0, eventIDs: ['e1'], kind: 'silence', sessionID: 'x', detail: { kind: 'silence', fromEventID: 'e0', toEventID: 'e1', ms: NaN } })
    const ctx: any = { cast: () => 'build', beats: [...beats.values()] }
    const line: Line = { id: 'l', speaker: 'narrator', template: 'Nothing happened for {gap:b:1}.', cites: ['b:1'] }
    expect(renderLine(line, beats, ctx)).toEqual({ text: 'Nothing happened for zero seconds.', delivery: 'narration' })
  })

  it('an empty outcome rejects instead of rendering “answered: .”', () => {
    const beats = new Map<string, Beat>()
    beats.set('b:1', { id: 'b:1', at: 0, endAt: 0, eventIDs: ['e1'], kind: 'answered', sessionID: 'x', detail: { kind: 'answered', reply: '' } })
    const ctx: any = { cast: () => 'build', beats: [...beats.values()] }
    const line: Line = { id: 'l', speaker: 'narrator', template: 'The knock was answered: {outcome:b:1}.', cites: ['b:1'] }
    expect(renderLine(line, beats, ctx)).toHaveProperty('rejected')
  })
})
```

And in the existing files, three additions: strengthen `tests/narrative/rollup-runs.test.ts`'s "must not create a call" test with a trailing success frame asserting its `eventIDs` contain only that frame; add a deltas-0 `says` template test in `tests/narrative/line.test.ts` asserting the fallback renders non-empty narration citing the beat without the word "none"; document `sceneHeadingFor`'s precondition (cast always defined) in a comment.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test tests/narrative/debt.test.ts`
Expected: FAIL — `endAt` does not exist, `{never:}` has no gate, missing beats throw, and the rest

- [ ] **Step 3: Implement**

`Beat` gains `endAt: number` (required): the `created` of the beat's last event — immediate beats end where they start; runs end at their closing frame; calls end at their success/failure; silences end at their to-bound; flush-closed runs end at their last event. `{dur:b3..b9}` becomes words(`b9.endAt - b3.at`) with the existing rounding. `Ctx` gains `closed?: boolean`; `{never:}` rejects unless it is true. Replace every `beats.get(id)!` in `line.ts` with a lookup that rejects the line on a miss. `seedRollup` skips `undefined` snapshot fields when merging. `uses-tool` uses the computed `exit` (success metadata first, join fallback). `formatDuration` clamps non-finite input to 0. `{outcome:}` rejects an empty reply; `templateFor`'s answered template uses the slot only for non-empty replies, else the plain line. Remove the `export` from `raisesToolFails` (its `_call` param stays — it is used). Correct `vocabulary.ts`'s header to describe data plus pure helpers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test tests/narrative/debt.test.ts`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(narrative): pay down what the Director stands on"
```

---

### Task 2: Scenes assemble from beats

**Files:**
- Create: `src/narrative/scene.ts`
- Test: `tests/narrative/scene.test.ts`

**Interfaces:**
- Consumes: `Beat`, `BeatDetail` (Task 1 types); `castFor` for scene cast
- Produces: `type Location = { kind: 'desk'; sessionID: string } | { kind: 'to-camera' }`; `type Scene = { id: string; location: Location; rootSessionID: string; cast: CastID[]; beats: string[] }`; `assembleScenes(beats: Beat[], sessions: { id: string; parentID?: string; agent?: string }[]): Scene[]`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/narrative/scene.test.ts
import { describe, it, expect } from 'vitest'
import { assembleScenes } from '../../src/narrative/scene'
import type { Beat } from '../../src/narrative/types'

let n = 0
const b = (kind: string, sessionID = 'root', at = 0, id?: string): Beat =>
  ({ id: id ?? `b:${++n}`, at, endAt: at, eventIDs: [`e${n}`], kind: kind as any, sessionID, detail: { kind } as any })
const sessions = [
  { id: 'root', agent: 'plan' },
  { id: 'kid', parentID: 'root', agent: 'build' },
]

describe('a scene closes on the first of its closers, and the closer opens the next', () => {
  it('a root wrap ends the scene; the wrap opens the next', () => {
    const wrap = b('wrap', 'root', 2000)
    const scenes = assembleScenes([
      b('human-asks', 'root', 0), b('uses-tool', 'root', 1000), wrap,
      b('human-asks', 'root', 3000),
    ], sessions)
    expect(scenes).toHaveLength(2)
    expect(scenes[0].beats).toHaveLength(2)
    expect(scenes[1].beats[0]).toBe(wrap.id)
  })

  it('a child wrap does not close the parent’s scene', () => {
    const scenes = assembleScenes([
      b('human-asks', 'root', 0), b('wrap', 'kid', 1000), b('uses-tool', 'root', 2000),
    ], sessions)
    expect(scenes).toHaveLength(1)
  })

  it('a guest arrival opens the guest scene at the guest’s desk', () => {
    const scenes = assembleScenes([
      b('human-asks', 'root', 0),
      { ...b('guest-arrives', 'root', 1000), detail: { kind: 'guest-arrives', childSessionID: 'kid' } },
      b('briefing', 'kid', 2000),
    ], sessions)
    expect(scenes).toHaveLength(2)
    expect(scenes[1].location).toEqual({ kind: 'desk', sessionID: 'kid' })
    expect(scenes[1].beats).toHaveLength(2)
  })

  it('the thirteenth beat opens a new scene', () => {
    const beats = Array.from({ length: 13 }, (_, i) => b('uses-tool', 'root', i * 1000))
    const scenes = assembleScenes(beats, sessions)
    expect(scenes).toHaveLength(2)
    expect(scenes[0].beats).toHaveLength(12)
  })

  it('a beat past 90 s of created time opens a new scene', () => {
    const third = b('uses-tool', 'root', 91_000)
    const scenes = assembleScenes([
      b('uses-tool', 'root', 0), b('uses-tool', 'root', 89_000), third,
    ], sessions)
    expect(scenes).toHaveLength(2)
    expect(scenes[1].beats[0]).toBe(third.id)
  })

  it('a beat inside 90 s does not', () => {
    const scenes = assembleScenes([
      b('uses-tool', 'root', 0), b('uses-tool', 'root', 89_999),
    ], sessions)
    expect(scenes).toHaveLength(1)
  })
})

describe('scenes carry what the page and the checker need', () => {
  it('ids are deterministic from the opening beat', () => {
    const beats = [b('human-asks', 'root', 0, 'b:x'), b('uses-tool', 'root', 1000, 'b:y')]
    const a = assembleScenes(beats, sessions).map(s => s.id)
    const c = assembleScenes(beats, sessions).map(s => s.id)
    expect(a).toEqual(c)
    expect(a[0]).toBe('scene:b:x')
  })

  it('cast names the sessions present, and the root travels with the scene', () => {
    const scenes = assembleScenes([
      b('uses-tool', 'root', 0), b('briefing', 'kid', 1000),
    ], sessions)
    expect(scenes[0].cast).toEqual(['plan'])
    expect(scenes[0].rootSessionID).toBe('root')
  })

  it('an arrival never separates from its briefing across a boundary', () => {
    const arrival = b('guest-arrives', 'root', 1000)
    ;(arrival.detail as any) = { kind: 'guest-arrives', childSessionID: 'kid' }
    const briefing = b('briefing', 'kid', 2000)
    const scenes = assembleScenes([b('human-asks', 'root', 0), arrival, briefing], sessions)
    // The arrival opens the guest scene and the briefing follows into it, adjacent, arrival first.
    expect(scenes[1].beats[0]).toBe(arrival.id)
    const flat = scenes.flatMap(s => s.beats)
    expect(flat.indexOf(arrival.id) + 1).toBe(flat.indexOf(briefing.id))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/narrative/scene.test.ts`
Expected: FAIL — cannot resolve `../../src/narrative/scene`

- [ ] **Step 3: Implement**

Walk the beats in order, accumulating the current scene. A beat closes the current scene (and opens the next) on the first of: a root act boundary — `human-asks`, `wrap` or `cut` whose session is a root; a `guest-arrives` or `guest-leaves`; the scene reaching 12 beats; the beat's `at` exceeding the scene's first beat `at` by more than 90_000. The closer **starts** the next scene in every case (uniform rule: wraps open the aftermath, asks open the new act, arrivals open the guest scene, overflows open the continuation). Scene location follows the subject: guest beats (`guest-arrives`, `guest-leaves`, `briefing`) sit at the child's desk, everything else at the beat session's desk; a scene's location is its opening beat's. `rootSessionID` walks `parentID` links to the root (a session without one is its own root). Cast is `castFor(sessions)` applied to the sessions present. Scene id is `scene:<opening beat id>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/narrative/scene.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(narrative): cut beats into scenes by the four closing rules"
```

---

### Task 3: Episodes group scenes by root

**Files:**
- Create: `src/narrative/episode.ts`
- Test: `tests/narrative/episode.test.ts`

**Interfaces:**
- Consumes: `Scene` (Task 2)
- Produces: `type Episode = { id: string; seriesID: string; rootSessionID: string; scenes: string[]; cast: CastID[] }`; `assembleEpisodes(scenes: Scene[], sessions: { id: string; parentID?: string; agent?: string }[]): Episode[]`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/narrative/episode.test.ts
import { describe, it, expect } from 'vitest'
import { assembleEpisodes } from '../../src/narrative/episode'

const scene = (id: string, root: string, beats: string[], cast: string[] = ['plan']) => ({
  id, location: { kind: 'desk', sessionID: root } as const,
  rootSessionID: root, cast, beats,
})

describe('episodes group scenes by root', () => {
  it('scenes of one root make one episode', () => {
    const eps = assembleEpisodes([
      scene('scene:a', 'root', ['b:a']), scene('scene:b', 'root', ['b:b']),
    ], [{ id: 'root' }])
    expect(eps).toHaveLength(1)
    expect(eps[0].scenes).toEqual(['scene:a', 'scene:b'])
    expect(eps[0].id).toBe('ep:root')
  })

  it('a guest scene joins its parent’s episode', () => {
    const eps = assembleEpisodes([
      scene('scene:a', 'root', ['b:a']), scene('scene:g', 'root', ['b:g'], ['build']),
    ], [{ id: 'root' }, { id: 'kid', parentID: 'root' }])
    expect(eps).toHaveLength(1)
    expect(eps[0].cast).toEqual(expect.arrayContaining(['plan', 'build']))
  })

  it('two roots make two episodes', () => {
    const eps = assembleEpisodes([
      scene('scene:a', 'r1', ['b:a']), scene('scene:b', 'r2', ['b:b']),
    ], [{ id: 'r1' }, { id: 'r2' }])
    expect(eps.map(e => e.id)).toEqual(['ep:r1', 'ep:r2'])
  })

  it('a resumed chat is the same episode, not part two', () => {
    const eps = assembleEpisodes([
      scene('scene:a', 'root', ['b:a']), scene('scene:b', 'root', ['b:c']),
    ], [{ id: 'root' }])
    expect(eps).toHaveLength(1)
  })

  it('a second opener for the same root joins the existing episode', () => {
    const eps = assembleEpisodes([
      scene('scene:a', 'root', ['b:a']), scene('scene:c', 'root', ['b:d']),
    ], [{ id: 'root' }])
    expect(eps).toHaveLength(1)
    expect(eps[0].scenes).toHaveLength(2)
  })
})
```

Episode end rules (the 10-minute window, `session.deleted`, Act 2) need beat times, which scenes alone do not carry — so this task takes the beats too. Add to the interface: `assembleEpisodes(scenes, sessions, beats: Map<string, Beat>)`. And two more tests:

```ts
describe('episodes end', () => {
  const beat = (id: string, kind: string, sessionID = 'root', at = 0): any =>
    ({ id, at, endAt: at, eventIDs: [id], kind, sessionID, detail: { kind } })

  it('a root wrap followed by ten quiet minutes ends the episode', () => {
    const beats = new Map<string, any>([
      ['b:w', beat('b:w', 'wrap', 'root', 0)],
      ['b:q', beat('b:q', 'uses-tool', 'root', 601_000)],
    ])
    const eps = assembleEpisodes([
      scene('scene:a', 'root', ['b:w']), scene('scene:b', 'root', ['b:q']),
    ], [{ id: 'root' }], beats)
    expect(eps).toHaveLength(2)
  })

  it('a human-asks inside the window is act two of the same episode', () => {
    const beats = new Map<string, any>([
      ['b:w', beat('b:w', 'wrap', 'root', 0)],
      ['b:a', beat('b:a', 'human-asks', 'root', 300_000)],
    ])
    const eps = assembleEpisodes([
      scene('scene:a', 'root', ['b:w']), scene('scene:b', 'root', ['b:a']),
    ], [{ id: 'root' }], beats)
    expect(eps).toHaveLength(1)
  })

  it('flush closes whatever is open', () => {
    const eps = assembleEpisodes([scene('scene:a', 'root', ['b:w'])], [{ id: 'root' }], new Map())
    expect(eps).toHaveLength(1)
  })
})
```

`seriesID` is `''` for now — the series store is slice 3, and an empty string is honest about that. Plot labels (cold open / A / B / tag) are slice 3 with the Director. Say both in a comment.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/narrative/episode.test.ts`
Expected: FAIL — cannot resolve `../../src/narrative/episode`

- [ ] **Step 3: Implement**

Group scenes by `rootSessionID` in first-seen order; one episode per root, id `ep:<root>`. Then apply the end rules per episode: walk its scenes' beats in order (via the beats map, by `at`); a root `wrap`/`cut` followed by no `human-asks` on that root within 10 minutes of `created` time ends the episode at that scene — later scenes start a new episode for the same root (`ep:<root>:2`, …). `session.deleted` is not a beat the rollup emits, so it cannot appear here; flush (no more beats) closes whatever is open. Cast is the union of scene casts in first-seen order. An episode with no scenes is never emitted.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/narrative/episode.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(narrative): group scenes into episodes by root"
```

---

### Task 4: The scene checker

**Files:**
- Create: `src/narrative/check.ts`
- Test: `tests/narrative/check.test.ts`

**Interfaces:**
- Consumes: `Scene` (Task 2), `Line`, `renderLine` (Task 5 of slice 1)
- Produces: `type CheckResult = { ok: boolean; failures: string[] }`; `checkScene(scene: Scene, lines: Line[], ctx: { beats: Map<string, Beat>; agents: Map<string, string | undefined>; episodeBeatIDs: Set<string> }): CheckResult`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/narrative/check.test.ts
import { describe, it, expect } from 'vitest'
import { checkScene } from '../../src/narrative/check'
import type { Line } from '../../src/narrative/line'
import type { Beat } from '../../src/narrative/types'

const beat = (id: string, kind: string, sessionID = 'root', at = 0): Beat =>
  ({ id, at, endAt: at, eventIDs: [id], kind: kind as any, sessionID, detail: { kind } as any })
const line = (id: string, speaker: Line['speaker'], template: string, cites: string[]): Line =>
  ({ id, speaker, template, cites })
const scene: any = { id: 'scene:b:1', location: { kind: 'desk', sessionID: 'root' }, rootSessionID: 'root', cast: ['plan'], beats: ['b:1', 'b:2'] }
const ctxOf = (beats: Beat[]) => ({
  beats: new Map(beats.map(b => [b.id, b])),
  agents: new Map([['root', 'plan'], ['kid', 'build']]),
  episodeBeatIDs: new Set(beats.map(b => b.id)),
})

describe('the five checks', () => {
  it('passes an honest scene', () => {
    const beats = [beat('b:1', 'human-asks', 'root', 0), beat('b:2', 'uses-tool', 'root', 1000)];
    const lines = [
      line('l:1', 'narrator', 'It began.', ['b:1']),
      line('l:2', 'narrator', 'It continued.', ['b:2']),
    ];
    expect(checkScene(scene, lines, ctxOf(beats)).ok).toBe(true)
  })

  it('rejects a speaker the footage does not name', () => {
    const beats = [beat('b:1', 'uses-tool', 'root', 0)];
    const lines = [line('l:1', 'explore', 'It happened.', ['b:1'])];
    expect(checkScene(scene, lines, ctxOf(beats)).ok).toBe(false)
  })

  it('rejects a cite from another episode', () => {
    const beats = [beat('b:1', 'uses-tool', 'root', 0)];
    const lines = [line('l:1', 'narrator', 'It happened.', ['b:9'])];
    expect(checkScene(scene, lines, ctxOf(beats)).ok).toBe(false)
  })

  it('rejects lines out of time order', () => {
    const beats = [beat('b:1', 'uses-tool', 'root', 0), beat('b:2', 'uses-tool', 'root', 1000)];
    const lines = [
      line('l:1', 'narrator', 'Something happened.', ['b:2']),
      line('l:2', 'narrator', 'Something else happened.', ['b:1']),
    ];
    expect(checkScene(scene, lines, ctxOf(beats)).ok).toBe(false)
  })

  it('allows a flashback to break time order, rendered as one', () => {
    const beats = [beat('b:1', 'uses-tool', 'root', 0), beat('b:2', 'uses-tool', 'root', 1000)];
    const lines = [
      line('l:1', 'narrator', 'Something happened.', ['b:2']),
      { ...line('l:2', 'narrator', 'Something else happened.', ['b:1']), flashback: true },
    ];
    expect(checkScene(scene, lines, ctxOf(beats)).ok).toBe(true)
  })

  it('rejects a scene that buries a failure', () => {
    const beats = [beat('b:1', 'uses-tool', 'root', 0), beat('b:2', 'tool-fails', 'root', 1000)];
    const lines = [line('l:1', 'narrator', 'All went well.', ['b:1'])];
    expect(checkScene(scene, lines, ctxOf(beats)).ok).toBe(false)
  })

  it('rejects dialogue from a character the scene never cites', () => {
    const beats = [beat('b:1', 'uses-tool', 'root', 0)];
    const lines = [line('l:1', 'kid', 'I was there.', ['b:1'])];
    expect(checkScene(scene, lines, ctxOf(beats)).ok).toBe(false)
  })
})

describe('the cold open', () => {
  it('passes the §5.3 scene: seven shells, two edits, two writes, then two and two', () => {
    const beats: Beat[] = [
      beat('b:1', 'guest-arrives', 'root', 0),
      beat('b:2', 'briefing', 'kid', 1000),
      beat('b:3', 'uses-tool', 'kid', 2000),
      beat('b:4', 'uses-tool', 'kid', 3000),
      beat('b:16', 'says', 'kid', 4000),
      beat('b:17', 'wrap', 'kid', 5000),
    ];
    const cold: any = { ...scene, cast: ['plan', 'build'], beats: beats.map(b => b.id) };
    const lines = [
      line('l:1', 'narrator', 'A temp arrives.', ['b:1']),
      line('l:2', 'narrator', 'It reports back.', ['b:17']),
    ];
    expect(checkScene(cold, lines, ctxOf(beats)).ok).toBe(true)
  })
})
```

Wait — `'Build pointed read.'` in the honest-scene test: "Build" and "read" are an agent and tool name in **free text**, which the lint rejects. That test would fail at `renderLine`, but `checkScene` does not run `renderLine` — it checks structure. Hmm: is that a problem? The checker assumes lines already passed the line check (assembleScript only emits survivors). So the checker takes lines as given and checks scene-level properties. But then a test line that would never survive rendering is misleading. Fix the test line to something lint-clean AND check-passing: `'It began.'` style. Let me rewrite: `line('l:2', 'narrator', 'It continued.', ['b:2'])`. "continued" — not banned. Good.

Also the time-order test uses 'Later, this.' / 'First, that.' — "Later"? Is "later" an order word in the lint? The banned classes: order or absence words (again, first, last, finally, still, never, always, only...). "Later" and "First" — "first" is explicitly banned ("first" appears in the it.each? No — the it.each list: 'It ran 3 times.', 'It ran twice.', 'It still has not run.', 'It never ran the tests.', 'It read the file again.', 'It only ran bash.', 'It wrote src/thing.ts.'. "First"/"Later" not tested but "first" is named in the spec's banned list ("an order or absence word (again, first, last, finally, still, never, always, only)"). So 'First, that.' would be REJECTED by the lint. But again — checkScene doesn't run renderLine. Still misleading. Reword to avoid banned words entirely: 'This next.' / 'That earlier.'? "next"... "earlier"... Hmm, are those banned? The spec lists examples, not exhaustive. Safest: 'One thing.' / 'Another thing.' — "Another"... "other" isn't in the list. Ugh. Let me use neutral words with no temporal meaning at all: 'Something happened.' / 'Something else happened.' — "else"? Not banned. OK: l:1 'Something happened.' cites b:2; l:2 'Something else happened.' cites b:1. Time-order violation without any lint interaction. And flashback test similarly.

Hmm wait, actually — should checkScene ALSO verify lines pass renderLine? No — separation: assembleScript emits only survivors; the checker checks composition. The Director (slice 3) must pass its lines through renderLine first, then checkScene. State that in the checker docs. Good — that's a real interface contract worth writing down: **the checker's input precondition is lines that passed `renderLine`; it does not re-lint.**

Let me rewrite those test lines now (in the plan, before dispatch):

- honest scene: 'It began.' / 'It continued.'
- time-order: 'Something happened.' (b:2) then 'Something else happened.' (b:1)
- flashback: same + flashback:true on second
- burying: 'All went well.' — "well"... fine, not banned. OK.
- speaker: 'It happened.' speaker explore. Fine.
- cite: 'It happened.' cites b:9. Fine.
- room: 'I was there.' speaker kid... "there"? fine.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/narrative/check.test.ts`
Expected: FAIL — cannot resolve `../../src/narrative/check`

- [ ] **Step 3: Implement**

`checkScene(scene, lines, ctx)` runs the five §5.2 checks in order, collecting failure strings, and returns `{ ok: failures.length === 0, failures }`:

1. **Speaker matches footage.** For each line with a `CastID` speaker (not `narrator`): every cited beat's session must map (via `ctx.agents`) to that speaker; every `{agent:}` slot... no — slots are line-level, already checked. Speaker check only: speaker's agent == agent of each cited beat's session. Unknown session agent → must be `unidentified` speaker. **Input precondition (document it): lines have passed `renderLine`. The checker does not re-lint.**
2. **One episode.** Every cite of every line ∈ `ctx.episodeBeatIDs`.
3. **Time order.** Each line's anchor = max `at` over its cited beats (via the beats map; a cite absent from the map fails the check rather than throwing). Anchors non-decreasing across lines, unless the line is `flashback: true`.
4. **No burying.** Every beat in `scene.beats` of kind `tool-fails`, `cut` or `knocks` appears in at least one line's `cites`. (The caller falls back to templates on failure; the checker only reports.)
5. **Story stays in the room.** Every line with a non-narrator speaker: that speaker ∈ `scene.cast`.

Pure; no I/O; deterministic.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/narrative/check.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(narrative): check scenes against the five §5.2 rules"
```

---

### Task 5: The page shows scenes and episodes

**Files:**
- Modify: `src/main.ts`, `index.html`
- Test: `tests/narrative/page.test.ts` — headless DOM assertions via the existing test setup; if the harness has no DOM, test the pure view-building helpers instead (see Step 3)

**Interfaces:**
- Consumes: `assembleScenes` (Task 2), `assembleEpisodes` (Task 3), `assembleScript` + `sceneHeadingFor` (slice 1), `checkScene` (Task 4)
- Produces: an episode view with scene headings; the floor panel unchanged

- [ ] **Step 1: Write the failing tests**

The page currently groups lines by location change. After this task it groups by assembled scene inside the current episode, with each scene under its heading. Test the pure part:

```ts
// tests/narrative/page.test.ts
import { describe, it, expect } from 'vitest'
import { groupLinesByScene } from '../../src/narrative/views'

describe('groupLinesByScene', () => {
  it('places each rendered line under its scene heading, keyed by beat id', () => {
    const out = groupLinesByScene(
      [{ id: 'scene:b:1', beats: ['b:1', 'b:2'] }],
      [{ line: { id: 'l:1', speaker: 'narrator', template: 't', cites: ['b:1'] }, text: 'One.', delivery: 'narration', beatIDs: ['b:1'] }],
    )
    expect(out[0].lines.map(l => l.text)).toEqual(['One.'])
  })

  it('drops nothing: a line whose beat belongs to no scene stays visible', () => {
    const out = groupLinesByScene(
      [{ id: 'scene:b:1', beats: ['b:1'] }],
      [{ line: { id: 'l:1', speaker: 'narrator', template: 't', cites: ['b:2'] }, text: 'Two.', delivery: 'narration', beatIDs: ['b:2'] }],
    )
    expect(out.flatMap(s => s.lines).map(l => l.text)).toEqual(['Two.'])
  })

  it('recomputes from the beat list rather than mutating: same input, same output, no shared references', () => {
    const scenes = [{ id: 'scene:b:1', beats: ['b:1'] }]
    const lines = [{ line: { id: 'l:1', speaker: 'narrator', template: 't', cites: ['b:1'] }, text: 'One.', delivery: 'narration', beatIDs: ['b:1'] }]
    const a = groupLinesByScene(scenes, lines)
    const b = groupLinesByScene(scenes, lines)
    expect(a).toEqual(b)
    expect(a[0]).not.toBe(b[0])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/narrative/page.test.ts`
Expected: FAIL — cannot resolve `../../src/narrative/views`

- [ ] **Step 3: Implement**

Create `src/narrative/views.ts` with `groupLinesByScene(scenes, scriptLines)`: returns per-scene `{ scene, lines }` in scene order; a line belongs to the scene containing its first cited beat; a line citing only beats in no scene is collected under an ungrouped tail that stays visible (Review Focus 5: nothing is ever dropped by regrouping). Pure, no DOM.

Then `src/main.ts`: after each new beat, recompute scenes from the full beat list (`assembleScenes`), episodes (`assembleEpisodes`), and render the current episode's scenes with headings via the existing `sceneHeadingFor` + `groupLinesByScene` — replacing the location-only grouping. Scenes are a pure view over the beat list, recomputed per beat (beat counts are in the hundreds; recompute is cheap) and keyed by scene id, so a re-cut cannot renarrate or drop a beat. Run `checkScene` per scene and mark failing scenes in the DOM (a `data-check="fail"` attribute, not a redesign). The floor panel, Replay path, settle, redraw loop and error handling stay exactly as they are.

- [ ] **Step 4: Run all tests**

Run: `bun run test`
Expected: PASS — every test in the project

- [ ] **Step 5: Verify by looking at it**

`bun run dev`, Replay the golden fixture. Scenes should appear under headings with the floor beside them. This step needs eyes, not assertions — note what was seen.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(narrative): render scenes under headings inside the episode view"
```

---

## What this plan deliberately does not do

- **No Director and no model calls.** The checker judges; nothing writes unchecked lines yet. §12 D6 governs the key, the caps and the degradation ladder when the Director arrives.
- **No series store.** `seriesID` is `''`, recaps and bibles need stored beats, and personas need the Director. Slice 3.
- **No plot labels.** Cold open / A / B / tag are computable but have no consumer until the Director titles them. Slice 3.
- **No reconnect.** The floor and the narrative both seed once; re-snapshot-on-reconnect (and the tombstone fix it requires) rides with the reconnect slice, not this one.

## Execution notes — Sol, 2026-10-13

All five tasks implemented directly by GPT-6.1 Sol after the interrupted DeepSeek
dispatches; independent whole-branch review follows. No Luna implementation ran.
Baseline: 220 tests and typecheck passing. Per-task suites: 237, 251, 258, 272,
280 tests passing; typecheck passed before every implementation commit. Build passed
with an existing Vite future native-config-loader warning about extensionless imports.

### Rulings (binding spec wins over the original examples)

1. `endAt` is required; every beat has a final contributing timestamp. Cost if wrong:
   mechanical updates for new producers/test fixtures.
2. Scenes carry `rootSessionID`, also documented in §6. Cost if wrong: re-derive
   parent walks during episode assembly.
3. `groupLinesByScene` accepts minimal `{id, beats}` scenes. Cost if wrong: a later
   consumer must supply additional scene fields explicitly.
4. Duration retains existing five-second rounding and “a moment” for sub-five-second
   gaps. The plan's nine-/zero-second assertions were wrong. Opener-sensitive tests
   spend the opener first and assert the actual subject beat. Cost if wrong: display
   wording only.
5. A scene is one desk and one root: changing either also cuts. Every root ask cuts,
   including immediately after a wrap. The original two-scene expectation for
   ask/use/wrap/ask should be three scenes. Cost if wrong: more cuts, no lost footage.
6. §12 D2 supersedes the draft ten-minute episode split: a root/chat always retains
   one episode. `assembleEpisodes(scenes)` needs no unused sessions/beats/time input;
   it does not pretend a wrap or stream flush closes a resumable chat. Cost if wrong:
   a future explicit lifecycle API, not a fabricated Part Two.
7. The ninety-second cut is inclusive and uses the closing beat's `endAt`; long runs
   cannot evade it. Shared `castByRoot`/`rootFor` scope suffixes to a chat, not unrelated
   sessions on the floor. Cost if wrong: earlier cuts or explicit timing adjustment.
8. Scene checks compare agent slots across all cites, not just character speakers:
   individual slot rendering cannot catch conflated actors. Room presence comes from
   scene footage, not just its cast array. `ctx.agents` holds resolved CastIDs (including
   suffixes). Flashbacks never lower the present-time watermark. Cost if wrong:
   stricter rejection/template fallback, never invented dialogue.
9. Keep every episode visible rather than hide older chats. The actual page uses the
   pure `assembleEpisodeViews` pipeline tested with golden footage. Backdated runs
   gain explicit flashback markers without reordering footage. Guest-desk headings
   cite child footage if available, otherwise a generic guest-desk line; never rename
   the caller as the guest. Cost if wrong: more visible context/edit markers.

### Actual browser evidence

The localhost dev page connected live, then replayed the scrubbed golden recording
(204 frames): replay done, 1 episode, 12 scenes, 44 lines, 0 failed scene checks,
5 flashbacks. Exit 3, reject and forty seconds appeared in the real page DOM.
Script/floor measured 613px/386px side by side; the canvas was drawn (7 sampled colors).
Screenshot capture was refused because the desktop window was hidden, even after
tabs.focus. This is not a pixel-by-eye check, and hover/focus citation visibility
remains unverified while that window is unfocused. No raw recording or credential was
committed, printed or submitted to a model.

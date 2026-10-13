# The narrative layer, slice 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a real OpenCode session into a readable script — beats rolled from the event stream, each narrated line cited to the beats it describes — beside the floor.

**Architecture:** A pure `rollup` reduces SSE frames to beats, exactly as `applyFrame` reduces them to desk state: no model, no clock, no I/O, all timing from frames' own `created`, so a recording replays to an identical beat list. A second pure layer renders each beat to a **template line** whose checkable claims are filled from typed slots, and every line carries the beat ids it cites. The page shows the script as the primary column with the floor as a panel beside it.

**Tech Stack:** TypeScript, Vite, vitest, bun. No framework, no new dependency.

**Spec:** `docs/superpowers/specs/2026-10-12-narrative-layer-design.md` — read §4.1 (the rollup's rules, all of them), §5.1 (templates and the slot vocabulary), §6 (the data model) and §12 (the settled decisions).

## Global Constraints

- **OpenCode is never modified.** This is a client. No patches, no forks, no plugins.
- **Nothing in the narrative invents work.** Every string a renderer shows is a `Line` with at least one cited beat. Beats cite their own event ids. A line no slot can fill is **dropped, never repaired**.
- **The rollup is pure.** No model, no clock, no I/O, no `Date.now()`, no timers. All time comes from a frame's `created`. A replay of the same fixture must produce a byte-identical beat list.
- No `Buffer`, `process`, `require`, `__dirname` or `node:` imports in `src/`. `node:` in `tests/` is expected.
- **Recordings are sensitive** — prompts, paths, command output. `fixtures/raw/` is git-ignored; a committed fixture is **scrubbed** first. The service password is never committed, logged or printed.
- No file over ~400 lines. No mock state in a shipped path. MIT-compatible deps only; no new dependency.
- **`bun run test` and `bun run typecheck` must both pass before every commit.** Non-negotiable in this repo; it has already caught a merge bug that 127 tests missed.

## Review Focus

Inputs and failure modes §4.1 implies but its table does not spell out, most likely to bite first. Each is pinned to a test in the task that owns the code.

1. **A reconnect replays frames we have already seen.** A duplicate that slips through double-counts every delta and every call in the episode. → Task 1.
2. **We join a session mid-run.** No `reasoning.started`, no `tool.input.started`, no `session.created` — so a beat must be raisable from a `.delta` or from a nameless success, and a root must still be known. → Task 1, Task 2.
3. **The stream ends mid-run.** An open `thinks`, an unfinished call, a session that never wrapped. → Task 3.
4. **A `subagent` call success must be `guest-leaves`, not `uses-tool`** — never both, and a returning guest leaves twice while arriving once. → Task 2.
5. **Two sessions running the same agent in one episode** need distinct cast ids, and an unknown agent needs `unidentified` rather than a guess. → Task 5.

---

### Task 1: The rollup — state, dedupe, seeding, and the beats that need no history

**Files:**
- Create: `src/narrative/rollup.ts`
- Create: `src/narrative/types.ts`
- Test: `tests/narrative/rollup.test.ts`

**Interfaces:**
- Produces: `BeatKind`, `BeatDetail`, `Beat`, `SessionInfo`, `OpenRun`, `RollupState`, and
  `createRollup()`, `seedRollup(state, snapshot)`, `rollup(state, frame): { state, beats }`, `flush(state): Beat[]`
- Consumes: `Frame` from `src/api/sse.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/narrative/rollup.test.ts
import { describe, it, expect } from 'vitest'
import { createRollup, seedRollup, rollup, flush } from '../../src/narrative/rollup'
import type { Frame } from '../../src/api/sse'

const f = (type: string, data: unknown = {}, extra: Partial<Frame> = {}): Frame =>
  ({ type, data, ...extra })

const run = (frames: Frame[]) => frames.reduce((acc, fr) => {
  const r = rollup(acc, fr)
  acc = r.state
  return acc
}, createRollup())

describe('dedupe — a reconnect replays frames we have already seen', () => {
  it('drops a frame whose id has been seen', () => {
    const s = createRollup()
    const a = rollup(s, f('session.created', { sessionID: 's1' }, { id: 'e1' }))
    const b = rollup(a.state, f('session.created', { sessionID: 's1' }, { id: 'e1' }))
    expect(b.beats).toEqual([])
  })

  it('does not double-count deltas when a run is replayed', () => {
    const frames = [
      f('execution.started', { sessionID: 's1' }, { id: 'a' }),
      f('reasoning.started', { sessionID: 's1' }, { id: 'b' }),
      f('reasoning.delta', { sessionID: 's1' }, { id: 'c' }),
      f('reasoning.ended', { sessionID: 's1' }, { id: 'd' }),
      f('reasoning.started', { sessionID: 's1' }, { id: 'b' }),
      f('reasoning.delta', { sessionID: 's1' }, { id: 'c' }),
    ]
    let s = createRollup()
    const emitted: string[] = []
    for (const fr of frames) { const r = rollup(s, fr); s = r.state; emitted.push(...r.beats.map(x => x.id)) }
    expect(emitted).toEqual(['b:d'])
    expect(flush(s)).toEqual([])
  })

  it('knows a session is a root from session.created without a parent', () => {
    let s = createRollup()
    const created = rollup(s, f('session.created', { sessionID: 'r' }, { id: 'a' }))
    const asked = rollup(created.state, f('inbox.enqueued', { sessionID: 'r', item: { type: 'user' } }, { id: 'b' }))
    expect(asked.beats.map(x => x.kind)).toEqual(['human-asks'])
  })

  it('produces no beat for any of the frame types §4.1 absorbs', () => {
    const absorbed = [
      'tool.input.delta', 'tool.input.ended', 'tool.called', 'tool.progress',
      'reasoning.delta', 'text.delta', 'step.started', 'step.ended', 'step.streamed',
      'usage.updated', 'shell.created', 'shell.exited', 'shell.deleted',
      'inbox.delivered', 'execution.started', 'instructions.updated', 'project.updated',
      'provider.updated', 'model.updated', 'server.connected',
    ]
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    for (const type of absorbed) {
      expect(rollup(s, f(type, { sessionID: 'x' }, { id: `evt-${type}` })).beats).toEqual([])
    }
  })
})

describe('seeding — joining a session mid-stream still gives it a root, a parent and a cast', () => {
  it('knows a session that was created before we connected', () => {
    const s = seedRollup(createRollup(), {
      sessions: [{ id: 'root', agent: 'plan' }, { id: 'child', parentID: 'root', agent: 'build' }],
      permissions: [],
    })
    const r = rollup(s, f('text.started', { sessionID: 'child' }))
    expect(r.beats[0].sessionID).toBe('child')
  })

  it('raises episode-opens for a root session we joined, not one per frame', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'root' }], permissions: [] })
    const a = rollup(s, f('execution.started', { sessionID: 'root' }))
    const b = rollup(a.state, f('text.started', { sessionID: 'root' }))
    expect(a.beats.concat(b.beats).filter(x => x.kind === 'episode-opens')).toHaveLength(1)
  })
})

describe('the beats that need no history', () => {
  it('human-asks on a root session inbox, briefing on a child', () => {
    const s = seedRollup(createRollup(), {
      sessions: [{ id: 'root' }, { id: 'child', parentID: 'root' }], permissions: [],
    })
    const a = rollup(s, f('inbox.enqueued', { sessionID: 'root', item: { type: 'user' } }))
    const b = rollup(a.state, f('inbox.enqueued', { sessionID: 'child', item: { type: 'user' } }))
    expect(a.beats.map(x => x.kind)).toEqual(['human-asks'])
    expect(b.beats.map(x => x.kind)).toEqual(['briefing'])
  })

  it('ignores an inbox item that is not the user speaking', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'root' }], permissions: [] })
    const r = rollup(s, f('inbox.enqueued', { sessionID: 'root', item: { type: 'synthetic' } }))
    expect(r.beats).toEqual([])
  })

  it('knocks and answered, carrying the request id and the reply', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const a = rollup(s, f('permission.asked', { sessionID: 'x', id: 'p1' }))
    const b = rollup(a.state, f('permission.replied', { sessionID: 'x', requestID: 'p1', reply: 'once' }))
    expect(a.beats[0].kind).toBe('knocks')
    expect(a.beats[0].detail).toEqual({ kind: 'knocks', requestID: 'p1' })
    expect(b.beats[0].detail).toEqual({ kind: 'answered', reply: 'once' })
  })

  it('retry carries the attempt, memory-wipe opens and closes, wrap and cut end', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const seq = [
      f('retry.scheduled', { sessionID: 'x', attempt: 2 }),
      f('compaction.started', { sessionID: 'x' }),
      f('compaction.ended', { sessionID: 'x' }),
      f('execution.succeeded', { sessionID: 'x' }),
      f('execution.failed', { sessionID: 'x', reason: 'boom' }),
    ]
    const kinds: string[] = []
    let st = s
    for (const fr of seq) { const r = rollup(st, fr); st = r.state; kinds.push(...r.beats.map(b => b.kind)) }
    expect(kinds).toEqual(['retry', 'memory-wipe', 'wrap', 'cut'])
  })

  it('treats a shutdown interruption as a cut, not a failure', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const r = rollup(s, f('execution.interrupted', { sessionID: 'x', reason: 'shutdown' }))
    expect(r.beats.map(b => b.kind)).toEqual(['cut'])
  })

  it('ignores an unknown frame type', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    expect(rollup(s, f('some.future.event', { sessionID: 'x' })).beats).toEqual([])
  })
})

describe('beat identity', () => {
  it('derives the id from the first event id, so a re-run is identical', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const a = rollup(s, f('permission.asked', { sessionID: 'x', id: 'p1' }, { id: 'evt1' }))
    const b = rollup(seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] }),
      f('permission.asked', { sessionID: 'x', id: 'p1' }, { id: 'evt1' }))
    expect(a.beats[0].id).toBe('b:evt1')
    expect(a.beats[0].id).toBe(b.beats[0].id)
  })

  it('records every event id of the beat', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const r = rollup(s, f('permission.asked', { sessionID: 'x', id: 'p1' }, { id: 'evt1', created: 1000 }))
    expect(r.beats[0].eventIDs).toEqual(['evt1'])
    expect(r.beats[0].at).toBe(1000)
  })
})

describe('no clock', () => {
  it('uses only the frame created value for time', () => {
    const s = seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
    const r = rollup(s, f('permission.asked', { sessionID: 'x', id: 'p1' }, { created: 42 }))
    expect(r.beats[0].at).toBe(42)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/narrative/rollup.test.ts`
Expected: FAIL — cannot resolve `../../src/narrative/rollup`

- [ ] **Step 3: Implement**

`src/narrative/types.ts` holds `BeatKind` (the sixteen kinds in §4.1), `BeatDetail` (the union in §6), `Beat` (`{ id, at, eventIDs, kind, sessionID, detail }`), `SessionInfo`, `OpenRun`, and `RollupState` (`{ seenIDs, sessions, open, roots, pending }`).

`rollup` returns `{ state, beats }`. Every beat's id is `` `b:${firstEventId}` ``; a frame with no `id` cannot start a beat and is only ever joined to one — note that in a comment, because it is the one rule that makes beats reproducible.

Dedupe on `frame.id` **before** anything else and before recording it as seen. `memory-wipe` closes on `compaction.ended` **without emitting a beat** — it is one beat, not two. `execution.interrupted` with `reason === 'shutdown'` raises `cut` with that reason, matching `src/state/desk.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/narrative/rollup.test.ts`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(narrative): roll SSE frames into beats, deduped and seeded"
```

---

### Task 2: Run beats and call beats — the joins

**Files:**
- Modify: `src/narrative/rollup.ts`
- Test: `tests/narrative/rollup-runs.test.ts`

**Interfaces:**
- Consumes: everything from Task 1
- Produces: no new exports; `rollup` raises `thinks`, `says`, `uses-tool`, `tool-fails`, `guest-arrives`, `guest-leaves`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/narrative/rollup-runs.test.ts
import { describe, it, expect } from 'vitest'
import { createRollup, seedRollup, rollup, flush } from '../../src/narrative/rollup'
import type { Frame } from '../../src/api/sse'

const seeded = (sessions: { id: string; parentID?: string }[] = [{ id: 'x' }]) =>
  seedRollup(createRollup(), { sessions, permissions: [] })
const f = (type: string, data: unknown = {}, extra: Partial<Frame> = {}): Frame => ({ type, data, ...extra })
const drive = (st: any, frames: Frame[]) => {
  const beats: any[] = []
  for (const fr of frames) { const r = rollup(st, fr); st = r.state; beats.push(...r.beats) }
  return { state: st, beats }
}

describe('thinks and says are runs', () => {
  it('raises on the first delta when we joined mid-run — no started frame', () => {
    const { beats } = drive(seeded(), [f('reasoning.delta', { sessionID: 'x' }, { id: 'd1' })])
    expect(beats.map(b => b.kind)).toEqual(['thinks'])
  })

  it('carries the delta count on close, and zero when there were none', () => {
    const { beats } = drive(seeded(), [
      f('reasoning.started', { sessionID: 'x' }, { id: 'a' }),
      f('reasoning.delta', { sessionID: 'x' }, { id: 'b' }),
      f('reasoning.delta', { sessionID: 'x' }, { id: 'c' }),
      f('reasoning.ended', { sessionID: 'x' }, { id: 'd' }),
    ])
    expect(beats).toHaveLength(1)
    expect(beats[0].detail).toEqual({ kind: 'thinks', deltas: 2, endedEventID: 'd' })
    expect(beats[0].eventIDs).toEqual(['a', 'b', 'c', 'd'])
  })

  it('gives a says beat its own delta count and ending frame', () => {
    const { beats } = drive(seeded(), [
      f('text.started', { sessionID: 'x' }, { id: 'a' }),
      f('text.delta', { sessionID: 'x' }, { id: 'b' }),
      f('text.ended', { sessionID: 'x' }, { id: 'c' }),
    ])
    expect(beats[0].kind).toBe('says')
    expect(beats[0].detail).toEqual({ kind: 'says', deltas: 1, endedEventID: 'c' })
  })

  it('closes an open run at stream end rather than losing it', () => {
    const { state, beats } = drive(seeded(), [
      f('text.started', { sessionID: 'x' }, { id: 'a' }),
      f('text.delta', { sessionID: 'x' }, { id: 'b' }),
    ])
    expect(beats).toEqual([])
    const closed = flush(state)
    expect(closed.map(b => b.kind)).toEqual(['says'])
    expect(closed[0].detail).toEqual({ kind: 'says', deltas: 1 })
  })
})

describe('calls join by id', () => {
  it('joins input.started, called and progress into one uses-tool beat', () => {
    const { beats } = drive(seeded(), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'read' }, { id: 'a' }),
      f('tool.called', { sessionID: 'x', id: 'c1' }, { id: 'b' }),
      f('tool.success', { sessionID: 'x', id: 'c1' }, { id: 'c' }),
    ])
    expect(beats).toHaveLength(1)
    expect(beats[0].kind).toBe('uses-tool')
    expect(beats[0].detail).toEqual({ kind: 'uses-tool', tool: 'read', callID: 'c1' })
    expect(beats[0].eventIDs).toEqual(['a', 'b', 'c'])
  })

  it('names the tool unknown when we joined mid-call', () => {
    const { beats } = drive(seeded(), [f('tool.success', { sessionID: 'x', id: 'c1' }, { id: 'c' })])
    expect(beats[0].detail).toEqual({ kind: 'uses-tool', tool: 'unknown', callID: 'c1' })
  })

  it('raises tool-fails immediately', () => {
    const { beats } = drive(seeded(), [f('tool.failed', { sessionID: 'x', id: 'c1', name: 'write' }, { id: 'z' })])
    expect(beats[0].kind).toBe('tool-fails')
    expect(beats[0].detail).toEqual({ kind: 'tool-fails', tool: 'write', callID: 'c1' })
  })

  it('joins a shell exit code onto the call', () => {
    const { beats } = drive(seeded(), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'bash' }, { id: 'a' }),
      f('tool.progress', { sessionID: 'x', id: 'c1', metadata: { shellID: 'sh1' } }, { id: 'b' }),
      f('shell.exited', { sessionID: 'x', id: 'sh1', exit: 2 }, { id: 'c' }),
      f('tool.success', { sessionID: 'x', id: 'c1' }, { id: 'd' }),
    ])
    expect(beats[0].detail).toMatchObject({ tool: 'bash', exit: 2 })
    expect(beats[0].eventIDs).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('a subagent call is a guest, never a tool use', () => {
  it('raises guest-leaves instead of uses-tool for a subagent success', () => {
    const { beats } = drive(seeded([{ id: 'x' }, { id: 'kid', parentID: 'x' }]), [
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'subagent' }, { id: 'a' }),
      f('tool.success', { sessionID: 'x', id: 'c1', metadata: { sessionID: 'kid' } }, { id: 'b' }),
    ])
    expect(beats.map(b => b.kind)).toEqual(['guest-leaves'])
    expect(beats[0].detail).toEqual({ kind: 'guest-leaves', childSessionID: 'kid', callID: 'c1' })
  })

  it('matches a guest to its call only by the call id or the success metadata, never by an open call', () => {
    const { beats } = drive(seeded([{ id: 'x' }, { id: 'kid', parentID: 'x' }]), [
      f('session.created', { sessionID: 'kid', parentID: 'x' }, { id: 'a' }),
      f('tool.input.started', { sessionID: 'x', id: 'c9', name: 'other' }, { id: 'b' }),
    ])
    expect(beats.map(b => b.kind)).toEqual(['guest-arrives'])
    expect(beats[0].detail).toEqual({ kind: 'guest-arrives', childSessionID: 'kid' })
  })

  it('lets a returning guest leave twice and arrive once', () => {
    const { beats } = drive(seeded([{ id: 'x' }, { id: 'kid', parentID: 'x' }]), [
      f('session.created', { sessionID: 'kid', parentID: 'x' }, { id: 'a' }),
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'subagent' }, { id: 'b' }),
      f('tool.success', { sessionID: 'x', id: 'c1', metadata: { sessionID: 'kid' } }, { id: 'c' }),
      f('tool.input.started', { sessionID: 'x', id: 'c2', name: 'subagent' }, { id: 'd' }),
      f('tool.success', { sessionID: 'x', id: 'c2', metadata: { sessionID: 'kid' } }, { id: 'e' }),
    ])
    const kinds = beats.map(b => b.kind)
    expect(kinds.filter(k => k === 'guest-arrives')).toHaveLength(1)
    expect(kinds.filter(k => k === 'guest-leaves')).toHaveLength(2)
    expect(kinds).not.toContain('uses-tool')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/narrative/rollup-runs.test.ts`
Expected: FAIL — no `thinks`/`says`/`uses-tool` beats are produced yet

- [ ] **Step 3: Implement**

A run opens on `X.started` **or** on the first `X.delta` when no run is open (`X` ∈ `reasoning`/`text`), and closes on `X.ended`; `flush` closes an open run with the events it has. Count only deltas.

Calls: key by the call's `id`. `input.started` carries `name`; `called` and `progress` join an existing call and must **not** create one if the name was never seen (that is the "joined mid-call" case → `tool: 'unknown'`). A `shell.exited` joins via the `progress` metadata's `shellID`, so remember that mapping.

`subagent` is special: its **success** raises `guest-leaves` keyed on `metadata.sessionID`, and it never raises `uses-tool`. `session.created` with `parentID` raises `guest-arrives`, linked to a call only by the call id or the success metadata.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/narrative/rollup-runs.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(narrative): raise run and call beats, joined by ids"
```

---

### Task 3: Silence and flush

**Files:**
- Modify: `src/narrative/rollup.ts`
- Test: `tests/narrative/rollup-silence.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2
- Produces: `silence` beats; `flush` closes runs and drops an unfinished call without a beat

- [ ] **Step 1: Write the failing tests**

```ts
// tests/narrative/rollup-silence.test.ts
import { describe, it, expect } from 'vitest'
import { createRollup, seedRollup, rollup, flush } from '../../src/narrative/rollup'
import type { Frame } from '../../src/api/sse'

const seeded = () => seedRollup(createRollup(), { sessions: [{ id: 'x' }], permissions: [] })
const f = (type: string, data: unknown = {}, extra: Partial<Frame> = {}): Frame => ({ type, data, ...extra })
const drive = (frames: Frame[]) => {
  let st = seeded(); const beats: any[] = []
  for (const fr of frames) { const r = rollup(st, fr); st = r.state; beats.push(...r.beats) }
  return { state: st, beats }
}

describe('silence', () => {
  it('raises once a working session has been quiet for 30s, citing both bounding frames', () => {
    const { beats } = drive([
      f('execution.started', { sessionID: 'x' }, { id: 'a', created: 0 }),
      f('text.started', { sessionID: 'x' }, { id: 'b', created: 1000 }),
      f('text.delta', { sessionID: 'x' }, { id: 'c', created: 2000 }),
      f('text.ended', { sessionID: 'x' }, { id: 'd', created: 3000 }),
      f('text.started', { sessionID: 'x' }, { id: 'e', created: 40000 }),
    ])
    const silence = beats.find(b => b.kind === 'silence')
    expect(silence).toBeDefined()
    expect(silence!.detail).toEqual({ kind: 'silence', fromEventID: 'd', toEventID: 'e' })
  })

  it('does not raise for a gap under 30s', () => {
    const { beats } = drive([
      f('execution.started', { sessionID: 'x' }, { id: 'a', created: 0 }),
      f('text.started', { sessionID: 'x' }, { id: 'b', created: 1000 }),
      f('text.ended', { sessionID: 'x' }, { id: 'c', created: 2000 }),
      f('text.started', { sessionID: 'x' }, { id: 'd', created: 20000 }),
    ])
    expect(beats.some(b => b.kind === 'silence')).toBe(false)
  })

  it('does not raise for a session waiting on the audience', () => {
    const { beats } = drive([
      f('execution.started', { sessionID: 'x' }, { id: 'a', created: 0 }),
      f('permission.asked', { sessionID: 'x', id: 'p1' }, { id: 'b', created: 1000 }),
      f('text.started', { sessionID: 'x' }, { id: 'c', created: 90000 }),
    ])
    expect(beats.some(b => b.kind === 'silence')).toBe(false)
  })

  it('does not raise for a session whose open request came from the seed, not from a frame we saw', () => {
    const seededWaiting = seedRollup(createRollup(), {
      sessions: [{ id: 'x' }], permissions: [{ requestID: 'p1', sessionID: 'x' }],
    })
    const r = rollup(seededWaiting, f('text.started', { sessionID: 'x' }, { id: 'c', created: 90000 }))
    expect(r.beats.some(x => x.kind === 'silence')).toBe(false)
  })

  it('is ended only by that session’s own next frame', () => {
    const { beats } = drive([
      f('execution.started', { sessionID: 'x' }, { id: 'a', created: 0 }),
      f('text.started', { sessionID: 'x' }, { id: 'b', created: 1000 }),
      f('text.ended', { sessionID: 'x' }, { id: 'c', created: 2000 }),
      f('execution.started', { sessionID: 'y' }, { id: 'z', created: 50000 }),
      f('text.started', { sessionID: 'x' }, { id: 'd', created: 60000 }),
    ])
    const silence = beats.find(b => b.kind === 'silence')
    expect(silence!.detail).toEqual({ kind: 'silence', fromEventID: 'c', toEventID: 'd' })
  })
})

describe('flush', () => {
  it('produces no beat for a call that never succeeded', () => {
    const { state } = drive([
      f('tool.input.started', { sessionID: 'x', id: 'c1', name: 'read' }, { id: 'a' }),
      f('tool.called', { sessionID: 'x', id: 'c1' }, { id: 'b' }),
    ])
    expect(flush(state).filter(b => b.kind === 'uses-tool' || b.kind === 'tool-fails')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/narrative/rollup-silence.test.ts`
Expected: FAIL — no `silence` beats are produced

- [ ] **Step 3: Implement**

Track each session's last frame time and whether it is **working** — after `execution.started` (or its first frame, if we joined), before its `wrap`/`cut`, with no unanswered `knocks` and no open `subagent` call. On each frame, if the same session is working and `created - lastAt >= 30_000`, emit `silence` citing the two bounds **before** processing the frame. No timers: a silence is narrated once it ends, which is the only way replay stays identical.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/narrative/rollup-silence.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(narrative): narrate silences and close runs at flush"
```

---

### Task 4: Re-record, and settle whether a failure is ever a success

**Files:**
- Create: `fixtures/narrative/<name>.jsonl` (scrubbed)
- Modify: `docs/superpowers/specs/2026-10-12-narrative-layer-design.md` — §4.1's provisional note only
- Test: `tests/narrative/golden.test.ts`

**Interfaces:**
- Consumes: `readFrames` from `src/replay/replay.ts`
- Produces: a committed, scrubbed fixture; a golden assertion on its beat list

- [ ] **Step 1: Record it — this task is manual, and it is the one that must not be guessed at**

With `opencode serve` running, `bun run src/cli/connect.ts`, then in the OpenCode desktop app deliberately produce, in one chat: **a shell command that exits non-zero**, **a permission you deny**, **a gap of at least 30 seconds** with the session otherwise working, and **a resumed chat**. Stop the recorder.

Copy the raw `.jsonl` to `fixtures/narrative/<name>.jsonl` and **scrub it before committing**: no real paths, no prompts, no filenames. Commit only the scrubbed file; the raw one stays in `fixtures/raw/`.

- [ ] **Step 2: Answer §4.1's open question from the recording**

§4.1 says `tool-fails` probably misses real failures because a non-zero exit may arrive as a `tool.success`. **Read the recorded frames for the failing command and decide from the evidence**, not from intuition: if a non-zero exit arrives only as `tool.success`, amend §4.1 to say that `tool-fails` is raised by `tool.failed` **and** by a `tool.success` whose joined shell exit is non-zero — and add the test for it here. If it arrives as `tool.failed`, amend §4.1 to record that the rule as written is correct, and remove the provisional note. Either way, the spec text changes; that is the deliverable of this step.

- [ ] **Step 3: Write the golden test**

```ts
// tests/narrative/golden.test.ts
import { describe, it, expect } from 'vitest'
import { readFrames } from '../../src/replay/replay'
import { createRollup, seedRollup, rollup, flush } from '../../src/narrative/rollup'

describe('a real recording rolls to a stable beat list', () => {
  it('produces the same beats on a second pass', () => {
    const runs = [0, 1].map(() => {
      const beats: any[] = []
      let st = seedRollup(createRollup(), { sessions: [], permissions: [] })
      for (const fr of readFrames('fixtures/narrative/<name>.jsonl')) {
        const r = rollup(st, fr); st = r.state; beats.push(...r.beats)
      }
      return beats.concat(flush(st))
    })
    expect(JSON.stringify(runs[1])).toEqual(JSON.stringify(runs[0]))
  })

  it('finds the four events the fixture was recorded for', () => {
    const beats: any[] = []
    let st = seedRollup(createRollup(), { sessions: [], permissions: [] })
    for (const fr of readFrames('fixtures/narrative/<name>.jsonl')) {
      const r = rollup(st, fr); st = r.state; beats.push(...r.beats)
    }
    const kinds = beats.concat(flush(st)).map(b => b.kind)
    expect(kinds).toContain('tool-fails')
    expect(kinds).toContain('answered')
    expect(kinds).toContain('silence')
  })
})
```

- [ ] **Step 4: Run it**

Run: `bun run test tests/narrative/golden.test.ts`
Expected: PASS. If the third assertion fails, the fixture is missing one of the four deliberate events — re-record rather than weakening the assertion.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(narrative): a real recording as the golden fixture, and settle tool-fails"
```

---

### Task 5: Beats to lines — templates with typed slots

**Files:**
- Create: `src/narrative/line.ts`
- Create: `src/narrative/templates.ts`
- Create: `src/narrative/cast.ts`
- Test: `tests/narrative/line.test.ts`, `tests/narrative/cast.test.ts`

**Interfaces:**
- Consumes: `Beat` (Task 1)
- Produces: `type Line = { id: string; speaker: 'narrator' | CastID; template: string; cites: string[]; flashback?: true }`; `type Rendered = { text: string; delivery: 'narration' | 'real-speech' | 'dramatised' }`; `renderLine(line, beats, ctx): Rendered | { rejected: string }`; `templateFor(beat, ctx): Line`; `castFor(sessions): (sessionID: string) => CastID`
- Note: `ctx` supplies `cast` and the episode's beat order, and nothing else. **`delivery` is required, not decorative** — §5.1 says the viewer must always be able to tell the worker's real words from words written for the scene, and the Director must not be able to label a line real.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/narrative/cast.test.ts
import { describe, it, expect } from 'vitest'
import { castFor } from '../../src/narrative/cast'

describe('castFor', () => {
  it('names a session after its agent', () => {
    expect(castFor([{ id: 's1', agent: 'plan' }])('s1')).toBe('plan')
  })

  it('suffixes a second session running the same agent in one episode', () => {
    const cast = castFor([{ id: 's1', agent: 'plan' }, { id: 's2', agent: 'plan' }])
    expect(cast('s1')).toBe('plan')
    expect(cast('s2')).toBe('plan·2')
  })

  it('says unidentified rather than guessing', () => {
    expect(castFor([{ id: 's1' }])('s1')).toBe('unidentified')
    expect(castFor([])('gone')).toBe('unidentified')
  })
})
```

```ts
// tests/narrative/line.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { renderLine, type Line, type Rendered } from '../../src/narrative/line'
import type { Beat } from '../../src/narrative/types'

const beats = new Map<string, Beat>()
const b = (id: string, kind: any, detail: any, at = 0, sessionID = 'x'): Beat =>
  ({ id, at, eventIDs: [id.slice(2)], kind, sessionID, detail })

beforeEach(() => {
  beats.clear()
  beats.set('b:1', b('b:1', 'uses-tool', { kind: 'uses-tool', tool: 'read', callID: 'c1', path: 'src/a.ts' }, 0))
  beats.set('b:2', b('b:2', 'uses-tool', { kind: 'uses-tool', tool: 'read', callID: 'c2' }, 1000))
  beats.set('b:3', b('b:3', 'thinks', { kind: 'thinks', deltas: 317 }, 2000))
  beats.set('b:4', b('b:4', 'tool-fails', { kind: 'tool-fails', tool: 'bash', callID: 'c3', exit: 2 }, 3000))
})
const ctx = { cast: () => 'build', beats: [...beats.values()] }
const line = (template: string, cites: string[]): Line => ({ id: 'l1', speaker: 'narrator', template, cites })

describe('slots render from their cites, and only from them', () => {
  it('fills tool, path, count and outcome', () => {
    expect(renderLine(line('{agent:b:1} runs {tool:b:1} on {path:b:1}.', ['b:1']), beats, ctx))
      .toEqual({ text: 'build runs read on src/a.ts.', delivery: 'narration' })
    expect(renderLine(line('{count:uses-tool,b:1..b:2} reads.', ['b:1', 'b:2']), beats, ctx))
      .toEqual({ text: '2 reads.', delivery: 'narration' })
    expect(renderLine(line('that {outcome:b:4}.', ['b:4']), beats, ctx))
      .toEqual({ text: 'that exit 2.', delivery: 'narration' })
  })

  it('rejects a slot whose cite cannot prove it', () => {
    const r = renderLine(line('{tool:b:3} failed.', ['b:3']), beats, ctx)
    expect(r).toHaveProperty('rejected')
  })

  it('rejects a slot citing a beat its own line does not cite', () => {
    const r = renderLine(line('{tool:b:1} twice.', ['b:2']), beats, ctx)
    expect(r).toHaveProperty('rejected')
  })

  it('rejects a line with no cites', () => {
    expect(renderLine(line('Nothing happened.', []), beats, ctx)).toHaveProperty('rejected')
  })
})

describe('delivery — the viewer can always tell real words from written ones', () => {
  const as = (speaker: Line['speaker'], template: string): Line =>
    ({ id: 'l', speaker, template, cites: ['b:3'] })

  it('marks a template that is exactly one quote slot as real speech', () => {
    expect((renderLine(as('build', '{quote:b:3}'), beats, ctx) as Rendered).delivery).toBe('real-speech')
  })

  it('marks anything else a character says as dramatised', () => {
    expect((renderLine(as('build', 'Well. That happened.'), beats, ctx) as Rendered).delivery).toBe('dramatised')
  })

  it('marks the narrator as narration', () => {
    expect((renderLine(line('It could have let the dot go.', ['b:1']), beats, ctx) as Rendered).delivery).toBe('narration')
  })

  it('never lets a quote slot pass for real speech when it is embedded in a longer line', () => {
    expect((renderLine(as('build', 'It said {quote:b:3} and left.'), beats, ctx) as Rendered).delivery).toBe('dramatised')
  })
})

describe('free text is linted, not trusted', () => {
  it.each([
    'It ran 3 times.',
    'It ran twice.',
    'It still has not run.',
    'It never ran the tests.',
    'It read the file again.',
    'It only ran bash.',
    'It wrote src/thing.ts.',
  ])('rejects %s', (template) => {
    expect(renderLine(line(template, ['b:1']), beats, ctx)).toHaveProperty('rejected')
  })

  it('accepts story text that asserts no work', () => {
    const r = renderLine(line('It could have let the dot go. Instead, it gave the dot a name.', ['b:1']), beats, ctx)
    expect(r).toHaveProperty('text')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/narrative/line.test.ts`
Expected: FAIL — cannot resolve `../../src/narrative/line`

- [ ] **Step 3: Implement**

Implement the slot vocabulary in §5.1's table exactly as written — each slot names the beats it reads and the checker resolves it **from those beats' own events**, rejecting the line if it cannot. `renderLine` returns `{ text }` or `{ rejected }`; it never throws and never repairs.

Then the free-text lint: reject a template containing a digit, a number word, an order or absence word, a known tool/agent/model name or its verb form, or anything path-shaped. **Absence is the trap** — "it never ran" is a claim about every event in the episode and is banned unless `{never:…}` proves it.

`templates.ts` holds `templateFor(beat, ctx)`: one function per beat kind, returning a `Line` in the owner's settled voice — **deadpan, darkly comic, nothing off limits about how bleak the framing is, never about whether the events happened** (§12 D1). Every template cites at least its own beat.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test tests/narrative/line.test.ts tests/narrative/cast.test.ts`
Expected: PASS, 18 tests

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(narrative): template lines with typed slots, delivery marks and cast ids"
```

---

### Task 6: The script surface

**Files:**
- Create: `src/narrative/script.ts`
- Modify: `index.html`, `src/main.ts`
- Test: `tests/narrative/script.test.ts`

**Interfaces:**
- Consumes: `rollup` (Tasks 1–3), `templateFor`/`renderLine` (Task 5), `Frame`, `castFor`
- Produces: `assembleScript(beats, ctx, templateFor = defaultTemplateFor): ScriptLine[]` where `ScriptLine = { line: Line; text: string; delivery: Rendered['delivery']; beatIDs: string[] }`, dropping rejected lines; and page wiring that renders the script as the primary column. `templateFor` is a parameter rather than an import so a test can inject a template without a model or a fixture.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/narrative/script.test.ts
import { describe, it, expect } from 'vitest'
import { assembleScript } from '../../src/narrative/script'
import type { Beat } from '../../src/narrative/types'

const b = (id: string, kind: any, detail: any, at = 0, sessionID = 'x'): Beat =>
  ({ id, at, eventIDs: [id.slice(2)], kind, sessionID, detail })
const ctx = { cast: () => 'build', beats: [] as Beat[] }

describe('assembleScript', () => {
  it('emits one readable line per beat, in order, each citing that beat', () => {
    const beats = [
      b('b:1', 'human-asks', { kind: 'human-asks' }, 0),
      b('b:2', 'uses-tool', { kind: 'uses-tool', tool: 'read', callID: 'c1' }, 1000),
    ]
    const out = assembleScript(beats, ctx)
    expect(out.map(l => l.beatIDs)).toEqual([['b:1'], ['b:2']])
    expect(out.every(l => l.text.length > 0)).toBe(true)
  })

  it('drops a rejected line, so no beat is narrated by something untrue', () => {
    const beats = [b('b:1', 'says', { kind: 'says', deltas: 0 })]
    const out = assembleScript(beats, ctx, () => ({ id: 'l', speaker: 'narrator', template: 'It ran 3 times.', cites: ['b:1'] }))
    expect(out).toEqual([])
  })

  it('carries the beat ids through so a reader can trace a line back to its events', () => {
    const beats = [b('b:1', 'knocks', { kind: 'knocks', requestID: 'p1' }, 5000)]
    const [only] = assembleScript(beats, ctx)
    expect(only.beatIDs).toEqual(['b:1'])
  })

  it('carries delivery through, so the page can render real speech differently', () => {
    const beats = [b('b:1', 'knocks', { kind: 'knocks', requestID: 'p1' }, 0)]
    const [only] = assembleScript(beats, ctx, () => ({ id: 'l', speaker: 'build', template: '{quote:b:1}', cites: ['b:1'] }))
    expect(only.delivery).toBe('real-speech')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/narrative/script.test.ts`
Expected: FAIL — cannot resolve `../../src/narrative/script`

- [ ] **Step 3: Implement**

`assembleScript` maps beats through `templateFor` then `renderLine`, keeps the survivors in order, and carries each line's `cites` through as `beatIDs`. Scenes for this slice are **groupings by location change only** — a new `sessionID` starts a new scene heading. §4.2's act-boundary, 12-beat and 90-second rules come with the Director and are deliberately not built here.

Then the page: `index.html` gains a `#script` column that is **the primary surface**, with `#floor` reduced to a panel beside it (§12 D8), and `src/main.ts` appends a `ScriptLine` as each beat arrives — live, or driven by the recording through the existing Replay path. Each rendered line carries its beat ids in a `data-beats` attribute and shows them on hover, which is the citing chain made visible and is the whole point of this slice.

- [ ] **Step 4: Run all tests**

Run: `bun run test`
Expected: PASS — every test in the project, including the 127 from the foundation

- [ ] **Step 5: Verify by looking at it**

`bun run dev`, then Replay the golden fixture. The script should read as a deadpan account of what actually happened, each line traceable to its beats, with the floor panel beside it. Take a screenshot and keep it with the plan.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(narrative): a script beside the floor, every line traceable to its beats"
```

---

## What this plan deliberately does not do

- **No Director and no model calls.** A joke on top of an uncited line is the one failure this design cannot recover from, so the Director comes after the citing chain is proven. §12 D6 governs it when it arrives.
- **No `checker` beyond the slice-level checks `renderLine` needs.** The scene checks of §5.2 and the cold open fixture come with the Director.
- **No scene assembly by §4.2's rules** — only grouping by location. Those rules exist to bound a Director call, and there is no Director yet.
- **No talking heads, recaps, titles or bibles.** They need the Director's output or the series store, and the series store is slice 2.

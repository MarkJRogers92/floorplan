# Foundation: connect, record, and the room — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pixel room showing one desk per real OpenCode session, with correct idle / working / waiting state, driven entirely by recorded then live events.

**Architecture:** One pure reducer turns OpenCode's SSE frames into desk state. The same reducer is fed either by the live stream or by a file on disk, so the room can be built and tested against a recording without any live work running. The room is a canvas; it renders state, never text. Slice 3 (the rail) and slice 4 (the live loop) get their own plan afterwards.

**Tech Stack:** TypeScript, Vite, vitest, bun, plain `node:http` in tests. No UI framework, plain 2D canvas. No Bitmap font. No art.

**Spec:** `docs/superpowers/specs/2026-10-12-pixel-office-design.md`

## Global Constraints

- OpenCode is **not modified**. We are a client. No patches, no forks, no plugins.
- **No mock state in any shipped code path.** Recordings drive the room in development; the live stream drives it in use. There is no `if (dev)` fake session.
- **No file over ~400 lines** in our own code (spec §4).
- **Never commit the service password.** It is read at runtime from `~/.local/state/opencode/service.json` and never logged, printed, or written anywhere else.
- **Recordings are sensitive.** They contain prompts, file paths and command output. Raw recordings go under `fixtures/raw/` and are gitignored; anything committed to `fixtures/` is scrubbed first.
- MIT-compatible dependencies only. Package manager is `bun`.
- Auth is HTTP Basic, `opencode:<password>` (spec §6.2). All API calls go through one client function.

## Review Focus

These are the inputs and failure modes the spec implies but does not spell out, most likely to bite a person first. Each is pinned to a test in the task that owns the code.

1. **No server running, or no `service.json`** — a person expects to be told, not to get a blank window or a stack trace. → Task 1, Task 12.
2. **A session already waiting on a permission before we connect** — events alone cannot reveal this, and the person expects that worker to be shown as needing them. → Task 7.
3. **The stream drops mid-job and reconnects** — the person expects the floor to survive, not blank. → Task 8.
4. **A frame for a session we never saw created** (we joined mid-stream, or missed `session.created`) — the person expects to see the worker, not to lose the work. → Task 8.
5. **A recording truncated by a kill mid-write** — the person expects replay to skip the partial line rather than refuse the whole file. → Task 9.

---

### Task 1: Project scaffold, and saying so when there is no server

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/api/service.ts`
- Test: `tests/api/service.test.ts`

**Interfaces:**
- Produces: `type Service = { url: string; password: string }`, `defaultServicePath(): string`, `readService(path?: string): Service`

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/service.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readService } from '../../src/api/service'

describe('readService', () => {
  it('returns url and password from a valid file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'svc-'))
    const p = join(dir, 'service.json')
    writeFileSync(p, JSON.stringify({ url: 'http://127.0.0.1:49374', password: 'abc' }))
    expect(readService(p)).toEqual({ url: 'http://127.0.0.1:49374', password: 'abc' })
  })

  it('names the path when the file is missing', () => {
    const p = join(tmpdir(), 'definitely-not-there-9f3a', 'service.json')
    expect(() => readService(p)).toThrow(/not found/i)
    expect(() => readService(p)).toThrow(p)
    expect(() => readService(p)).toThrow(/opencode serve/)
  })

  it('throws a distinct error when the JSON is present but incomplete', () => {
    const dir = mkdtempSync(join(tmpdir(), 'svc-'))
    const p = join(dir, 'service.json')
    writeFileSync(p, JSON.stringify({ url: 'http://127.0.0.1:1' }))
    expect(() => readService(p)).toThrow(/malformed/i)
  })

  it('never includes the password in an error message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'svc-'))
    const p = join(dir, 'service.json')
    writeFileSync(p, JSON.stringify({ url: 5, password: 'SUPERSECRET' }))
    try { readService(p) } catch (e) {
      expect(String((e as Error).message)).not.toContain('SUPERSECRET')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/api/service.test.ts`
Expected: FAIL — cannot resolve `../../src/api/service`

- [ ] **Step 3: Add the scaffold and implement `readService`**

`package.json` scripts: `dev` = `vite`, `test` = `vitest run`, `build` = `vite build`. Dev deps: `vite`, `vitest`, `typescript`. `.gitignore`: `node_modules/`, `dist/`, `fixtures/raw/`. `tsconfig.json`: `strict: true`, ESM.

In `src/api/service.ts`, `defaultServicePath()` returns `join(homedir(), '.local/state/opencode/service.json')`. Missing file throws naming the path and suggesting `opencode serve`. Present-but-unparseable, or missing `url`/`password`, throws a separate "malformed" error that interpolates no values from the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/api/service.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: read the OpenCode service file, or say plainly that it is missing"
```

---

### Task 2: One authed client for every call

**Files:**
- Create: `src/api/client.ts`
- Test: `tests/api/client.test.ts`

**Interfaces:**
- Consumes: `Service` from Task 1
- Produces: `authedFetch(service: Service, path: string, init?: RequestInit): Promise<Response>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/client.test.ts
import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { authedFetch } from '../../src/api/client'

async function stub(handler: (req: any, res: any) => void) {
  const s = createServer(handler); s.listen(0, '127.0.0.1'); await once(s, 'listening')
  const { port } = s.address() as any
  return { url: `http://127.0.0.1:${port}`, close: () => s.close() }
}

describe('authedFetch', () => {
  it('sends HTTP Basic opencode:<password>', async () => {
    let seen = ''
    const s = await stub((req, res) => { seen = req.headers.authorization ?? ''; res.end('{}') })
    await authedFetch({ url: s.url, password: 'pw' }, '/api/model')
    expect(seen).toBe('Basic ' + Buffer.from('opencode:pw').toString('base64'))
    s.close()
  })

  it('joins base url and path without doubling slashes', async () => {
    let seen = ''
    const s = await stub((req, res) => { seen = req.url ?? ''; res.end('{}') })
    await authedFetch({ url: s.url + '/', password: 'pw' }, '/api/model')
    expect(seen).toBe('/api/model')
    s.close()
  })

  it('returns the response on a 404 rather than throwing', async () => {
    const s = await stub((_req, res) => { res.statusCode = 404; res.end('nope') })
    const r = await authedFetch({ url: s.url, password: 'pw' }, '/api/nope')
    expect(r.status).toBe(404)
    s.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/api/client.test.ts`
Expected: FAIL — cannot resolve `../../src/api/client`

- [ ] **Step 3: Implement `authedFetch`**

Single `fetch` call: `Authorization: 'Basic ' + Buffer.from('opencode:' + service.password).toString('base64')`, URL built from a trailing-slash-trimmed base. Returns the `Response` unexamined so callers decide what a non-200 means. Adds no logging of any kind.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/api/client.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add the authed OpenCode API client"
```

---

### Task 3: Parse SSE frames, including split ones

**Files:**
- Create: `src/api/sse.ts`
- Test: `tests/api/sse.test.ts`

**Interfaces:**
- Produces: `type Frame = { id?: string; type: string; data: unknown }`, `parseFrames(buffer: string): { frames: Frame[]; rest: string }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/sse.test.ts
import { describe, it, expect } from 'vitest'
import { parseFrames } from '../../src/api/sse'

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`

describe('parseFrames', () => {
  it('parses a single complete frame', () => {
    const { frames, rest } = parseFrames(frame({ id: 'e1', type: 'session.created', data: { a: 1 } }))
    expect(frames).toEqual([{ id: 'e1', type: 'session.created', data: { a: 1 } }])
    expect(rest).toBe('')
  })

  it('parses two frames arriving in one chunk', () => {
    const { frames } = parseFrames(frame({ type: 'a' }) + frame({ type: 'b' }))
    expect(frames.map(f => f.type)).toEqual(['a', 'b'])
  })

  it('carries a partial frame over to the next chunk', () => {
    const whole = frame({ type: 'big', data: { x: 42 } })
    const first = parseFrames(whole.slice(0, 18))
    expect(first.frames).toEqual([])
    const second = parseFrames(first.rest + whole.slice(18))
    expect(second.frames).toEqual([{ type: 'big', data: { x: 42 } }])
  })

  it('ignores heartbeat comments', () => {
    const { frames } = parseFrames(': heartbeat\n\n' + frame({ type: 'real' }))
    expect(frames.map(f => f.type)).toEqual(['real'])
  })

  it('skips a frame whose payload is not JSON rather than throwing', () => {
    const { frames } = parseFrames('data: {not json\n\n' + frame({ type: 'ok' }))
    expect(frames.map(f => f.type)).toEqual(['ok'])
  })

  it('skips a well-formed frame with no type', () => {
    const { frames } = parseFrames(frame({ id: 'e1', data: {} }))
    expect(frames).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/api/sse.test.ts`
Expected: FAIL — cannot resolve `../../src/api/sse`

- [ ] **Step 3: Implement `parseFrames`**

Split the buffer on `\n\n`; the trailing element is `rest`. For each complete block, ignore lines starting with `:`; concatenate `data:` values; `JSON.parse` and drop the block if it throws or `type` is absent or not a string. Never mutate `rest`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/api/sse.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: parse SSE frames across chunk boundaries"
```

---

### Task 4: Read the live stream

**Files:**
- Create: `src/api/stream.ts`
- Test: `tests/api/stream.test.ts`

**Interfaces:**
- Consumes: `authedFetch` (Task 2), `parseFrames` (Task 3)
- Produces: `streamFrames(service: Service, path: string, onFrame: (f: Frame) => void, signal?: AbortSignal): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/stream.test.ts
import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { streamFrames } from '../../src/api/stream'
import type { Frame } from '../../src/api/sse'

describe('streamFrames', () => {
  it('delivers frames in order and ignores heartbeats', async () => {
    const s = createServer(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': heartbeat\n\n')
      for (const t of ['one', 'two', 'three']) {
        res.write(`data: ${JSON.stringify({ type: t, data: {} })}\n\n`)
        await new Promise(r => setTimeout(r, 5))
      }
      res.end()
    })
    s.listen(0, '127.0.0.1'); await once(s, 'listening')
    const { port } = s.address() as any

    const seen: Frame[] = []
    await streamFrames({ url: `http://127.0.0.1:${port}`, password: 'pw' }, '/api/event', f => seen.push(f))
    expect(seen.map(f => f.type)).toEqual(['one', 'two', 'three'])
    s.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/api/stream.test.ts`
Expected: FAIL — cannot resolve `../../src/api/stream`

- [ ] **Step 3: Implement `streamFrames`**

Use `authedFetch` (not `EventSource` — see spec §6.6). Throw a clear error if `res.ok` is false or `res.body` is null. Read the body with `getReader()`, `TextDecoder` with `{ stream: true }`, accumulate through `parseFrames`, and call `onFrame` per frame. Honours `signal` by passing it to the fetch.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/api/stream.test.ts`
Expected: PASS, 1 test

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: stream OpenCode events over fetch"
```

---

### Task 5: Record a stream to disk — the deliverable of slice 1

**Files:**
- Create: `src/record/recorder.ts`, `src/cli/connect.ts`
- Test: `tests/record/recorder.test.ts`

**Interfaces:**
- Consumes: `Frame` (Task 3)
- Produces: `createRecorder(file: string): (frame: Frame) => void` — appends one JSON line per frame; `Frame` objects are written as `{ id, type, data }`, one per line, each terminated by `\n`

- [ ] **Step 1: Write the failing test**

```ts
// tests/record/recorder.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecorder } from '../../src/record/recorder'

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'rec-')), 'events.jsonl')

describe('createRecorder', () => {
  it('writes one JSON object per line, in order', () => {
    const f = tmpFile()
    const write = createRecorder(f)
    write({ type: 'a', data: { n: 1 } })
    write({ type: 'b', data: { n: 2 } })
    const lines = readFileSync(f, 'utf8').trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines.map(l => JSON.parse(l).type)).toEqual(['a', 'b'])
  })

  it('appends to an existing file rather than truncating it', () => {
    const f = tmpFile()
    writeFileSync(f, JSON.stringify({ type: 'first' }) + '\n')
    createRecorder(f)({ type: 'second', data: {} })
    const types = readFileSync(f, 'utf8').trimEnd().split('\n').map(l => JSON.parse(l).type)
    expect(types).toEqual(['first', 'second'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/record/recorder.test.ts`
Expected: FAIL — cannot resolve `../../src/record/recorder`

- [ ] **Step 3: Implement `createRecorder`**

Open the file once in append mode and keep the descriptor; write `JSON.stringify({ id, type, data }) + '\n'` per frame. No buffering beyond the write itself, so a kill loses at most the line in flight — which Task 9 tolerates.

Then `src/cli/connect.ts`: read the service (Task 1), stream `/api/event` (Task 4), pass every frame to a recorder at `fixtures/raw/<ISO timestamp>.jsonl`, and print one line per frame with the type only. Print a summary count on `SIGINT`. This file is a script, not a library; it has no unit test and is verified by running it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/record/recorder.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Verify the recorder against a real server**

Ensure `opencode serve` is running, then `bun run src/cli/connect.ts`, do a little real work in whichever frontend you use (the desktop app — the spec leaves session creation to the owner for now), and Ctrl-C. Confirm `fixtures/raw/*.jsonl` exists with more than zero lines and that every line parses. **Do not commit this file** — it is gitignored, and it contains real prompts and paths.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: record the OpenCode event stream to disk"
```

---

### Task 6: Turn frames into desk state — the centre of gravity

**Files:**
- Create: `src/state/desk.ts`
- Test: `tests/state/desk.test.ts`

**Interfaces:**
- Consumes: `Frame` (Task 3)
- Produces: `type DeskStatus = 'idle' | 'working' | 'waiting-on-you' | 'waiting-on-worker' | 'success' | 'failure'`; `type Desk = { sessionID: string; status: DeskStatus; caption: string; openPermission?: string; waitingOnSibling: boolean }`; `createDesk(sessionID: string): Desk`; `applyFrame(desk: Desk, frame: Frame): Desk`

- [ ] **Step 1: Write the failing test**

```ts
// tests/state/desk.test.ts
import { describe, it, expect } from 'vitest'
import { createDesk, applyFrame, type Desk } from '../../src/state/desk'

const d = (): Desk => createDesk('s1')
const f = (type: string, data: unknown = {}) => ({ type, data })
const statusOf = (d: Desk) => d.status

describe('applyFrame — the spec table (§6.3)', () => {
  it('goes working on execution.started', () => {
    expect(statusOf(applyFrame(d(), f('session.execution.started')))).toBe('working')
  })
  it('goes working on a tool call', () => {
    expect(statusOf(applyFrame(d(), f('session.tool.called')))).toBe('working')
  })
  it('goes working on text deltas', () => {
    expect(statusOf(applyFrame(d(), f('session.text.delta')))).toBe('working')
  })
  it('captions compaction', () => {
    const next = applyFrame(d(), f('session.compaction.started'))
    expect(next.status).toBe('working')
    expect(next.caption).toBe('compacting')
  })
  it('goes waiting-on-you on permission.asked and records the id', () => {
    const next = applyFrame(d(), f('permission.asked', { requestID: 'p1' }))
    expect(next.status).toBe('waiting-on-you')
    expect(next.openPermission).toBe('p1')
  })
  it('goes waiting-on-worker on session.inbox events', () => {
    const next = applyFrame(d(), f('session.inbox.enqueued'))
    expect(next.status).toBe('waiting-on-worker')
    expect(next.waitingOnSibling).toBe(true)
  })
  it('holds success then the caller decides when to settle', () => {
    expect(statusOf(applyFrame(d(), f('session.execution.succeeded')))).toBe('success')
  })
  it('holds failure', () => {
    expect(statusOf(applyFrame(d(), f('session.execution.failed')))).toBe('failure')
  })
})

describe('applyFrame — precedence and clearing (§6.3)', () => {
  it('does not clear an open permission on a text delta', () => {
    const held = applyFrame(d(), f('permission.asked', { requestID: 'p1' }))
    expect(statusOf(applyFrame(held, f('session.text.delta')))).toBe('waiting-on-you')
  })
  it('does not clear an open permission on a completed execution', () => {
    const held = applyFrame(d(), f('permission.asked', { requestID: 'p1' }))
    expect(statusOf(applyFrame(held, f('session.execution.succeeded')))).toBe('waiting-on-you')
  })
  it('clears on permission.replied, whoever answered it', () => {
    const held = applyFrame(d(), f('permission.asked', { requestID: 'p1' }))
    const after = applyFrame(held, f('permission.replied', { requestID: 'p1' }))
    expect(after.status).toBe('working')
    expect(after.openPermission).toBeUndefined()
  })
  it('ignores a reply for a request it never saw asked', () => {
    const next = applyFrame(d(), f('permission.replied', { requestID: 'never' }))
    expect(next.status).toBe('idle')
  })
  it('shows needs-you over a sibling wait, and restores the wait afterwards', () => {
    const waiting = applyFrame(d(), f('session.inbox.enqueued'))
    const asked = applyFrame(waiting, f('permission.asked', { requestID: 'p1' }))
    expect(statusOf(asked)).toBe('waiting-on-you')
    const answered = applyFrame(asked, f('permission.replied', { requestID: 'p1' }))
    expect(statusOf(answered)).toBe('waiting-on-worker')
  })
  it('treats an unknown event type as a no-op', () => {
    const before = applyFrame(d(), f('session.execution.started'))
    expect(applyFrame(before, f('some.future.event'))).toEqual(before)
  })
  it('never mutates the desk it was given', () => {
    const before = applyFrame(d(), f('session.execution.started'))
    const snapshot = JSON.stringify(before)
    applyFrame(before, f('permission.asked', { requestID: 'p9' }))
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/state/desk.test.ts`
Expected: FAIL — cannot resolve `../../src/state/desk`

- [ ] **Step 3: Implement `createDesk` and `applyFrame`**

Fall back to `caption` from the event type's verb when the spec names none (e.g. the tool name or `"compacting"`). Order the rules so an open `openPermission` short-circuits everything except `permission.replied`. `permission.replied` with a matching open request clears `openPermission` and moves the desk to `working`; a reply that matches nothing is a no-op, and the tests pin both. `waitingOnSibling` is a flag that persists across other events: `session.inbox.*` sets it, and the status it implies shows whenever no permission is open. Treat `success`/`failure` as holdable states: `succeeded`/`failed`/`interrupted` set them, and the *next* frame drives the change, so no timers live in this module. `session.execution.interrupted` behaves as `failure`. Return a new object always.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/state/desk.test.ts`
Expected: PASS, 15 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: reduce OpenCode events to desk state"
```

---

### Task 7: Seed the floor from a snapshot

**Files:**
- Create: `src/state/seed.ts`
- Test: `tests/state/seed.test.ts`

**Interfaces:**
- Consumes: `Desk`, `createDesk`, `applyFrame` (Task 6)
- Produces: `type SessionSnapshot = { id: string; active?: boolean }`; `type PermissionRequest = { requestID: string; sessionID: string }`; `seedDesks(sessions: SessionSnapshot[], permissions: PermissionRequest[]): Map<string, Desk>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/state/seed.test.ts
import { describe, it, expect } from 'vitest'
import { seedDesks } from '../../src/state/seed'

describe('seedDesks', () => {
  it('creates an idle desk per session', () => {
    const m = seedDesks([{ id: 'a' }, { id: 'b' }], [])
    expect(m.size).toBe(2)
    expect(m.get('a')!.status).toBe('idle')
  })

  it('marks a session with an open permission as waiting-on-you — the case events cannot cover', () => {
    const m = seedDesks([{ id: 'a' }], [{ requestID: 'p1', sessionID: 'a' }])
    expect(m.get('a')!.status).toBe('waiting-on-you')
    expect(m.get('a')!.openPermission).toBe('p1')
  })

  it('keeps the earliest request when a session has several', () => {
    const m = seedDesks([{ id: 'a' }], [
      { requestID: 'p2', sessionID: 'a' },
      { requestID: 'p1', sessionID: 'a' },
    ])
    expect(m.get('a')!.openPermission).toBe('p2')
  })

  it('ignores a permission whose session is not in the snapshot', () => {
    const m = seedDesks([{ id: 'a' }], [{ requestID: 'p1', sessionID: 'ghost' }])
    expect(m.size).toBe(1)
    expect(m.has('ghost')).toBe(false)
  })

  it('returns an empty map for an empty snapshot', () => {
    expect(seedDesks([], []).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/state/seed.test.ts`
Expected: FAIL — cannot resolve `../../src/state/seed`

- [ ] **Step 3: Implement `seedDesks`**

Create one desk per session, then apply each matching permission through `applyFrame` so the seeding path and the live path cannot drift. Preserve input order. Read `requestID` and the session's id defensively — if a field is absent, skip that permission rather than inventing one.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/state/seed.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: seed desk state from a REST snapshot"
```

---

### Task 8: The desk registry

**Files:**
- Create: `src/state/registry.ts`
- Test: `tests/state/registry.test.ts`

**Interfaces:**
- Consumes: `Desk`, `applyFrame` (Task 6), `seedDesks` (Task 7)
- Produces: `ingest(map: Map<string, Desk>, frame: Frame): Map<string, Desk>`; `ingestAll(map, frames: Frame[]): Map<string, Desk>`; `desks(map): Desk[]` (stable order)

- [ ] **Step 1: Write the failing test**

```ts
// tests/state/registry.test.ts
import { describe, it, expect } from 'vitest'
import { ingest, ingestAll, desks } from '../../src/state/registry'
import { seedDesks } from '../../src/state/seed'

const F = (sessionID: string, type: string, data: unknown = {}) =>
  ({ type, data: { sessionID, ...(data as object) } })

describe('registry', () => {
  it('adds a desk on session.created', () => {
    const m = ingest(new Map(), F('a', 'session.created'))
    expect(desks(m).map(d => d.sessionID)).toEqual(['a'])
  })

  it('removes a desk on session.deleted', () => {
    const m = ingestAll(new Map(), [F('a', 'session.created'), F('a', 'session.deleted')])
    expect(desks(m)).toEqual([])
  })

  it('creates a desk for a session we never saw created — joining mid-stream', () => {
    const m = ingest(new Map(), F('joined-late', 'session.execution.started'))
    expect(desks(m).map(d => d.sessionID)).toEqual(['joined-late'])
  })

  it('routes a per-session event to the right desk only', () => {
    const m = ingestAll(new Map(), [
      F('a', 'session.created'), F('b', 'session.created'),
      F('b', 'session.execution.started'),
    ])
    expect(desks(m).find(d => d.sessionID === 'a')!.status).toBe('idle')
    expect(desks(m).find(d => d.sessionID === 'b')!.status).toBe('working')
  })

  it('does not resurrect a deleted session', () => {
    const m = ingestAll(new Map(), [
      F('a', 'session.created'), F('a', 'session.deleted'), F('a', 'session.execution.started'),
    ])
    expect(m.has('a')).toBe(false)
  })

  it('keeps the order sessions were first seen in', () => {
    const m = ingestAll(new Map(), [
      F('z', 'session.created'), F('a', 'session.created'), F('z', 'session.text.delta'),
    ])
    expect(desks(m).map(d => d.sessionID)).toEqual(['z', 'a'])
  })

  it('skips a frame with no session id', () => {
    const m = ingest(new Map(), { type: 'session.execution.started', data: {} })
    expect(desks(m)).toEqual([])
  })

  it('accepts a seeded map and keeps working from it', () => {
    const seeded = seedDesks([{ id: 'a' }], [{ requestID: 'p1', sessionID: 'a' }])
    const m = ingest(seeded, F('a', 'permission.replied', { requestID: 'p1' }))
    expect(desks(m)[0].status).toBe('working')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/state/registry.test.ts`
Expected: FAIL — cannot resolve `../../src/state/registry`

- [ ] **Step 3: Implement the registry**

A `Map<string, Desk>` plus a remembered insertion order (arrays and `Map` both preserve it; keep `deleted: Set<string>` separately so a post-deletion frame cannot resurrect a session). Read the session id from `frame.data.sessionID`; if absent, return the map unchanged. `session.created` with an existing id is idempotent.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/state/registry.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: keep a desk registry keyed by session"
```

---

### Task 9: Replay a recording — what makes the room testable

**Files:**
- Create: `src/replay/replay.ts`, `fixtures/sample.jsonl`
- Test: `tests/replay/replay.test.ts`

**Interfaces:**
- Consumes: `Frame` (Task 3), registry (Task 8)
- Produces: `readFrames(file: string): Frame[]` (pure, synchronous); `replay(file: string, onFrame: (f: Frame) => void, stepMs?: number): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/replay/replay.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFrames } from '../../src/replay/replay'
import { ingestAll, desks } from '../../src/state/registry'

const write = (body: string) => {
  const f = join(mkdtempSync(join(tmpdir(), 'rp-')), 'events.jsonl')
  writeFileSync(f, body)
  return f
}

describe('readFrames', () => {
  it('reads frames in order', () => {
    const f = write(['{"type":"a","data":{}}', '{"type":"b","data":{}}'].join('\n') + '\n')
    expect(readFrames(f).map(x => x.type)).toEqual(['a', 'b'])
  })

  it('skips a partial final line left by a kill mid-write', () => {
    const f = write('{"type":"a","data":{}}\n{"type":"b","da')
    expect(readFrames(f).map(x => x.type)).toEqual(['a'])
  })

  it('skips blank lines and lines with no type', () => {
    const f = write('\n{"data":{}}\n{"type":"real","data":{}}\n')
    expect(readFrames(f).map(x => x.type)).toEqual(['real'])
  })

  it('returns an empty array for an empty file', () => {
    expect(readFrames(write(''))).toEqual([])
  })
})

describe('replay feeds the same registry as the live stream', () => {
  it('produces the expected final desk states from the committed fixture', () => {
    const frames = readFrames('fixtures/sample.jsonl')
    const final = desks(ingestAll(new Map(), frames))
    const byId = Object.fromEntries(final.map(d => [d.sessionID, d.status]))
    expect(byId).toEqual({
      'sess-alpha': 'working',
      'sess-beta': 'waiting-on-you',
      'sess-gamma': 'idle',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/replay/replay.test.ts`
Expected: FAIL — cannot resolve `../../src/replay/replay`

- [ ] **Step 3: Implement `readFrames` and `replay`, and write the fixture**

`readFrames` splits on `\n`, drops lines that are blank or fail to parse or lack a `type`, and returns the rest. Never throws on file content. `replay` reads then emits each frame via `onFrame`, awaiting `stepMs` (default 250) between them so the room visibly evolves; `AbortSignal`-aware.

**Before writing the fixture, check `packages/simulation`** (spec §6.5). If it already emits frames in this shape, prefer it over a hand-written sample and say so in the commit message — a real generated stream is worth more than one I invent.

`fixtures/sample.jsonl` is hand-written and scrubbed: no real paths, prompts or ids. It must produce exactly the three final states asserted above — `sess-alpha` left `working`, `sess-beta` holding an unanswered `permission.asked`, `sess-gamma` created and never started, so it stays `idle` *and* still present (a deleted session would not appear at all). Include at least one frame type the reducer does not know, so replay exercises the no-op path.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/replay/replay.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: replay a recorded stream through the same reducer"
```

---

### Task 10: Where the desks go

**Files:**
- Create: `src/room/layout.ts`
- Test: `tests/room/layout.test.ts`

**Interfaces:**
- Consumes: nothing — pure geometry, it never sees a desk.
- Produces: `type Rect = { x: number; y: number; w: number; h: number }`; `layout(count: number, bounds: { w: number; h: number }, cell?: number): Rect[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/room/layout.test.ts
import { describe, it, expect } from 'vitest'
import { layout } from '../../src/room/layout'

const bounds = { w: 200, h: 200 }

describe('layout', () => {
  it('returns nothing for no desks', () => {
    expect(layout(0, bounds)).toEqual([])
  })

  it('places the first desk at the top-left inside the padding', () => {
    expect(layout(1, bounds, 50)[0]).toEqual({ x: 8, y: 8, w: 50, h: 50 })
  })

  it('fills a row before wrapping', () => {
    const r = layout(3, bounds, 50)
    expect(r.map(p => p.x)).toEqual([8, 62, 116])
    expect(r.every(p => p.y === 8)).toBe(true)
  })

  it('wraps to the next row when the row is full', () => {
    const r = layout(4, bounds, 50)
    expect(r[3]).toEqual({ x: 8, y: 62, w: 50, h: 50 })
  })

  it('is deterministic', () => {
    expect(layout(7, bounds, 44)).toEqual(layout(7, bounds, 44))
  })

  it('keeps every rect inside the bounds for a sensible cell size', () => {
    for (const p of layout(9, bounds, 48)) {
      expect(p.x + p.w).toBeLessThanOrEqual(bounds.w)
      expect(p.y + p.h).toBeLessThanOrEqual(bounds.h)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/room/layout.test.ts`
Expected: FAIL — cannot resolve `../../src/room/layout`

- [ ] **Step 3: Implement `layout`**

Grid with an 8px padding and a 6px gap; columns = `max(1, floor((bounds.w - 16) / (cell + 6)))`. `shortcut: desks beyond the last visible row are placed off-screen and simply not drawn; add scrolling or paging when a person actually runs more sessions than fit.`

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/room/layout.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: compute desk positions on a grid"
```

---

### Task 11: Draw the room

**Files:**
- Create: `src/room/room.ts`
- Test: `tests/room/room.test.ts`

**Interfaces:**
- Consumes: `Desk`, `DeskStatus` (Task 6); `Rect` and `layout` (Task 10) — `draw` calls `layout(desks.length, bounds)`
- Produces: `statusColour(status: DeskStatus): string`; `createRoom(canvas: HTMLCanvasElement): { draw(desks: Desk[]): void }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/room/room.test.ts
import { describe, it, expect } from 'vitest'
import { statusColour } from '../../src/room/room'

describe('statusColour', () => {
  it('gives every status its own colour', () => {
    const all = ['idle', 'working', 'waiting-on-you', 'waiting-on-worker', 'success', 'failure'] as const
    const colours = all.map(statusColour)
    expect(new Set(colours).size).toBe(all.length)
  })

  it('gives waiting-on-you and waiting-on-worker visibly different colours', () => {
    expect(statusColour('waiting-on-you')).not.toBe(statusColour('waiting-on-worker'))
  })

  it('is stable for the same input', () => {
    expect(statusColour('working')).toBe(statusColour('working'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/room/room.test.ts`
Expected: FAIL — cannot resolve `../../src/room/room`

- [ ] **Step 3: Implement `statusColour` and `createRoom`**

A flat map from status to a hex string. `createRoom` holds the canvas and its 2D context; `draw(desks)` clears, runs `layout`, and fills one rounded rect per desk plus a small status dot. **No text, no sprites, no font** — art is deliberately absent. Desks past the last visible row are not drawn.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/room/room.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: draw desks as coloured rectangles"
```

---

### Task 12: Wire it together and see real work on the floor

**Files:**
- Create: `index.html`, `src/main.ts`, `src/app/floor.ts`
- Test: `tests/app/floor.test.ts`

**Interfaces:**
- Consumes: `readService` (Task 1); `streamFrames` (Task 4); `Frame` (Task 3); `SessionSnapshot`, `PermissionRequest`, `seedDesks` (Task 7); `ingest`, `desks` (Task 8); `readFrames`, `replay` (Task 9); `createRoom` (Task 11)
- Produces: `createFloor(): { setSnapshot(sessions: SessionSnapshot[], permissions: PermissionRequest[]): void; push(frame: Frame): void; desks(): Desk[] }` — the single object the page owns

- [ ] **Step 1: Write the failing test**

```ts
// tests/app/floor.test.ts
import { describe, it, expect } from 'vitest'
import { createFloor } from '../../src/app/floor'

describe('createFloor', () => {
  it('starts empty and seeds from a snapshot', () => {
    const floor = createFloor()
    expect(floor.desks()).toEqual([])
    floor.setSnapshot([{ id: 'a' }], [])
    expect(floor.desks().map(d => d.sessionID)).toEqual(['a'])
  })

  it('applies live frames on top of a snapshot', () => {
    const floor = createFloor()
    floor.setSnapshot([{ id: 'a' }], [{ requestID: 'p1', sessionID: 'a' }])
    floor.push({ type: 'permission.replied', data: { sessionID: 'a', requestID: 'p1' } })
    expect(floor.desks()[0].status).toBe('working')
  })

  it('drops a desk the new snapshot does not mention', () => {
    const floor = createFloor()
    floor.setSnapshot([{ id: 'a' }], [])
    floor.push({ type: 'session.created', data: { sessionID: 'b' } })
    floor.setSnapshot([{ id: 'a' }], [])
    expect(floor.desks().map(d => d.sessionID)).toEqual(['a'])
  })

  it('keeps the position of desks that survive a re-snapshot', () => {
    const floor = createFloor()
    floor.setSnapshot([{ id: 'a' }, { id: 'b' }], [])
    floor.setSnapshot([{ id: 'b' }, { id: 'a' }], [])
    expect(floor.desks().map(d => d.sessionID)).toEqual(['a', 'b'])
  })

  it('shows a permission raised while we were disconnected', () => {
    const floor = createFloor()
    floor.setSnapshot([{ id: 'a' }], [])
    floor.setSnapshot([{ id: 'a' }], [{ requestID: 'p1', sessionID: 'a' }])
    expect(floor.desks()[0].status).toBe('waiting-on-you')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/app/floor.test.ts`
Expected: FAIL — cannot resolve `../../src/app/floor`

- [ ] **Step 3: Implement `createFloor`, then the page**

`createFloor` owns the registry (Task 8) and exposes the three methods above. `setSnapshot` **replaces** the desk set rather than merging: the snapshot is authoritative for which sessions exist, so a session deleted while we were disconnected disappears and a permission raised during the gap shows. Desks present in both keep the positions they already had. `index.html` holds a full-window `<canvas>` and a small toolbar with a **Replay** button and a file input for a `.jsonl`. `src/main.ts` wires: on load, list running servers' sessions to seed, then stream live; the Replay button runs `replay()` against the chosen file and draws on every frame. If `readService()` throws (Task 1), the page shows that message in the toolbar rather than a blank canvas.

- [ ] **Step 4: Run all tests**

Run: `bun run test`
Expected: PASS — every test from Tasks 1–12

- [ ] **Step 5: Verify by looking at it**

`bun run dev`, open the page. Press **Replay** and watch the sample recording: three desks appear in the expected states, `sess-beta` holding a distinct "needs you" colour. Then, with `opencode serve` running, confirm live sessions appear as desks without pressing Replay. Take a screenshot and keep it with the plan.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: serve the floor from seeded and live OpenCode state"
```

---

## What this plan deliberately does not do

- No rail, no transcript, no prompt box, no permission answering. That is slice 3 and 4, and the room above will change what the rail needs.
- No art, no sprites, no bitmap font. Desks are coloured rectangles until the room is proven useful.
- No framework. If the rail needs one later, that is when to add it.

# Handoff — floorplan

Written 2026-10-12. A fresh agent (or human) should be able to pick this up from
this file alone.

## What this is

`floorplan` is a workspace for **OpenCode** that turns a coding session into a
**followable narrative**. Long term it shows your agents as a pixel-art office
where the work is *staged* — an AI sitcom you watch. Right now the goal is a thin,
honest foundation: real state from real events, no mock data anywhere.

Two documents are the authority, in this order:

1. **Spec (binding):** `docs/superpowers/specs/2026-10-12-pixel-office-design.md`
2. **Plan (its argument):** `docs/superpowers/plans/2026-10-12-foundation-connect-and-room.md`

Where they disagree, the spec wins.

## Where things are

- **Repo:** https://github.com/MarkJRogers92/floorplan — public, MIT.
- **Local:** `~/Developer/floorplan`
- **Branch:** `foundation` — this is also GitHub's default branch. `main` exists
  locally with the two documents only; it is behind and one day should be brought
  forward and made the default.
- **The SDD ledger** (per-task detail, rulings, deferred minors) lives at
  `.superpowers/sdd/2026-10-12-foundation-connect-and-room/progress.md`. It is
  **git-ignored, so a fresh clone will not have it.** Everything durable from it is
  repeated in this file; if you have the local checkout, read it too.

## Conventions — how work is done here

- **One task at a time, in plan order.** Each task is test-first: write the failing
  test, run it, see it fail, then implement.
- **`bun run test` and `bun run typecheck` must both pass before every commit.**
  This is not optional; `typecheck` is the only thing that catches interface drift
  between tasks.
- **OpenCode is never modified.** This is a client. No patches, no forks, no plugins.
- **No Node-only globals in `src/`.** The shell is an ordinary browser app (Vite,
  fetch-streaming, no Electron), so `Buffer`, `process`, `require`, `__dirname` and
  `node:` imports are banned in `src/`. `node:` imports are expected in `tests/`.
- **The service password is read at runtime from
  `~/.local/state/opencode/service.json`, and is never committed, logged, printed or
  sent anywhere.** There is no copy of it in this repo. Keep it that way.
- **No file over ~400 lines.** No mock state in any shipped code path.
- **Recordings are sensitive** — they contain prompts, paths and command output.
  Raw recordings go in `fixtures/raw/` and are git-ignored; anything committed to
  `fixtures/` must be scrubbed first.
- MIT-compatible dependencies only. Package manager is `bun`.

## State: 4 of 12 tasks complete

All four were reviewed by an independent agent and are clean.

| # | Task | Status |
|---|---|---|
| 1 | Project scaffold; read the OpenCode service file | ✅ complete |
| 2 | One authed API client every call goes through | ✅ complete |
| 3 | SSE frame parser, survives chunk splits | ✅ complete |
| 4 | Live stream reader (`fetch` + stream reader) | ✅ complete |
| 5 | **Record a stream to disk** — the slice-1 deliverable | next |
| 6 | **Frames → desk state** — the reducer; the centre of gravity | |
| 7 | Seed the floor from a REST snapshot | |
| 8 | The desk registry | |
| 9 | Replay a recording through the same reducer | |
| 10 | Desk layout (pure geometry) | |
| 11 | Draw the room (canvas, rectangles — no art) | |
| 12 | Wire it together: the page and a dev-only credential route | |

**Start at Task 5.** Generate its brief and dispatch it.

### Two things Tasks 5 and 12 need

- **Task 5** verifies itself by running the recorder against a live
  `opencode serve` while you do real work — in the OpenCode desktop app, since
  session *creation* is deliberately out of scope. The endpoint the spec lists for
  prompting (`POST /api/session/{id}/prompt`) needs an existing session id; whether
  a session-creation endpoint exists has never been verified. That matters for
  slice 4, not this plan.
- **Task 12** owns a dev-only `GET /__service` route in `vite.config.ts`. The browser
  cannot read the service file, so this route serves `{url, password}` from the Vite
  process to the page. The plan has been amended for this. Do not let the floor own
  the page layout: keep it a panel in a shell, because the script becomes the primary
  surface beside it.

## Rulings made — someone must own these

Every decision taken on the owner's behalf, in order. If one is wrong, it is wrong
here, visibly.

1. **Branch, not a git worktree.** The repo was minutes old, single-author, docs
   only, no concurrent work to isolate from.
2. **Every task runs `bun run test` and `bun run typecheck` before committing.** The
   plan ran neither.
3. **Task 1's password-leak test was vacuous and the plan mandated it** — the
   `expect` sat inside the `catch`, so it passed when nothing was thrown. Tightened
   so it fails when `readService` does not throw.
4. **Added `@types/node` and a `typecheck` script.** The plan's devDeps list was
   incomplete, so `tsc` failed with six `TS2591` errors and nothing ran type
   checking at all.
5. **`setSnapshot` replaces the desk set rather than merging.** The snapshot is
   authoritative for which sessions exist, so a session deleted while disconnected
   disappears and a permission raised during the gap shows.
6. **`permission.replied` with no matching open request is a no-op; with a match it
   clears the permission and moves the desk to `working`.** The plan's tests demanded
   both while its prose named neither.
7. **`waitingOnSibling` persists across unrelated events**, so clearing a permission
   returns the desk to its sibling wait rather than `idle`.
8. **Corrected four Tasks' "Consumes" claims and one test count in the plan itself.**
   Documentation defects: Task 10 claimed to consume `Desk` when `layout` takes a
   count, Task 11 did not say it calls `layout(desks.length, …)`, Task 12 named none
   of its inputs, and Task 6's test count was wrong.
9. **Task 9's fixture must leave `sess-gamma` created and never started.** A deleted
   session would not appear in the final state at all, making the assertion
   impossible as written.
10. **The browser cannot read `~/.local/state/opencode/service.json`.** The spec's
    "no proxy process" rule was about auth headers, not filesystem access, so it did
    not settle this. Resolution: a dev-only route inside the Vite process. Cost if
    wrong: the foundation works only in dev and a shippable build needs a real
    credential path — one file.
11. **Amended Task 12** for the above, which as written had the page calling a
    Node-only module.
12. **The narrative owns the primary data model; the floor is one of its renderers.**
    A *scene* is `{ id, location, cast, beats }`; a *beat* is
    `{ id, at, eventIDs, kind, line }`. Three renderings fall out of that: script
    (beats in order), floor (cast at desks — what Task 12 builds), staged animation.
    Had the narration been merely "lines attached to events", the visuals could not
    be generated from it and the surfaces would drift apart.
13. **Sequence: script, then floor, then staged animation.** Animation is where this
    project dies if it starts there.
14. **The "takes" idea is superseded by the narrative layer.** It is a subset — an
    attempt count from `session.retry.scheduled` and repeated `execution.started`.
    Do not build it separately.

## The narrative layer — why this project exists

This is the owner's actual goal, and it is **not in this plan**. It needs its own
spec once the foundation lands.

A funny, followable story of the real work, written as scenes. The owner watches it
**live**, as the work happens, and eventually wants **visuals of an actual AI
sitcom**, at which point the floor stops being a parallel view and becomes the
*staging* of the narrative.

- **Two voices.** Each worker writes a line about what it just did — grounded by
  construction, and only possible when a unit of work ends. A **Director** stitches
  those plus the event stream into sitcom beats: cold open, A-plot, B-plot, tag.
- **Live means a selection problem.** A real event stream is almost all noise. So
  the pipeline needs a **pure rollup layer** that collapses raw events into beats
  worth narrating — a tool started and finished is one beat, two hundred deltas are
  one beat, a failure is an immediate beat, a long silence is a beat. The Director
  turns beats into lines. This is also the cost control: spend scales with beats,
  not events.
- **The non-negotiable.** Every narrative line carries the id of the event it
  describes. The narration frames and never invents. A line with no underlying event
  cannot exist, because a voiceover that misreports the work is worse than no
  voiceover.
- **Runtime consequence.** It runs as long as the human works, so a free tier will
  rate-limit mid-session. It needs a cheap paid model and a kill switch; losing the
  narrator must not stop the work.

## Open issues, deferred minors, and unverified things

Deferred minors were deliberately kept out of the fix loops; the final whole-branch
review should triage which matter before merge.

- `src/api/sse.ts` splits only on `\n\n`, so a **CRLF-terminated stream parses zero
  frames** and `rest` grows without bound — a hang, not a crash. Plan-mandated;
  OpenCode emits LF.
- A heartbeat sent as `:ping\n` (single newline) has the same unbounded-`rest`
  failure mode.
- `src/api/stream.ts`'s final `parseFrames` call is a **provable no-op** — `rest`
  can never itself contain `\n\n` — and its comment overstates what it does.
- No `finally { reader.cancel() }` in `streamFrames`, so a throwing `onFrame` leaves
  the HTTP response open. It is called in a reconnect loop.
- The stream tests' server `close()` is not awaited, so a failed assertion leaks the
  listener.
- The **null-body branch of `streamFrames` is untested**, deliberately: it is
  near-unreachable from a real server, and a contrived mock was judged worse than a
  documented gap.
- The non-ASCII byte-identity property in `src/api/client.ts` (the reason its base64
  was rewritten from `Buffer` to `btoa`) has **no committed test** — the evidence was
  an ad-hoc run. This one is worth fixing first.
- `tests/api/client.test.ts` closes its HTTP listener after the assertions, so a
  failing assertion leaks it.
- `base + path` in `src/api/client.ts` builds a malformed URL if a path lacks a
  leading slash.
- A caller-supplied `Authorization` header is silently overwritten. Intended.
- **`fixtures/sample.jsonl`** (Task 9) does not exist yet and is hand-written: no real
  paths, prompts or ids, and it must produce exactly the three final desk states the
  plan asserts.
- **Unverified:** whether `packages/simulation` in the OpenCode repo is a usable
  event-fixture harness (Task 9 checks, and prefers it over a hand-written sample);
  whether the endpoint list in spec §6.2 is complete; whether a session-creation
  endpoint exists at all.

## The OpenCode facts you need

- Server: `opencode serve` — "the v2 API and web server". 118 REST endpoints, full
  OpenAPI at `GET /openapi.json`.
- Auth: HTTP Basic, `opencode:<password>`, password in
  `~/.local/state/opencode/service.json`.
- Events: `GET /api/event`, SSE. Frames are
  `data: {"id":"evt_…","type":"<name>","location":{…},"data":{…}}` with `: heartbeat`
  comments between them.
- Loophole that makes the browser shell viable: the server returns
  `Access-Control-Allow-Origin` for `localhost`/`127.0.0.1` on any port, and its
  preflight answers `204` allowing the `authorization` header. So a page served from
  a local dev server can call the API directly. Use `fetch`-streaming, **not**
  `EventSource`, which cannot send the header.
- The event-to-desk-state mapping, including the precedence and clearing rules, is
  spec §6.3. It is the whole room, and it is the part most likely to change.

## If you are a different harness

Nothing here is OpenCode-specific. It is a TypeScript/Vite project with a
test-first plan, and any agent that can read a markdown plan, run `bun run test` and
`bun run typecheck`, and write a failing test before an implementation can carry on.
The plan is written to be executed task-by-task by an agent that has not seen this
project.

To make these conventions load automatically, copy the **Conventions** and
**Rulings** sections into `AGENTS.md` (OpenCode) or `CLAUDE.md` (Claude Code).

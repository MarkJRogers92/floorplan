# Handoff — floorplan

Updated 2026-10-13. The foundation is **complete**; this describes a finished thing plus
what comes next, so it should read differently from the version that described work in
progress.

## What this is

`floorplan` is a workspace for **OpenCode** that turns a coding session into a
**followable narrative**. The end state is an AI sitcom: real work, staged as story,
rendered as a pixel-art office you watch. The foundation built the floor and the whole
data path underneath it.

Two documents are the authority, in this order:

1. **Spec (binding):** `docs/superpowers/specs/2026-10-12-pixel-office-design.md`
2. **Plan (its argument):** `docs/superpowers/plans/2026-10-12-foundation-connect-and-room.md`

The next subsystem already has its design:
`docs/superpowers/specs/2026-10-12-narrative-layer-design.md` (revision 3).

Where documents disagree, the spec wins.

## Where things are

- **Repo:** https://github.com/MarkJRogers92/floorplan — public, MIT. **`main` is the trunk and the default branch.**
- **Local:** `~/Developer/floorplan`
- **Also on disk:** `~/Developer/floorplan-claude` — a git worktree used for the parallel half of the work. Its branch `claude/data-and-narrative` was merged and was never pushed. It is host-owned; delete it when you are done with it. `git worktree remove ~/Developer/floorplan-claude`
- **The ledger** — per-task detail, every ruling, every deferred minor — is at
  `.superpowers/sdd/2026-10-12-foundation-connect-and-room/progress.md`. It is
  **git-ignored, so a clone will not have it.** Read it if the local checkout is still
  there; the durable parts are in this file and in git history.
- `git log --oneline main | head -40` is the real record.

## State: 12 of 12 tasks complete

**127 tests, 13 files, `bun run typecheck` clean.** Every task was reviewed by an agent
that did not write it, plus one final whole-branch review.

```sh
bun install
bun run test        # vitest
bun run typecheck   # tsc --noEmit
bun run dev         # the page — serves the room; needs `opencode serve` for live desks
```

**What runs today:** a canvas room with one desk per OpenCode session, coloured by
status, drawn from real events — live, or from a `.jsonl` recording via the Replay
button. Nothing else. The rail, the transcript and permission-answering are **not**
built; they were deferred and are the remaining part of the spec's "done means".

### The code, by responsibility

| Path | What it is |
|---|---|
| `src/api/service.ts` | reads `~/.local/state/opencode/service.json` — Node-only |
| `src/api/client.ts` | the one authed `fetch`; browser-safe base64 |
| `src/api/sse.ts` | `Frame` and the SSE frame parser; keeps `created` and `location` |
| `src/api/stream.ts` | `fetch`-streaming live reader (`EventSource` cannot send the auth header) |
| `src/record/recorder.ts`, `src/cli/connect.ts` | record a stream to `.jsonl` |
| `src/state/desk.ts` | **the reducer** — events to desk state, and the precedence rules |
| `src/state/seed.ts` | seed the floor from a REST snapshot |
| `src/state/registry.ts` | the desk `Map`, tombstones, parent/child links |
| `src/replay/{parse,play,replay}.ts` | replay a recording; `play.ts` is the browser-safe one |
| `src/room/{layout,room}.ts` | pure geometry, then canvas drawing |
| `src/app/floor.ts` | `createFloor` — the object the page owns |
| `src/main.ts`, `index.html` | the page |
| `src/dev/service-route.ts`, `vite.config.ts` | the dev-only `GET /__service` credential route |

## Conventions — how work is done here

- **One task at a time, in plan order**, test-first: failing test, run it, see it fail,
  then implement.
- **`bun run test` and `bun run typecheck` must both pass before every commit.** This is
  the single most valuable rule in this repo's history — see below.
- **Run the thing.** Three real bugs on this branch were invisible to unit tests and to
  typecheck; two were only found by starting the dev server.
- **OpenCode is never modified.** This is a client. No patches, no forks, no plugins.
- **No `Buffer`, `process`, `require`, `__dirname` or `node:` imports in `src/`** — it
  ships to a browser. `node:` in `tests/` is expected. One plan-mandated type-only
  exception exists in `src/dev/service-route.ts`.
- **The service password is read at runtime from
  `~/.local/state/opencode/service.json` and is never committed, logged, printed or sent
  anywhere.** No copy of it is in this repo.
- **Recordings are sensitive** — prompts, paths, command output. `fixtures/raw/` is
  git-ignored; only scrubbed fixtures get committed.
- No file over ~400 lines. No mock state in any shipped path. MIT-compatible deps, `bun`.

## Three bugs worth remembering

1. **The stale field name.** The parallel branches were split at a frozen interface;
   after a field was renamed on one side, the other side's new function still read the
   old name. 127 tests passed. **`tsc` caught it.** That is what the typecheck rule is for.
2. **The unmounted route.** The dev credential route was registered under a config key
   that Vite does not have, so it never mounted and the page could never connect. Every
   unit test passed, because the handler was tested against a raw `node:http` server.
   **Only starting the dev server showed it.** It was also invisible to typecheck because
   `vite.config.ts` was not in the tsconfig `include` — now it is.
3. **The wrapped payloads.** The page assumed bare arrays from `/api/session`,
   `/api/permission/request` and `/api/form`. They actually return `{ data: [...] }`.
   Found in the same run that fixed 2.

## Rulings someone must own

Twenty-two were made; every one is in the ledger with its cost. The ones that still
shape the code:

- **A desk tracks every open permission request** (`openPermissions: string[]`), not just
  the first — the platform can hold several and surface them one at a time.
- **The terminal-state settle belongs to the caller, not the reducer.** The reducer holds
  `success`/`failure` and has no timers; `settleDesk` is pure and the page runs the hold.
  A reducer-only test suite cannot detect its absence, because the bug is silence.
- **"Waiting on another worker" means a parent whose child session is busy** — not
  `session.inbox.*`, which every prompt passes through.
- **The room's rect carries the status colour**; there is no dot or badge.
- **`draw` deliberately has no unit test** — a mocked 2D context verifies the mock, not
  the picture.
- **The narrative owns the primary data model and the floor is one of its renderers**:
  a *scene* is `{ id, location, cast, beats }`, a *beat* is `{ id, at, eventIDs, kind, line }`.
- **Sequence: script, then floor, then staged animation.** Animation is where this dies
  if it starts there.

## What is deferred, and what was never verified

Deferred minors were triaged by the final review as **all shippable**. The two that
matter when they next come up:

- **`setSnapshot` discards the registry's tombstones and parent links.** Dormant today
  because it runs once before any live frame. It becomes a real bug the moment the spec's
  re-snapshot-on-reconnect is wired, and **must be fixed in that same change.**
- **`?? []` on the seed unwrap silently swallows a shape regression** — the room would
  seed zero desks while still reading "live". An `Array.isArray` guard would make it loud.

Never verified by anyone: **browser rendering and live SSE.** Everything green here is
green against recordings and a `curl`, not against pixels. Run `bun run dev` with
`opencode serve` and watch a desk appear — that is the cheapest way to retire it.

## Next

**The narrative layer, and it needs a plan.** Its design is written and reviewed
(revision 3). Its own suggested first slice is: re-record with the frame fields the
narrative needs, then the pure `rollup` with golden tests, then template lines rendered
as a script beside the floor — the Director, jokes and all, comes last on purpose,
because a joke on top of an uncited line is the one failure that design cannot recover
from.

Two of its preconditions are already met: `Frame` now keeps `created` and `location`,
and the room reads only `status`, so the narrative can be added without disturbing it.

**One investigation does need doing before the rollup's rules are final:** §4.1 flags
that `tool-fails` probably misses real failures, because a non-zero shell exit may
arrive as a `tool.success`. Record a deliberate failure of each tool and settle it.

**Owner decisions still open** (§12 of the narrative design): the tone; whether an
episode is a chat or a project; who the Human is; where model calls run and with what
key and budget; how series are stored; and whether there are seasons, and where the
script lives once the floor becomes the stage.

## If you are a different harness

Nothing here is OpenCode-specific. It is a TypeScript/Vite project with test-first plans
written to be executed task-by-task by an agent that has not seen the project. Any agent
that can read a markdown plan, run two commands, and write a failing test before an
implementation can carry this on.

To make these conventions load automatically, copy **Conventions** and **Three bugs worth
remembering** into `AGENTS.md` (OpenCode) or `CLAUDE.md` (Claude Code).

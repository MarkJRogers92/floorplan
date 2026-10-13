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
button — **with a script beside it narrating the work**. Every script line traces to
the beats it cites (hover a line to see them); every beat traces to its event ids.
Nothing else. The rail, the transcript and permission-answering are **not**
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
| `src/narrative/rollup.ts`, `calls.ts`, `silence.ts` | **the narrative rollup** — frames to beats, pure and deterministic |
| `src/narrative/types.ts` | `Beat`, `BeatDetail`, `BeatKind`, cast and rollup state |
| `src/narrative/line.ts`, `vocabulary.ts` | slots, the lint, delivery marks |
| `src/narrative/templates.ts` | one template per beat kind, in the settled voice |
| `src/narrative/cast.ts` | root resolution and cast ids, suffixed within each chat |
| `src/narrative/script.ts` | beats to script lines, dropping rejected ones |
| `src/narrative/scene.ts`, `episode.ts` | single-location scene cuts; one episode per root chat |
| `src/narrative/check.ts`, `views.ts` | scene evidence checks and the pure episode view used by the page |
| `src/narrative/director.ts`, `director-runtime.ts` | pure model-output admission and nonblocking closed-scene scheduler |
| `src/dev/director-*.ts`, `src/app/director-client.ts` | server-only paid boundary and browser-safe controls client |
| `src/narrative/scope.ts`, `series.ts`, `bible.ts` | project identity, additive archive validation and evidence-backed character statistics |
| `server/series-store.ts`, `src/dev/series-route.ts`, `http-guard.ts` | private atomic local files and guarded loopback archive/context routes |
| `src/app/series-client.ts` | nonblocking live milestone saves, read-through context and visible storage status; no replay saves |
| `src/app/cast-memory.ts` | validated displayed-context projection and current-cast memory cards; no fabricated identities or recap lines |
| `src/narrative/recap.ts`, `src/app/recap-client.ts`, `script-view.ts` | bounded earlier-footage proof montage, reset-safe local reads and text-safe script/memory/recap DOM |
| `src/room/stage.ts`, `assets/worker.*` | reception-clock reaction cues and layered, hand-authored five-pose monitor-clerk sheet |
| `src/room/{layout,room}.ts` | pure geometry, then canvas drawing |
| `src/app/floor.ts` | `createFloor` — the object the page owns |
| `src/main.ts`, `index.html` | the page — script primary column, floor panel beside it |
| `src/dev/service-route.ts`, `vite.config.ts` | the dev-only `GET /__service` credential route |
| `fixtures/narrative/four-events.jsonl` | scrubbed golden recording: a failing command, a denied permission, a 40 s gap, a resumed chat |

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

**Browser verification (slice 2):** the actual page connected live to the local OpenCode
server, then replayed the golden 204-frame recording to completion: one episode,
twelve scenes, forty-four lines, zero checker failures, five explicit flashbacks.
The failed shell exit, denied permission and forty-second gap remained visible in
the DOM. Script and floor measured side by side, and the canvas contained drawn
pixels. **Pixel-by-eye review remains unverified:** the desktop browser window was
hidden and the screenshot tool refused capture. Hover/focus citation visibility also
needs a visible-window check; citations are present in the DOM.

## Next

**The narrative layer's slice 1 is merged** (6 tasks, 220 tests). **Slice 2 is
implemented** (5 tasks, 280 tests; independent MiniMax review found no blockers): beat end timestamps,
guarded absence slots, single-location scenes, chat-based episodes, the §5.2 checker,
and episode/scene rendering beside the unchanged floor. Real quoted speech and explicit
flashback markers are rendered distinctly. That slice was template-only; the optional
Director and local continuity are described below.

**Director runtime (slice 3a) is implemented:** optional checked scene replacement,
separate server-only key, explicit configuration AND page opt-in, conservative 3¢
reservations, 30¢/chat and $1/server-run default caps, global disable and per-chat opt-out,
single-flight/deduplication and stale-response protection. Setup/privacy/limits are in
`docs/director.md`; `.env.example` contains no key. All tests use synthetic providers;
no real key was configured and no paid generation was performed.

**Series continuity is implemented:** root-project-scoped private archives survive
reloads/restarts, partial rejoins merge without deleting old beats, and character bibles
retain exact evidence refs. Live scene boundaries/wraps save asynchronously; unknown
scope and replays remain unarchived. Replays also omit durable identity from Director
requests, so an opted-in replay cannot write personas through that second path.
The existing Director completion reuses bounded advisory history and may save a
write-once invented persona with an archived debut; no extra model call is added.
See `docs/continuity.md` for privacy, bounds and safe failure behavior. No keys or paid
app calls were used in verification. The no-key golden browser replay stayed at zero
archived episodes and zero reserved cents (204 frames, 44 lines, 12 checked scenes).
The final continuity suite is **385 tests/40 files**, typecheck/build clean; server key,
provider endpoint and default archive path are absent from the browser bundle.
DeepSeek API independently reviewed the whole branch and ran380 tests plus synthetic
adversarial checks. Its one Important finding (abandoned transient terminal saves) was
fixed with failing-then-passing tests: latest cumulative snapshots retry every30s,
new footage coalesces, and replay/reset cancels pending retries. Pending saves are
in-memory only; keep the tab open until saved. Actual local REST seed returned50rows,
all with recognizable directory/project scope; only categorical counts were inspected.

**Continuity rulings:** normalized root-owned keys only (no redundant raw scope fields);
canonical raw agent names, never suffix stripping; semantic beat conflicts reject the
whole update but key ordering is irrelevant; required key/root and up to8 repeated
agent params, unknown path wins before method; exact compact JSON bounds and no
readonly permission weakening. Changing these requires explicit schema/API migration,
not destructive repair. Local Director requests keep eventIDs for immutable debut
proof; provider strips them, and dense32KiB requests safely become templates. Replays
omit durable scope (no context/persona persistence, and cached live lines may become
templates); existing enabled fresh-replay spend remains opt-in/capped and is disclosed.
No key or window-unlock workaround was used; paid humor acceptance/by-eye art remains
unverified. Existing cache lifetime/lifecycle/DOM/cast limits and identity-length caps
remain unchanged, with refusal/template fallback rather than guessed evidence.

**Continuity deferred minors:** cumulative2MiB/10,000-beat episode limit stops later
saves while keeping prior history; conflict/full diagnostics can overgeneralize validation errors; crash-left
temp files, stale-lock UI guidance and extra per-frame scene/grouping work need focused
follow-up. Success already clears its failed-snapshot marker; the review's contrary
claim was checked against `failed.delete(id)`, not accepted as a bug.

**Cast memory follow-up:** live episodes now consume read-through context in a collapsed
native disclosure, labeling saved personas as invented with their exact stored debut,
and displaying previous archived episode IDs. Cache identity includes project AND root;
initial/agent-change reads and save refreshes are independent of writing, and late,
superseded or replay/reset results are discarded. The page only displays current known
agents, projects displayed fields from validated context, uses textContent, preserves
open disclosure state across script rebuilds, and keeps empty/replay memory absent.
No dependencies/provider calls/archive edits/art changes. Synthetic real-page browser
checks verified two-root isolation, literal markup-like agent names, invented labels,
debut references, open-state persistence, and replay with no new GET/POST or cards.
The follow-up final suite is407 tests/41 files with typecheck/build clean; private server
data remains absent from the browser bundle. Browser boundaries were synthetic and
no archive/provider calls were made by the test harness; by-eye appearance is unverified.
Independent Space Bunny review ran405 tests/typecheck and found two Important issues,
both fixed RED→GREEN: keep last-good context during new-agent refresh (native disclosure
stays open), and only read history for roots with observed footage (200 metadata-only
roots now cause zero GETs, one visible root causes one). A delayed-read real-page guest
arrival regression confirms the panel stays open before/after refresh and gains the
guest's history. Native focus/click worked, but browser key presses delivered no DOM
key events; actual keyboard activation still needs a visible-window check.
Deferred follow-up minors: unchanged failed reads wait for save/cast change and full
bible responses can hit the2MiB context cap; shared read/save status messages replace
one another; last-agent status updates are cosmetic; original browser assertions are
recorded as structural checks rather than a shipped browser runner (the new guest
refresh assertion is retained in the scratch harness).

Recaps, plot labels and staged visuals remain next. Before extending episode lifecycle, read the slice-2 execution notes;
that plan's original timeout contradicted D2 and was not implemented.
The same notes record final review rulings and deferred minors. In particular,
`{never:}` requires episode-wide closure (not scene closure), full DOM rebuilds may
need measured optimization for long sessions, and unseen-session cast learning is
an existing edge case to fix with reconnect/seed handling. Director counters reset
on server restart, so provider-side limits are separately required. Do not call the
runtime cap a daily/lifetime budget, or equate provider budget alerts with hard limits.

The `tool-fails` rule is settled by evidence, not intuition: a non-zero shell exit
arrives as `tool.success` carrying `metadata.exit` (verified on the wire, with the
`shell.exited` join arriving 22 ms *after* the success) — so the rule reads the
success first and falls back to the join.

**Owner decisions are settled** in §12 of the narrative design: deadpan/dark tone;
a chat is an episode and a project is a series; the unseen audience is not a character;
Director calls use an opt-in separate key through the dev route, provider/code spending
caps and per-session opt-out; files hold series continuity; no season numbering;
script first, floor alongside. A resumed chat never becomes a made-up Part Two.

## If you are a different harness

Nothing here is OpenCode-specific. It is a TypeScript/Vite project with test-first plans
written to be executed task-by-task by an agent that has not seen the project. Any agent
that can read a markdown plan, run two commands, and write a failing test before an
implementation can carry this on.

To make these conventions load automatically, copy **Conventions** and **Three bugs worth
remembering** into `AGENTS.md` (OpenCode) or `CLAUDE.md` (Claude Code).

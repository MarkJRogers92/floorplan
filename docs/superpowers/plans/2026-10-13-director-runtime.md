# Director Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in model narration for closed scenes, always checked and bounded by spending limits.

**Architecture:** A pure output validator fills unsupported lines with templates. A server-only provider/service/HTTP boundary owns secrets, opt-in, reservations and cancellation. A small client scheduler requests closed scenes without blocking the floor and supplies checked replacements to the existing pure view.

**Tech Stack:** Existing TypeScript/Vite/Vitest/Bun; native fetch, no SDK/dependency.

**Spec:** `docs/superpowers/specs/2026-10-13-director-runtime-design.md`, plus narrative design §4.2/5/7/D6.

## Global Constraints

- OpenCode is never modified. No key configured or real paid verification calls.
- Fixed model, no retries, secrets only server-side in ignored `.env.local`.
- 3 cents reserved per attempt; 30 cents/chat and 100 cents/server-run defaults.
- Pure narrative functions; clocks/I/O only runtime/dev boundary. No runtime `node:`
  imports in client code; dev handler's type-only node:http follows existing exception.
- Full tests and typecheck before commits. No file over ~400 lines, no dependency.

## Review Focus

1. Repeated scene submission and concurrent races cannot spend twice or exceed caps — Task 2.
2. Cross-origin/forged Host/oversized HTTP input cannot reach provider or leak key — Task 2.
3. Disable/opt-out/replay/cast changes during flight cannot display a late narrative — Task 3.
4. Dropping an invalid joke cannot bury failures or lose ordinary footage — Tasks 1/4.
5. No-key startup, provider refusal/truncation/network failure and absent dev routes all
   keep templates/floor working, with no real provider traffic — Tasks 2/4.

### Task 1: Pure output contract

**Files:** Create `src/narrative/director.ts`; test `tests/narrative/director.test.ts`.
**Interfaces:** `checkDirectorLines(scene: Scene, output: unknown, beats: Beat[],
sessions: SessionInfo[]): {lines: ScriptLine[]; mode:'director'|'templates'}`.
Uses existing renderLine/checkScene/assembleScript/castByRoot. Generated IDs. Unknown,
empty, cross-scene/malformed payloads are rejected. Valid narration can condense cites;
independent missing-beat templates preserve full coverage. Invalid composition uses
whole-scene templates with explicit backdated flashbacks. Ban unsupported episode slots
and dynamic factual names/outcome words outside slots.

- [ ] Write tests for honest condensed output and real quote; malformed/empty output;
  bad cite/speaker/slot; missing ordinary/failing beat; false dynamic name/outcome;
  explicit and unmarked flashback. Assert every beat survives via cites.
- [ ] Run `bun run test tests/narrative/director.test.ts`; expect missing module failure.
- [ ] Implement pure validator and template fallback.
- [ ] Run targeted suite and full `bun run test`, `bun run typecheck`; expect pass.
- [ ] Commit `feat(narrative): validate Director lines with complete template coverage`.

### Task 2: Paid boundary

**Files:** Create `src/dev/director-input.ts`, `director-provider.ts`, `director-service.ts`,
`director-route.ts`; test `tests/dev/director.test.ts`, `director-route.test.ts`.
Modify `vite.config.ts`, `.gitignore`; add `.env.example` and `docs/director.md`.
**Interfaces:** `parseDirectorRequest(unknown): DirectorRequest | undefined`;
`createDirectorService(config, complete)` exposes `state()`, `control(enabled)`,
`optOut(rootID, disabled)`, `direct(request)`; `createDirectorHandler(service)` mounts
relative `/state`, `/control`, `/opt-out`, `/scene`. Provider `complete(request,signal)`
uses fixed snapshot/schema/output caps; one real fetch only, bounded response read.
Read config only in Vite with loadEnv non-VITE_ prefix; no browser import of dev code.

- [ ] Write failing tests for no-key/paused gating; integer caps, failure charging,
  dedupe, busy rejection, opt-out/disable abort and stale results. Test real HTTP handlers
  against local node:http: matching origin succeeds, forged host/cross-origin/oversize/
  invalid shape/method fail with generic errors and no provider invocation. Test actual
  provider request/response decoding with fake fetch only, no remote traffic.
- [ ] Run `bun run test tests/dev/director*.test.ts`; expect missing module failures.
- [ ] Implement boundaries, middleware, ignored env and setup docs; no secret available.
- [ ] Full test/typecheck/build; build with synthetic secret confirms it is absent.
- [ ] Commit `feat(dev): add opt-in Director route with conservative spending caps`.

### Task 3: Nonblocking scheduler

**Files:** Create `src/narrative/director-runtime.ts`; test `tests/narrative/director-runtime.test.ts`.
**Interfaces:** `createDirectorRuntime(request, changed)` returns `update(beats,sessions,flush?)`,
`setEnabled`, `setExcluded(rootID,disabled)`, `reset`, `results()`.
Request takes a DirectorRequest and AbortSignal, returns unknown candidate output.
One active/one latest queued scene; only closed scenes; each scene attempted once.
Evidence signatures and epochs invalidate changed cast/footage or replay replies.

- [ ] Write failing tests using manually controlled deferred promises for open/closed,
  duplicates, newest queued, disable/opt-out/reset/cast changes, request rejection;
  inspect accepted cite-backed results, never assert only on a mock.
- [ ] Run targeted tests; expect missing module failure.
- [ ] Implement scheduler, no timers or paid calls in tests.
- [ ] Full test/typecheck; commit `feat(narrative): schedule closed scenes without blocking work`.

### Task 4: Page controls and replacement

**Files:** Modify `src/main.ts`, `index.html`, `src/narrative/views.ts`;
test `tests/narrative/page.test.ts` additions; update `HANDOFF.md`.
**Interfaces:** Optional replacement map to `assembleEpisodeViews`; replacements
revalidated against current scene/context. Page fetches public state, remains disabled
until button action; global disable and per-chat opt-out affect both server/client.
Unavailable route/key is template-only, not a fatal floor error.

- [ ] Write failing view tests for checked replacement, forged/stale replacement and
  critical-beat coverage; retain real golden replay with no replacements.
- [ ] Run tests; expect unchanged template rendering where replacement required.
- [ ] Wire opt-in controls, disclosure, status/budget state and checked scene replacement;
  flush/reset scheduler on replay. No credentials in browser state or source.
- [ ] Full suite/typecheck/build; actual no-key dev state/page and golden replay. No paid
  provider test; record pixel-review limitations honestly.
- [ ] Commit, independent read-only cross-family review, verify findings and final tests;
  merge/push under the owner's existing authorization, preserving unrelated branches.

## Pre-flight

1→2/3/4 crosses the checked output contract; 2→3 request type and public response shape;
3→4 controls/results; 4 retains pure scene checker and complete golden coverage.
No persisted series or true episode-closure state: do not enable `{never:}`.
Execution is Sol directly, already authorized; no new approval pause.

## Execution notes

Wire request/response/state types live in pure narrative/director.ts. Server applies
the admission checker, returns `{mode,lines,reason}`, and client/runtime/view recheck
before display. The complete per-chat session snapshot is sent (no 128-row slicing);
oversize/non-finite/corrupt footage is skipped to templates rather than rounded or
silently changed. Default request targets 1–6 short lines within 1,024 output tokens;
24 is a defensive array ceiling, not an output target. Vite CORS is explicitly disabled.

A tiny tested app/director-client.ts owns same-origin calls/public-state parsing;
markFlashbacks in script.ts is shared by template admission/view code. Director lines
must explicitly flag backwards ordering; the view never repairs model chronology.
Both are bounded implementation clarifications, not new features. Builder check:
mark-deepseek; primary implementation GPT-6.1 Sol.

Per-task full suites: 298, 317, 328, 334 tests before final review. Typecheck passed
before commits. Synthetic-key builds confirm neither the sentinel key nor the server
provider endpoint appears in dist. No real model call was made. Actual dev state with
no key: available=false, enabled=false, reservedCents=0, caps30/100. Browser enable
button is disabled and status is template-only. Pixel review remains separate from
DOM/browser evidence if the desktop window is hidden.
Actual no-key golden browser replay completed: 44 lines, 12 scenes, 0 check failures,
0 Director scenes, 0 cents reserved; failing exit/denial/40-second gap preserved.
Screenshot was refused again because the desktop window was hidden.

# Recaps and Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline with isolated pure-model workers and one final whole-branch review.

**Goal:** Give live episodes an honest earlier-footage montage, then stage real-beat reactions.
**Architecture:** Separate pure recap selection/proof and stage cue clock; guarded read-only archive endpoint and abortable page client; reuse existing narrative checker, DOM renderer and room truth. Hand-authored live Aseprite poses are a separate art deliverable.
**Tech Stack:** Existing TypeScript/Vite/Vitest/Bun/Canvas/Aseprite only.
**Spec:** `docs/superpowers/specs/2026-10-13-recaps-design.md`, `2026-10-13-staged-reactions-design.md`.

## Global Constraints
- No provider app calls, paid art generation, key setup, dependencies, archive edits or fake work.
- Public code/synthetic worker inputs only; no private archives/recordings/env/service credentials.
- Recap max3 moments/2 episodes/65,536 UTF8 bytes; per moment12,000 bytes/rendered text240chars; partial label always.
- Known root/key/earlier timestamps only; current root/replays excluded from history reads.
- Stage2,000ms cues, offsets[-3,3] integers, reduced motion0/0; no deleted/fake actors or recap-driven poses.
- Main<400lines, same guards/spend/desk status rules; live art only, batched/inspected/validated/exported.

## Review Focus
1. Different episodes sharing beat IDs must retain independent proof and actor names.
2. Unknown/future/equal timestamps, resumed chats and partial archives must not create false chronology/completeness.
3. Recap/cast callbacks cannot write archives, spend or drive current-stage cues; reset/replay rejects late reads.
4. Child cues/deleted sessions/clock resets/reduced motion cannot misrepresent desk truth or create ghost actors.
5. Unready art/image loading/layout edges must preserve usable floor and honest completion claims.

### Task 1: Pure recap model (DeepSeekAPI)
**Files:** `src/narrative/recap.ts`, `tests/narrative/recap.test.ts` only.
**Interfaces:** RecapMoment/Recap/buildRecap/parseRecap/recapLines exactly per spec; reuse castFor/assembleScript/parseEvidence.
- [ ] Builder-check spec, write selection/parser/proof tests, observe RED, implement bounded deterministic montage and rechecked lines, GREEN/typecheck.
- [ ] Sol integrate/full suite/typecheck; commit pure model/spec/plan.

### Task 2: Read-only serving/client/rendering (Sol)
**Files:** series-route/store-hook tests; new `src/app/recap-client.ts` and tests; `src/app/script-view.ts`; main/index/docs.
- [ ] Real temporary-store HTTP RED tests for earlier-scope proof, no writes, guards, invalid clock, corruption.
- [ ] Add /recap to existing handler using store.load + buildRecap; no store API/schema change.
- [ ] Client RED tests: observed timestamped roots, cutoff/key signatures, no repeat/POST, unknown/replay/reset/superseded/failure; review refinement adds at most three30s transient retries, permanent-proof/archive refusal and timer/in-flight cancellation.
- [ ] Implement client independent of save/Director; extract existing DOM render helpers preserving memory disclosure/opt-out/citations; add safe proved recap section.
- [ ] Full tests/typecheck/build/privacy scan and actual synthetic page evidence; commit.

### Task 3: Stage cues (SpaceBunny pure worker; Sol render)
**Files:** worker only `src/room/stage.ts`, `tests/room/stage.test.ts`; Sol room/main/index/geometry tests.
- [ ] Pure worker observes RED→GREEN for kind/child actor/ref/dedupe/clock/expiry/reset/reduced motion/offset bounds.
- [ ] Room own-cell geometry RED→GREEN; integrate new arrived beats only and existing desks/status palette, caption citations and reduced-motion preference.
- [ ] Full suite/typecheck/build and actual canvas/SSE/replay/history-isolation evidence; commit.

### Task 4: Live hand-authored poses and final verification (Sol)
**Files:** artist-created `assets/worker.aseprite`, `assets/worker.png`/atlas JSON; room sprite loading; docs/HANDOFF.
- [ ] Read artist resources, fresh ready preflight, new document/info, existing palette, batched5pose drawing.
- [ ] Look at1x/2x, fix only observed issues, validate, live save/export (no file fallback). Integrate atlas nearest-neighbour with rectangle fallback.
- [ ] Full suite/typecheck/build/key-sentinel/private-data scan; final independent read-only review across whole branch, one TDD blocker-fix pass, ledger remaining minors.
- [ ] Keep dependency-free DOM/canvas regression tests in tracked tests/, alongside the actual synthetic-page checks.
- [ ] Owner-authorized integration/push after fresh merged verification; report actual art/model/tests/limits.

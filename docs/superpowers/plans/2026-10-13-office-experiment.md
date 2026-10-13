# Office Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans with independent bounded renderer/demo workers.

**Goal:** Turn the working control panel into a playful office with one prompt and a free demo.
**Architecture:** Keep verified live APIs/runtime/proof checks; original Canvas set dressing and responsive paper UI. Explicit demo is locally isolated replay, never a mock engine or model call.
**Tech Stack:** Existing TypeScript/Vite/Vitest/Canvas/DOM; installed Chrome for visual QA only.
**Spec:** `docs/superpowers/specs/2026-10-13-office-experiment-design.md`.

## Global Constraints
- Demo labelled fictional, no API/history/Director calls or files changed; old generations canceled.
- Current server folder visible, no `/`/random folder; only eligible `build` defaults, no model/permission override.
- Office6 visible real actors, overflow counted, integer pixels; existing80x20 clerk PNG unchanged.
- No dependencies/remote fonts/copied Munder assets/premium workers/provider acceptance traffic.
- Keep permission gates visible and all prior retry-ID/epoch/replay/cost protections; main<400lines.

## Review Focus
1. Demo with enabled Director/late live callbacks cannot spend, archive or pretend current work.
2. Automatic project/lead preparation cannot silently pick wrong folders/paid/hidden agents.
3. Responsive settings/disclosures cannot hide approvals or strand Stop/Return-live.
4. Room overflow, long names and tiny viewports cannot create ghost employees or imply completion.
5. A polished screenshot must come from the actual application, not a disconnected pretty mockup.

### Task1: Original office renderer (DeepSeekAPI)
**Owned:** src/room/office.ts +tests/room/office.test.ts; room.ts +room-draw.test.ts. Others untouched.
**API:** createRoom(canvas,worker?).draw(desks,frames?,names?:ReadonlyMap<string,string>); old twoarg callers work. officeLayout(count,bounds) supplies bounded integer logical stations+scale/overflow. Keep statusColour/reactionRect exports and semantics; legacylayout unchanged.
- [x] Literal visual-geometry/crop/status/emptyfurniture/overflow tests RED→GREEN, procedural furniture/light/setdressing, names+status, image fallback; no spritefile edits/tool calls.

### Task2: Local fictional demo (DeepSeekAPI separate worker)
**Owned:** src/app/demo.ts + tests/app/demo.test.ts only.
**API:** demoFrames():Frame[] (fresh array); createDemoPlayer(push,finish):{play():void;cancel():void;running():boolean} ~20s/cancel safe/restart safe, no imports beyond Frame; explicit fakeclock timer tests, no IO/fetch/private data.
- [x] Trace kinds, monotonic synthetic clocks/guest/failedretry/approval/wrap evidence; mutation/fake-timer cancellation RED→GREEN.

### Task3: One-prompt office UI and integration (Sol)
**Owned:** index/style.css, work-client/work/panel +tests; main/replay-controls; docs/HANDOFF; QA harness.
- [x] DefaultLocation/project-label/default-build tests RED→GREEN without weakening existing strict setters or activejob authority.
- [x] Office-first warm responsive layout, friendly project select, compact composer, settings/manual agents/path, visible permission cards; preserve safe texts/citations/disclosure/draft.
- [x] Demo mode lifecycle/zero-network policy/replay cancellation tests RED→GREEN; main integration/generation guard, optional?demo=1 offline preview.
- [x] Actual demo screenshots via installedChromeisolatedprofile, inspect1x/2x/desktop/narrow; actual synthetic live job controls, regression counts; fix observed issues.
- [x] Independent cross-family wholefeature review, full suite/typecheck/build/privacy/diffcheck, docs. Report models/limits honestly.
- [x] Owner authorised pull/merge/push; integrated into main with fresh merged checks.

# Cast Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, with one isolated pure-model worker and one final whole-branch reviewer.

**Goal:** Show saved fictional character continuity on live episodes without turning the script into a dashboard.
**Architecture:** A small browser-safe context projection supplies cards. The existing client reads per root/project and the page renders a collapsed native disclosure.
**Tech Stack:** Existing TypeScript/Vite/Vitest/Bun; no dependency.
**Spec:** `docs/superpowers/specs/2026-10-13-cast-memory-design.md`.

## Global Constraints
- No provider calls/key configuration/art changes/archive edits.
- Public code/synthetic worker inputs only; no actual archives or service credentials.
- Replay/unknown roots never read history; current-root appearances excluded.
- Current real cast only,8 agents; personas labeled invented with exact debut refs.
- Preserve saves/retries/spend guards and native accessibility/text safety.
- Existing dedicated host checkout, clean feature branch off e22e2d6; no sibling cleanup.

## Review Focus
1. Two live roots of one project must not share root-excluding cached history.
2. Initial/slow/failed context reads must not delay saves or produce false saved status.
3. Reset/replay/superseded agent lists must reject late GET results.
4. Malformed context/unknown agents must never produce invented facts or unsafe markup.
5. Open disclosure must survive repeated script rebuilds; empty/replay memory stays absent.

### Task 1: Pure displayed-context projection
**Files:** `src/app/cast-memory.ts`, `tests/app/cast-memory.test.ts` (worker only).
**Interfaces:** `CastMemoryContext`, `parseCastMemoryContext(value:unknown,key:string,root:string):CastMemoryContext|undefined`; `castMemoryCards(context:CastMemoryContext|undefined,agents:string[]):{agent:string,episodes:string[],persona?:Persona}[]`.
- [ ] Write tests: valid projection, wrong key/IDs/counts/duplicate agents/current-root episodes rejected; saved current-root debut allowed; current real agent order/dedupe/max8, unrelated/unknown/empty omitted, exact debut text retained.
- [ ] Run affected tests RED, implement only displayed fields with existing validators, run GREEN/typecheck.
- [ ] Full suite/typecheck before integration commit. Worker must not commit or edit other files.

### Task 2: Root-scoped reads and page disclosure
**Files:** `src/app/series-client.ts`, `tests/app/series-client.test.ts`, `src/main.ts`, `index.html`, docs/HANDOFF.
**Interfaces:** client consumes Task1 parser, produces `contextFor(key:string,root:string)`; page consumes filtered cards plus observed episode root/scope/cast.
- [ ] Failing tests: before-milestone GET/no POST, distinct roots same project, repeated update dedupe, new-agent supersession, reset/replay abort, GET failure cannot retry/lose a successful POST; update old cache assertions to scoped getter.
- [ ] Implement separate abortable GETs, scoped caches and acknowledged-save refresh; preserve retry queue. Seed read-through on REST metadata; rerender when context changes.
- [ ] Render compact native details with textContent, invented label/debut and previous episode IDs, preserve native open state; omit replay/unknown/empty cards.
- [ ] Browser synthetic context test for real page disclosure, safe text and preserved open state. Full suite/typecheck/build/key-sentinel scan; no default archive writes for tests.
- [ ] Independent read-only review, TDD fix Important/Critical only, document limits/minors, full verification, owner-authorized integration/push.

# Series Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist project episodes and reuse evidence-backed character history/personas.
**Architecture:** Pure scope/archive/bible types feed a server-only atomic file store.
A same-origin client saves live episode snapshots without blocking work; Director
requests optionally use bounded archived context and write-once invented personas.
**Tech Stack:** Existing TypeScript/Vite/Vitest/Bun and Node standard library; no dependency.
**Spec:** `docs/superpowers/specs/2026-10-13-series-continuity-design.md` and narrative §5.5/D7.

## Global Constraints
- No OpenCode changes, key configuration, real app paid calls, or private material to workers.
- Episodes remain chats; project identity comes from footage/snapshot, never client cwd.
- Private local files, no destructive archive eviction/migration or silent corruption overwrite.
- Bounds2MiB request/32MiB archive; preserve all existing Director spend/opt-in protections.
- Full tests/typecheck before commits. Separate worker files; Sol owns I/O and integration.

## Review Focus
1. A partial rejoin/save cannot truncate older episodes/beats or inflate bible counts — Tasks1/2.
2. Directory/project fallback and child sessions cannot mix unrelated projects — Tasks1/4.
3. Forged paths, symlinks, corrupt JSON, locks and oversized data cannot destroy history — Task2.
4. Disabled/no-key/replay/storage failure cannot trigger model spend or block the floor — Tasks3/4.
5. Personas persist once with real debut refs, never replace counted facts or bypass checks — Tasks2/3.

### Task 1: Shared archive model and computed bibles
**Files:** `src/narrative/series.ts`, `scope.ts`, `bible.ts`; tests `tests/narrative/series.test.ts`, `scope.test.ts`, `bible.test.ts`; modify types/rollup.
**Interfaces:** `ArchivedEpisode`, `Persona`, `SeriesArchive` per spec;
`parseArchivedEpisode(unknown)`, `parseSeriesArchive(unknown)`; `mergeEpisode(old,next)`
preserves first-seen IDs and rejects conflicting beats; `seriesKeyForRoot(root,sessions)`;
`computeBibles(episodes):CharacterBible[]`, metrics with `{episodeID,beatID}` refs.
- [ ] Write failing tests for scope priorities/unknown/guests, additive merges/immutability,
  unknown kinds/nonfinite/cyclic metadata and exact bible counts/refs/unknown identity.
- [ ] Run affected tests, expect missing modules/behavior failures.
- [ ] Implement pure model/scope; isolated worker may implement only bible.ts/tests.
- [ ] Full suite/typecheck; commit `feat(narrative): model stored episodes and citable character bibles`.

### Task 2: Safe local store and route
**Files:** `server/series-store.ts`, `src/dev/series-route.ts`, `http-guard.ts`; tests `tests/dev/series-store.test.ts`, `series-route.test.ts`; Vite mounts, Director guard reuse.
**Interfaces:** `createSeriesStore(root?)` → `load(key)`, `saveEpisode(episode)`,
`savePersonas(key,episode,proposals)`, `context(key,currentRoot,agents)`; context contains
computed bibles and validated personas, not full old quotes. Default lazy directory at D7.
- [ ] Real temp-fs failing tests: additive persistence across instances, corrupt file
  intact, symlink/file/lock refusal,0600/0700, concurrency lock and temp atomic failure.
  Real HTTP tests assert loopback/origin/body protections and no arbitrary disk paths.
- [ ] Run tests RED; implement bounded, exclusive-lock, atomic store and middleware.
- [ ] Full tests/typecheck/build and unchanged Director boundary tests; commit.

### Task 3: Continuity in the existing Director call
**Files:** Director request/runtime/input/provider/service; tests additions in existing dev/Director suites.
**Interfaces:** optional `seriesKey`; injected async context/profile hooks on server service;
provider accepts bounded continuity and schema `personas` alongside `lines`. No extra call.
- [ ] Failing fake-provider tests: previous-root-only context, no key no history/model,
  one completion creates a profile once, later suggestion cannot rewrite it, invalid
  story/debut/storage errors keep checked lines and caps; late disable still rejected.
- [ ] Implement hooks/context prompt/schema with unchanged pricing/output ceilings.
- [ ] Full tests/typecheck/build, secret/provider endpoint absent from dist; commit.

### Task 4: Live persistence/read-through status
**Files:** `src/app/series-client.ts`, main.ts/index.html; tests `tests/app/series-client.test.ts`; docs/HANDOFF.
**Interfaces:** nonblocking client observes live beats/sessions, builds per-root snapshots,
dedupes/saves serially, reads current project context; replay/reset invalidates stale UI.
- [ ] Failing tests: live archive update, same input no resave, partial snapshots safe,
  replay never saves, unknown scope skip, route errors visible and no blocking/calls.
- [ ] Wire scope metadata from REST/frame, local history status and Director series key;
  keep art/floor/rendering behavior intact. No private archive reads in workers.
- [ ] Full suite/typecheck/build and actual dev route/no-key golden replay with no
  history pollution. Independent read-only review; TDD fix blockers, ledger minors;
  integrate under existing owner authorization.

## Pre-flight / execution
1→2 archive types/validators;1→3 bible shapes;2→3 store hooks;1/2→4 root snapshots/routes;
3→4 optional seriesKey only, no changed no-key defaults. Bible worker owns two files
only and never commits; Sol integrates/tests. No overlapping writes. A fresh reviewer
checks the whole branch; no approval pause (owner already delegated execution).

# Prompt to Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans with one isolated API worker and one final independent review.

**Goal:** Submit a real project-scoped OpenCode job directly from Floorplan and steer it.
**Architecture:** Existing authenticated API; small validated/projection client and separate work-panel controller/DOM. Main connects callbacks and filters existing truthful renderers, never creates optimistic narrative events.
**Tech Stack:** Existing TypeScript/Vite/Vitest/native DOM and fetch only.
**Spec:** `docs/superpowers/specs/2026-10-13-prompt-to-work-design.md`.

## Global Constraints
- No dependencies/provider tests/private recordings/premium workers/permission override.
- Explicit absolute directory<=4096/noNUL, prompt<=16000chars, ID/agent<=256.
- API V2 documented contracts; fixed paths/auth only, no POST retries, explicit actions.
- Same message ID retained for explicit identical uncertain retry; no duplicate root.
- Replay disables mutations and invalidates obsolete playback; only real frames narrate.
- Text-safe views, projected agent metadata, selected job+children; last30messages/8000chars each labelled clipping.

## Review Focus
1. A prompt may have been accepted when its response is lost: no automatic resubmit/new job.
2. A project/selection/replay switch during a read/mutation cannot retarget a reply or leak stale UI.
3. Job selection cannot rewrite the saved session's directory/agent or select hidden workers automatically.
4. Child permission requests must keep owning session/request pair; no unrelated approvals.
5. Return-live/replay overlap must never play stale frames into live narrative or re-enable replay writes.

### Task1: Validated V2 work client (DeepSeekAPI)
**Files:** src/app/work-client.ts, tests/app/work-client.test.ts only.
**Interface:** createWorkClient(service:Service, request=authedFetch) returns projects(), agents(directory), create(directory,agent,title), session(id), prompt(sessionID,text,id), messages(sessionID), permissions(directory), reply(sessionID,requestID,decision), stop(sessionID).
**Types:** WorkSession={id,title,directory,agent?,parentID?}; WorkAgent={id,name,model?:string}; WorkProject={directory,label}; WorkMessage={id,speaker,text,truncated:boolean}; WorkPermission={id,sessionID,action,resources:string[],message?:string}.
- [ ] Builder-check spec and exact public/live OpenAPI schemas (metadata only), TDD literal wire/validation RED→GREEN, typecheck. No commits/subagents/other files.

### Task2: Work panel (Sol)
**Files:** src/app/work.ts and tests/app/work.test.ts (async control/state); src/app/work-panel.ts (native binding/DOM); index.html. Split state from DOM so races have dependency-free tests.
**Interface:** mountWorkPanel(element,changed,created) returns connect(service), updateSessions(rawSessions), push(frame), selectedID(), setReplay(boolean).
- [ ] Controller/DOM tests RED for prompts/actions/selection races/retry IDs/replay/refusal/safe permissions; minimal native controls and scoped reads GREEN.
- [ ] Start selection retained after failed send, real conversation disclosure and roster; no hidden settings/policy/model override.

### Task3: Main integration, verify and land (Sol)
**Files:** main.ts; src/app/replay-controls.ts, work-scope.ts and tests; docs/work.md, HANDOFF; synthetic browser harness.
- [ ] Wire service/REST/frame/replay callbacks; selected job filters draw/views, helpful empty state and Return-live generation guard. Keep main<400lines by extracting replay binding if necessary.
- [ ] Actual synthetic-page job start/followup/permit/stop/replay safety; no real executing prompt/paid test.
- [ ] Controlled real nonexecuting admission probe in one owned temporary directory (resume:false), exact ID/deduplication/scoped reads/idle interrupt, zero recorded cost; retain the test chat instead of destructive cleanup.
- [ ] Full tests/typecheck/build/bundle/privacy/diffcheck; independent read-only cross-family review, TDD blocker fixes.
- [ ] Fresh merged verification; normal push under standing authorization. Report actual model usage and real-execution limit.

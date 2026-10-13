# Start real work in Floorplan

Open the local page: an office, **Office chatter**, and **What should we work on?**

1. Check **Working on**. The initial folder is read from OpenCode's validated current
   location, not guessed from Floorplan's cwd or a random recent project. Full paths
   remain in the selector tooltip and **Office settings & real conversation**.
2. The lead defaults only to an eligible configured `build` agent. No build returned?
   Open **Office settings**, choose a visible primary/all lead, or use **Retry / load
   agents** if the project is still warming up. Hidden/subagent-only agents aren't offered;
   there is no arbitrary premium-model fallback. Models are displayed in settings.
3. Type your brief and click **Let's do it**. Your lead handles delegation.

Want to understand it before setup? **Watch demo** plays about20 seconds of explicitly
fictional office footage, with scripted jokes. It uses no models, engine APIs, file changes
or local archives; the persistent gold banner marks it as fiction. `?demo=1` starts offline
without even fetching service/Director metadata. **Restart demo** starts over; **Use my
project** reconnects to real work without sending anything. Watching does not stop live
jobs. Demo approval events are illustrative, not approval buttons. Director is disabled
locally for the demo, not globally for other tabs; real narration must be opted in again.

This creates a real OpenCode session and admits the prompt with execution enabled.
The selected agent handles the job using its existing configuration and instructions;
delegation is that agent's responsibility, not a new Floorplan quota-routing engine.
Tools may change files, and normal agent/model allowance or provider charges apply.
**You do not need a Director key.** Director only adds optional narration and has
separate limits; its30¢/$1 counters do not cap engineering work.

The job becomes selected automatically. The script and room focus on its real events
and observed children, rather than fifty idle historical sessions. **Send follow-up**
continues that exact session in its stored folder, without moving it or changing its
agent. **New brief** starts a fresh brief without stopping the previous job and keeps an
unsent draft. The **Current job** selector in settings resumes another observed root.
An API admission receipt means accepted input, not completed or successful work.

**Real conversation** shows the latest30 actual user/assistant messages, updated after
steps end or by **Refresh conversation & requests**. Long displayed messages are clipped
at8000 characters with a visible label. It is not replaced by fictional narration.
Selecting an older job does not reconstruct its entire historical script.

## Requests and stopping

Approval cards below the composer read requests for the selected job's project and display
requests owned by that root or observed descendants. Inspect the action, resources,
message and owning session, then choose **Allow once** or **Reject**. There is no
allow-always control or permission-policy override. A transcript read failure does not
hide valid approvals or lock Stop. Other/unlinked requests are counted with guidance
to review them in OpenCode; they are never silently approved.

Structured questions are currently labelled **answer in OpenCode**. Floorplan does not
invent answers or treat question forms as permissions. **Stop session** interrupts the
selected session with resume=false; an idle session is a reported no-op. It is not a
promise that every detached/background child task is stopped.

## Failures and replay

No POST is retried automatically. A lost response may still mean the server created
the job or accepted the input. Check the selected session and its real conversation
before retrying. After an uncertain prompt, an explicit identical retry uses the same
message ID; edited input is a new submission. The retry ID is held in this page's memory,
not durable across reloads. A failed send keeps the draft and known created session.

Replay/Director controls are under **Office settings → Recorded replay & optional Director**. Replay disables
job mutations, hides live conversations/requests and drops stale replay callbacks on
mode changes. It does **not** stop already-running live work. **Use my project** reconnects
and restores the selected job without sending a prompt. A Director request already
sent before changing job selection may still be charged; hidden jobs are excluded from
new Director evidence while one job is selected.

## Verified, and remaining limits

The real page was exercised against synthetic service boundaries: start, follow-up,
lost-response/same-ID retry, child approval/rejection, stop and replay/live isolation.
A real local API probe used an isolated temporary folder and **resume:false**: the engine
preserved the chosen folder/agent/message ID; a duplicate submission left one queued
input; message/permission response shapes were valid, recorded cost was0 and interrupt
reported idle. One nonexecuting test chat named “Floorplan API contract probe — no
execution” was retained, not deleted automatically. No real engineering/model execution
was used as acceptance evidence.

Full office art, individual characters, structured-question controls, transcript paging
and a quota router are not implemented. The first-pass original office draws up to6
observed actors and counts overflow; furniture is decoration, never a fake employee.
It reuses the approved five-pose monitor clerk. The room's initial REST permission
seed is still default-location-scoped; selected-job approval cards are correctly scoped,
but an older desk's initial colour can lag until new real events arrive.

The office pass adds actual isolated-Chrome desktop/mobile screenshot review, keyboard
typing/Tab/Enter admission, demo restart/completion/zero-API checks, late Director-response
epoch checks, visible approvals with settings closed, and startup metadata recovery.
The durable synthetic-only browser check is `tests/browser/office-check.mjs`: run Vite
on5175, launch a separate headless Chromium profile with localhost debugging port9229,
then `bun tests/browser/office-check.mjs`. It intercepts all engine/Director/archive routes;
it does not contact providers or execute an engineering prompt. Screenshots go to the
ignored `.superpowers/sdd/2026-10-13-office-experiment/` directory.
Final verification:591 tests/58 files, typecheck/build and browser self-check pass. A
real GET-only metadata check confirmed the non-root current folder and eligible build
lead; no prompt, write or model call. Independent review fixes cover overflow captions,
dramatised stage labels, phone notice width and failed-reconnect demo continuity.

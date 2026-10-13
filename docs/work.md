# Start real work in Floorplan

Open the local page and use **Give the team a job**:

1. Pick **New job**.
2. Choose a project directory from the suggestions, or enter its existing absolute
   folder path. It is not guessed from Floorplan's own working directory.
3. Choose a configured agent. If the list is empty while a new location warms up,
   click **Load / refresh agents**. The list contains visible primary/all agents,
   not hidden or subagent-only roles. Model names are shown when OpenCode reports them.
4. Type your request and click **Start job**.

This creates a real OpenCode session and admits the prompt with execution enabled.
The selected agent handles the job using its existing configuration and instructions;
delegation is that agent's responsibility, not a new Floorplan quota-routing engine.
Tools may change files, and normal agent/model allowance or provider charges apply.
**You do not need a Director key.** Director only adds optional narration and has
separate limits; its30¢/$1 counters do not cap engineering work.

The job becomes selected automatically. The script and room focus on its real events
and observed children, rather than fifty idle historical sessions. **Send follow-up**
continues that exact session in its stored folder, without moving it or changing its
agent. Use the Job selector to resume another observed root session or start a new one.
An API admission receipt means accepted input, not completed or successful work.

**Real conversation** shows the latest30 actual user/assistant messages, updated after
steps end or by **Refresh conversation / requests**. Long displayed messages are clipped
at8000 characters with a visible label. It is not replaced by fictional narration.
Selecting an older job does not reconstruct its entire historical script.

## Requests and stopping

**Requests needing you** reads approvals for the selected job's project and displays
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

Replay/Director controls are under **Replay and optional Director**. Replay disables
job mutations, hides live conversations/requests and drops stale replay callbacks on
mode changes. It does **not** stop already-running live work. **Return to live** reconnects
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
and a quota router are not implemented. The existing room's initial REST permission
seed is still default-location-scoped; selected-job approval cards are correctly scoped,
but an older desk's initial colour can lag until new real events arrive.

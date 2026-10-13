# Prompt to real work

Owner explicitly wants to enter a prompt in Floorplan and get agents working, not
type elsewhere and merely watch session tiles. Continue autonomously under existing
implementation/integration permission; Sol leads the connected control/permission UI.

## Smallest complete slice

Obvious labelled “Give the team a job” form: project directory (known-project suggestions
plus explicit absolute path), configured agent selector, multiline prompt, Start job.
No automatic submission, demo prompt or provider call during page startup/testing.
List agents for the chosen location; only visible primary/all agents, not hidden
subagent roles. Their existing agent/model configuration does the orchestration;
no new quota router, model replacement, permission overrides or premium auto-escalation.
Show agent model when reported, otherwise “configured model”; disclose real work/file
changes and normal provider costs separately from optional Director narration costs.
Project input is required and is never silently guessed from Floorplan's cwd.

Start creates a real root session at location.directory, with the chosen agent, then
posts text with delivery=steer,resume=true. New/session input is bounded16,000 characters;
absolute directory4096/noNUL, agent/id256, server data validated and projected before UI.
Keep the selected created session even if sending fails; never create another root
automatically. Disable double-submit. No automatic POST retries, including permission
or stop. Retain a msg_-prefixed client submission ID for the same session/text/delivery
after an uncertain send, and reuse it on explicit retry; warn that a network failure
may have been accepted and ask the user to check real conversation. Editing input
generates a new ID. Do not claim that admission means completed/successful work.

Choose a job from observed root sessions or New job; existing job's stored location
and agent are authoritative. Follow-up submits to that exact session without moving
it or recreating it. Stop calls interrupt?resume=false; idle is a truthful no-op.
Selected session’s actual user/assistant text appears in a collapsed “Real conversation”
disclosure (last30messages, individual text clips8000chars with visible truncated label).
Read on selection and step/execution ends, not every delta. Live selected text deltas
may be omitted until that reconciliation; the script/floor still receives all real SSE.

Pending permissions show action/resources/message for selected root and observed
descendants, text safely. Only explicit Allow once or Reject; never allow-always or
policy mutations. Refresh pending list on permission events/selection and after reply.
General structured forms remain visibly “Answer this question in OpenCode” for this
slice; never misrepresent a question as a permission or send invented form answers.

## View/replay safety

Room/script focuses on selected job+observed descendants, rather than50 idle REST rows.
When no job selected, show only roots with actual observed beats and explain the blank
state: “Start a job above, or select an existing job. New activity appears here.”
No synthetic events inserted into narrative for optimistic submits. API-created session
metadata may seed cast/scope, but narration/stage comes only from real frames.
Agent/session names are text-safe; session roster supplies meaningful identity alongside
the existing neutral sprites. No office-art redesign in this slice.
Replay disables all job mutation controls; cannot submit/interrupt/reply even by calling
handlers directly. “Return to live” reconnects. Generation guard drops obsolete replay
frames and completion/flush callbacks when restarting replay or returning to live.
Replay does not stop already-running jobs; disclose this. No archive/provider changes.

## API boundary (V2 docs/OpenAPI checked Oct13)

Existing authedFetch only; no new credentials/config/SDK dependency. Fixed relative
API paths and encodeURIComponent IDs. No arbitrary URL proxy or new server write route.
- GET /api/project => array[{canonical,name?}] for suggestions.
- GET /api/agent?location[directory]=... => {location,data:[{id,name,mode,hidden,model?}]}.
- POST /api/session {location:{directory},agent,title} => {data:Session.Info}.
- GET /api/session/{id} => verify schema against actual contract before implementing.
- POST /api/session/{id}/prompt {id,text,delivery:'steer',resume:true} => {data:{id,sessionID,type:'user',payload:{text},delivery}}.
- POST /api/session/{id}/interrupt?resume=false => {interrupted:boolean}.
- GET /api/session/{id}/message?limit=30&order=desc => {data,cursor}, project user.text and assistant.content[type=text].
- GET /api/permission/request?location[directory]=... => {location,data:Permission.Request[]}; require matching project directory, never silently read the server default.
- POST /api/session/{session}/permission/{request}/reply {decision:'once'|'reject'} =>204.

Full V2 response fields are not rendered; browser projection does not render agent
system prompts, permission policy, tool arguments or credentials. Synthetic fixtures
and public source only to workers. No actual executing prompt/model spend in acceptance
tests. Review refinement allows one owned real test session in an isolated temporary
directory with synthetic text and resume:false to verify the contract. It preserved
caller ID and duplicate admission kept one queued input, cost0/idle interruptfalse.
Keep that nonexecuting test session rather than deleting user data automatically; label
this metadata/admission evidence, not an engineering/model end-to-end run.

## Verification

API tests exact wire contract/location/receipt/IDs/zero overrides/malformed responses.
UI/controller tests double submits/create-success-send-failure/retry ID/draft retention,
location change stale-agent reads/selection races/late replies/replay mutation refusal,
safe text/permission scope/stop idle/follow-up same root/transcript truncation.
Actual synthetic page start→real HTTP-boundary contract→SSE script/pose/selected actor,
follow-up/permission/stop/replay switch; server remains synthetic/no private writes/spend.
Full suite/typecheck/build/privacy scan + independent review; fix blockers, fresh merged
verification and owner-authorized normal push. Existing technical permission controls stay.

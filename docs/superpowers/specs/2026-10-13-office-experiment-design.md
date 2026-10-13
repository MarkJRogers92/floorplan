# A little office, not a control panel

Owner: “make design calls. this should be a fun little experiment like munder difflin”.
Questions/gate explicitly waived; keep existing engine and safety, change the experience.
This supersedes script-first presentation and the no-shipped-synthetic-fixture rule only
for a clearly fictional, isolated demo. Never invent live work or put demo state in live APIs.

## Experience (Sol's design calls)

Warm paper UI, ink borders, restrained teal/amber accents, readable local monospace,
chunky controls. Large office scene left; smaller “Office chatter” rail right; one
“What should we work on?” composer beneath. Header: Floorplan / little office experiment,
friendly Project picker, Watch demo, Office settings. No agent IDs, JSON inputs, replay
messages, long disclaimers or empty controls as the front door. One brief cost line stays.
Permissions always surface visibly; hiding settings must never hide a real approval gate.

Project choices use human names/basename plus parent for collisions, full path via tooltip
and settings. Resolve server current location with GET /api/location (validated raw
Location.PublicInfo.directory), show it explicitly; never select root `/` or a random
project/temporary probe silently. Default only to the visible configured `build` agent;
no arbitrary fallback/premium escalation. Agent selection, absolute folder entry,
old jobs, transcript, Director and file replay remain available under settings/disclosures.
If lead/configuration isn't ready, explain it and offer Retry/setup; no fake readiness.
Normal jobs/follow-ups/stop/approvals retain existing verified work runtime and wire.

The office is original procedural Canvas scenery: warm floor, walls/windows, plants,
meeting rug/table, coffee nook and real furniture desks/monitors/chairs. Reuse approved
monitor-clerk sheet; no copied reference tiles/characters. No new binary sprite assets.
Aseprite preflight is currently unattached: do not bypass by writing sprite files.
Empty furniture may decorate the office; characters only for actual observed/live/replay
desks. Up to6 visible stations; extra actors are counted, not silently invented/deleted.
Integer logical pixels, nearest neighbour, named actors + textual status (not colour only),
same status truth and stage poses/reduced-motion semantics. It is a first-pass toy room,
not Munder's full agent engine or a finished human cast.

## The demo is the onboarding

Watch demo works offline and without configuration, keys or model traffic. A short
~20s prerecorded synthetic scene runs the existing frame→floor/rollup/script/stage path:
lead gets a job, calls a helper, hits a tool error, retries, asks for approval, wraps.
Persistent “DEMO · fictional footage · no models/files/history” banner; jokes are fiction.
No synthetic APIs, no POSTs, no archive GET/POST, no Director scene/control calls. Disable
Director locally for demo and prevent UI re-enabling it; do not globally change other tabs.
Real jobs continue in background, not stopped by watching demo. Demo permission asks
are illustrative only, never real approval buttons. Restart/exit/different replay invalidates
all old demo timers/frames/flush; Return to live restores real controls, no automatic prompt.
`?demo=1` starts the same offline demo for previews/QA, never engine connection at startup.

## Reference and verification

Read Munder's public README/design/floor screenshot: useful lessons are “talk to one
lead”, office as home, friendly panels, readable statuses, details on demand. No borrowed
code/assets, copyrighted characters, telemetric dependencies or new runtime dependency.
User's earlier explicit script priority is revised by this delegated office-first direction.

TDD: default location/project labels/lead not arbitrarily selected; no automatic writes;
demo chronology/cues/proofs/cancellation, data isolation with Director initially enabled;
renderer bounded geometry/no ghost actors/reduced movement/overflow. Existing safety
tests remain. Actual synthetic-page interaction and actual screenshot at desktop/mobile;
use installed Chrome with an isolated headless QA profile if desktop pane stays hidden.
Inspect pixels and compare with the reference, fix actual visual problems before declaring
it usable. No real engineering prompt or model spend to demonstrate the UI. Full suite,
typecheck/build/privacy + independent review, then standing-authorized integration/push.

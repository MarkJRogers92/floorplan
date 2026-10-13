# The narrative layer — design

2026-10-12 · status: draft — for owner review · designed against a real recording

## 1. What this is

A funny, followable script of the real work, running **live** beside it. Every
project is a **series**; every chat is an **episode**. The owner watches the episode
as the work happens, and later watches it staged as a pixel-art sitcom on the floor.

This is the reason the project exists (HANDOFF, "The narrative layer"). The floor
built in the foundation plan is one of its renderers (ruling 12), not the other way
round.

The owner's brief, verbatim in spirit: **unique and really funny.** The one rule that
cannot bend: **every line carries the id of the event it describes. The narration
frames and never invents.**

Those two pull against each other only if "funny" means "made up". This design's
central claim is that they don't have to.

## 2. The format: a mockumentary, because the rule demands one

A sitcom writer can invent anything. A documentary crew can only film what happened.
The comedy in *The Office* or *Parks and Recreation* does not come from inventing
events. It comes from **the edit**: what the camera lingers on, what gets cut against
what, the talking head that contradicts the footage, the pause before the reveal.

That is exactly the latitude the non-negotiable leaves us. So the format is fixed:

- **The footage** is the event stream. Nothing happens on screen that did not happen.
- **The edit** is the rollup and the Director: selection, ordering, juxtaposition,
  timing, the cut-to-black. This is where the jokes live, and none of it is invention.
- **Talking heads** are the workers' own lines: each worker, when a unit of its work
  ends, says one sentence to camera about what it just did (the "two voices" of the
  HANDOFF). Grounded by construction, because it is written from that unit's events
  and nothing else.
- **The narrator** is deadpan, dry and specific. It never claims a fact the footage
  does not show; it may have an opinion about the footage. (§5 draws that line
  precisely.)

That is what makes it unique: an AI sitcom whose house style *is* its honesty rule.
"We could only film what happened" is the premise, not a constraint bolted on later.

## 3. What a real session actually looks like

Recorded live on 2026-10-13 against `opencode serve` (v2.0.27), about six minutes of
ordinary work in the desktop app: **1,805 frames across 5 sessions**, three of them
subagents. The recording is git-ignored (it holds real prompts and output); only
counts and event shapes are quoted here.

| Fact from the recording | What it means for the narrative |
|---|---|
| 72% of frames are `session.reasoning.delta` or `session.text.delta` (57% reasoning alone; the longest single run is 317 frames) | Almost everything is noise to a viewer. Runs of deltas must collapse to one beat. |
| A prototype rollup (§4) turns **1,805 frames into 86 beats — 21:1** | Spend scales with beats, as the HANDOFF predicted. 86 beats in six minutes is still too many lines; the Director narrates **scenes**, not beats (§6). |
| Tool calls: 18 `shell`, 11 `read`, 8 `edit`, 2 `write`, 4 `subagent` | Tool names are the cast's verbs. Counts are free running gags, and they are facts. |
| A parent called the `subagent` tool, then a child `session.created` arrived with `parentID` = that parent | A subagent is a **guest star**, with a traceable entrance and exit. This is the B-plot. |
| The child's first `session.inbox.enqueued` has `item.type: "user"` | The briefing a guest receives is a real, citable event. |
| One `permission.asked` → `permission.replied` with `reply: "once"`, two frames apart | The owner's interventions are events too. The Human is a character (§5.2). |
| `session.tool.called` carries no tool name; `session.tool.input.started` does | The rollup must join the two by call `id`. |
| We joined one session mid-stream: no `session.created`, no `execution.started` | Episodes must open cleanly from the middle ("we join our story already in progress"). |
| Every real frame carries `created` (ms) and `location.directory`; the foundation's `Frame` type drops both | **Blocking requirement** for this layer — §9.1. Without `created` there is no timing; without `location` there is no series. |

## 4. The pipeline

```
SSE frames ──► rollup (pure) ──► beats ──► Director (model) ──► script lines ──► grounding check ──► renderers
                                     │                                              │
                                     └──► talking heads (model, per unit of work) ──┘
```

Three stages, each with one job, and only the middle one costs money.

### 4.1 Rollup — pure, deterministic, tested like the reducer

The same shape as `applyFrame`: `rollup(state, frame) → { state, beats[] }`. No
model, no clock, no I/O. It reads the frame's own `created` for all timing, so a
recording replays to the identical beat list every time — which is what makes the
whole narrative testable from `fixtures/`.

Rules, derived from the recording rather than from the spec:

| Beat kind | Raised by | Rolled from | Timing |
|---|---|---|---|
| `episode-opens` | root `session.created`, or the first frame of a session we never saw created | — | immediate |
| `human-asks` | `session.inbox.enqueued` with `item.type: "user"` on a root session | — | immediate |
| `briefing` | the same, on a child session | — | immediate |
| `thinks` | first `session.reasoning.delta` of a run | the whole run, until another kind of frame for that session | closes when the run ends; carries the delta count |
| `says` | first `session.text.delta` of a run | as above | as above |
| `uses-tool` | `session.tool.success` | `tool.input.started` (name) → `tool.called` → `tool.progress`* → success, joined by call `id` | on success |
| `tool-fails` | `session.tool.failed` | as above | **immediate** |
| `guest-arrives` | `session.created` with `parentID` | the parent's open `subagent` call | immediate |
| `guest-leaves` | the parent's `subagent` call succeeding | — | immediate |
| `knocks` | `permission.asked`, `form.created` | — | **immediate** |
| `answered` | `permission.replied` (`once` / `always` / `reject`), `form.replied`, `form.cancelled` | — | immediate |
| `take-two` | `session.retry.scheduled` (carries `attempt`) | — | immediate (supersedes "takes", ruling 14) |
| `memory-wipe` | `session.compaction.started` → `.ended` | the deltas between | on end |
| `wrap` | `session.execution.succeeded` | — | immediate |
| `cut` | `session.execution.failed` / `.interrupted` (carries `reason`) | — | **immediate** |
| `silence` | no frame for a session for ≥ 30 s while it is working | — | raised by the *next* frame's `created`, never by a timer |

Absorbed without a beat: `step.*`, `usage.*`, `tool.input.delta`, `shell.*`,
`instructions.updated`, `project.updated`, heartbeats, and anything unknown (R2).

Every beat records **all** the event ids it was rolled from, not just the first. A
`thinks` beat of 317 deltas cites 317 ids. That list is what the grounding check
reads, and it is what lets any line in the script be clicked back to the raw frames.

The "silence" rule is the one place a design choice matters most: a beat raised by
wall-clock would make replay non-deterministic. Raising it from the gap between
consecutive frames' `created` values keeps the layer pure. The cost: a silence is
only narrated once it ends. That is fine for a script and arguably funnier ("…and
forty seconds later…").

### 4.2 Talking heads — the worker's own voice

When a unit of work ends (a `uses-tool`, a `wrap`, a `cut`, a `guest-leaves`), the
worker who did it gets one line to camera. The input is **only** that unit's beats
and their events, so the line cannot be about anything else. A small, cheap model;
one call per unit, and only for units the Director's scene will actually use.

### 4.3 The Director — the edit

The Director turns beats into a scene. It decides what to keep, in what order, what
to cut against what, where the cold open ends, which talking head to drop in. It
writes the narrator's lines. It never sees raw frames, only beats, which is both the
cost control and part of the honesty guarantee.

It is called **per scene, not per beat**: at an act boundary (`human-asks`, `wrap`,
`cut`), or when a scene's beats reach a size cap. The recording has 8 act-boundary frames, so roughly
ten Director calls for six minutes of work, instead of 86.

## 5. How it is funny without lying

### 5.1 The line between a fact and a voice

Every Director line comes back as structured output:

```ts
type Line = {
  speaker: 'narrator' | CastID
  text: string
  cites: string[]   // beat ids — every line must cite at least one
  facts: Fact[]     // every checkable claim the text makes
}
type Fact =
  | { kind: 'count'; of: BeatKind | ToolName; n: number }
  | { kind: 'tool'; name: string }
  | { kind: 'outcome'; value: 'succeeded' | 'failed' | 'interrupted' | 'once' | 'always' | 'reject' }
  | { kind: 'who'; cast: CastID }
  | { kind: 'duration'; seconds: number }
```

The **grounding check** is pure: each fact must be derivable from the cited beats'
events, and every cited id must exist. A line that fails is **dropped, never
repaired** — a missing joke costs nothing; a wrong one breaks the premise.

What is *not* a fact, and is free: attitude, metaphor, comic timing, a character's
established personality. "Build thought about it for 317 deltas" makes a count claim
and is checked. "Build thought about it for 317 deltas, which is a lot of deltas for
a semicolon" — the second clause is a voice, not a claim about the work, *unless*
it names the change. If it names it, it must cite it. The Director is told this rule
in its instructions; the checker enforces the half that is checkable.

### 5.2 The cast

- **The workers.** The owner runs sixteen named worker agents. Each becomes a
  recurring character with a **character bible**: a one-paragraph personality
  derived from what the agent *is* (its instructions, model, tools — `GET /api/agent`)
  plus traits accumulated from its real track record across episodes. "Plan" is the
  one who reads everything first. Who it really is gets earned from the footage.
- **Guest stars.** Subagents. They arrive with a briefing (a real `briefing` beat), do
  their bit, and leave (`guest-leaves`). Classic B-plot.
- **The Human.** Never on screen. Heard only through `human-asks` and `answered`.
  The unseen boss — Maris in *Frasier*, Charlie in *Charlie's Angels*. A permission
  prompt is a worker **knocking on the Human's door**. `reply: "once"` is the Human
  saying yes the way a parent agrees to exactly one cookie. (Both of those are facts
  from the stream; the cookie is the voice.)
- **The Narrator.** Deadpan. Knows only the footage.

### 5.3 Devices that are funny *and* grounded

| Device | Mechanism | Example (illustrative, from the recording's beat skeleton) |
|---|---|---|
| **The running count** | `count` facts across an episode | "Shell, for the eighteenth time." |
| **The callback** | the Director keeps an episode-scoped list of earlier lines and their beats | The tag returns to the cold open's first `human-asks`. |
| **Footage contradicts talking head** | a `wrap` talking head cut against a `tool-fails` or `take-two` in the same unit | WORKER: "Smooth, honestly." — CUT TO: `take-two`, attempt 3. |
| **The knock** | `knocks` → `answered`, with the gap from `created` | "Forty seconds. The Human was making tea, presumably." ← *presumably* marks voice; the 40 s is a checked `duration`. |
| **The temp agency** | `guest-arrives` / `guest-leaves` around a parent's `subagent` call | "Overwhelmed, Build does what any of us would do. It hires a temp." |
| **Memory wipe** | `memory-wipe` (compaction) | "And then, as happens to us all, it forgot everything before lunch." |
| **"Previously on…"** | the series keeps every past episode's scenes | Each episode opens with a recap built from the last one's cited lines — free continuity, still grounded. |
| **The episode title** | written at `wrap` from the episode's own beats | "The One Where Shell Ran Eighteen Times." |

A sketch of a cold open from the recording's real beat skeleton (counts and tool
names are facts from it; the bracketed ids would be real):

> **COLD OPEN — INT. THE FLOOR**
>
> NARRATOR: The Human has a request. *[human-asks]*
> NARRATOR: Build considers it. For three hundred and seventeen deltas. *[thinks ×317]*
> BUILD *(to camera)*: I like to be thorough. *[talking head: wrap]*
> NARRATOR: Build edits a file. Build runs the shell. Build reads. Build runs the shell again. *[uses-tool ×4]*
> NARRATOR: Overwhelmed, Build does what any of us would do. It hires a temp. *[guest-arrives]*
> **SMASH CUT TO TITLES.**

### 5.4 Episode structure

- **Cold open** — the first `human-asks` and the first beats after it, ending on the
  first good cut point the Director picks.
- **A-plot** — the root session's work.
- **B-plot** — a guest star's work, intercut. A second guest is a C-plot or a montage.
- **Tag** — after `wrap` or `cut`, one short scene: the callback, the title card.

An episode is one root session — a chat. It opens on `episode-opens`, and it ends on
the root's `wrap`/`cut` followed by a `silence`, or on `session.deleted`. A later
`human-asks` in the same chat is **Act 2 of the same episode**, not a new one.

A **series** is a project, keyed by `location.directory`. A season boundary is the
owner's call (open question, §10).

## 6. Data model

Ruling 12 stands, extended upward:

```ts
type Series  = { id: string; directory: string; episodes: string[] }       // a project
type Episode = { id: string; seriesID: string; rootSessionID: string;       // a chat
                 title?: string; scenes: Scene[]; cast: CastID[] }
type Scene   = { id: string; location: string; cast: CastID[]; beats: Beat[]; lines: Line[] }
type Beat    = { id: string; at: number; eventIDs: string[]; kind: BeatKind;
                 sessionID: string; detail: BeatDetail; line?: string }
```

Three renderings fall out of it, in ruling 13's order:

1. **Script** — scenes and lines in order, beside the floor. Built first.
2. **Floor** — cast at desks (what the foundation's Task 12 draws). A scene's
   `location` is a desk or a room; its cast is who is in the shot.
3. **Staged animation** — the same scenes, blocked on the floor: a `knocks` beat walks
   the worker to the Human's door; `guest-arrives` brings a sprite in from the lift.

## 7. Runtime

- **It never blocks the work.** The narrator is a separate consumer of the same
  stream. If it falls behind, it skips to the latest scene boundary; if it dies, the
  floor and OpenCode carry on.
- **A cheap paid model**, not a free tier: it runs as long as the owner works, and a
  free tier will rate-limit mid-episode (HANDOFF). Model choice is configuration.
- **Graceful degradation, in order:** Director down → narrate from **templates**
  (deterministic lines per beat kind, still cited, still deadpan: "Build runs the
  shell. Again."); talking heads down → omit them; everything down → the floor alone.
  Template narration is never mock state: it is the same beats, unadorned.
- **A kill switch** in the shell, and a per-episode budget cap. Hitting the cap drops
  to templates, never stops the work.
- **Cost is bounded by scenes.** At the recording's rate, about ten Director calls and
  a handful of talking heads per six minutes.

## 8. Testing

- The **rollup** is pure: golden tests from scrubbed fixtures (same discipline as
  `fixtures/sample.jsonl`), one per rule in §4.1, including joining mid-stream, the
  tool-name join by call id, and the silence rule computed from `created`.
- The **grounding check** is pure: tests that every fact kind accepts a true claim,
  rejects a false one, and drops (never repairs) the line.
- The **Director** is tested only through its contract: given beats, its output must
  pass the grounding check. Replays of recorded episodes become a regression set for
  "still funny, still true" — reviewed by a human, since funny is not assertable.

## 9. What this needs from the foundation

### 9.1 Blocking: `Frame` must keep `created` and `location`

OpenCode sends `{ id, created, type, location, data, durable, metadata? }`. The
foundation's `Frame` is `{ id?, type, data }`, so `parseFrames` and the recorder both
drop `created` and `location`. Without them there is no timing, no silence beat and
no series. `src/api/sse.ts` is outside the data-path agent's files, so this is
reported, not changed. It is additive — two optional fields — and breaks nothing.
The recorder format should follow (also additive).

### 9.2 Not blocking, but the narrative depends on it being right

- **`session.inbox.*` is not a sibling wait.** Inbox items are `user`, `synthetic`,
  `compaction` and `move`; every prompt passes through `inbox.enqueued`. Spec §6.3
  maps the family to "waiting on another worker", so each prompt briefly shows that,
  and the parent that is *really* waiting on a subagent shows "working". The truthful
  signal is a parent with an open `subagent` tool call. This is the floor's problem
  first, but the narrative and the floor must agree on who is waiting on whom.
- **A desk holds one open ask.** OpenCode tracks a set. Two simultaneous knocks on
  one desk are rare, but the narrative will see both even if the desk shows one.

## 10. Open questions for the owner

1. **Tone dial.** Deadpan mockumentary is the proposal. Broader (*Brooklyn Nine-Nine*)
   or drier (*The Thick of It*, minus the swearing)? This is the biggest lever on
   "really funny".
2. **Seasons.** A season per week, per milestone, or none?
3. **Character bibles.** Generated once from `GET /api/agent` and then frozen, or do
   they drift with the track record? Drift is funnier; frozen is more predictable.
4. **The Human's name.** Unseen and unnamed, or does the owner want a name?
5. **Where the script lives** when the floor becomes the staging: a rail beside it,
   or subtitles under it?
6. **Model and budget** for the Director and talking heads.

## 11. Suggested first slice

1. `Frame` keeps `created` and `location` (§9.1).
2. `rollup` + golden tests, against a scrubbed cut of a real recording.
3. Template narration only — no model — rendered as a script beside the floor. This
   is already a followable story, and it proves the citing chain end to end.
4. Then the Director, behind the grounding check. Then talking heads. Then the
   cold open, tag and "previously on".

Funny comes last on purpose: a joke on top of an uncited line is the one failure
this design cannot recover from.

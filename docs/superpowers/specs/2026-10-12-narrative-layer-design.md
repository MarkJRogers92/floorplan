# The narrative layer — design

2026-10-12 · status: draft, revision 3 — for owner review · designed against a real recording

Revision 2 answered a review: the honesty rule became enforced by code wherever text
reaches a screen, the rollup was specified tightly enough to build, and the owner's
decisions were listed as decisions (§12). Revision 3 applies the owner's first ruling
on it, after reading two sample scripts: *"take more creative liberties to make a
more coherent scene. It doesn't have to make things up per se, but it can create
narratives."* So the rule splits into two layers — **invent the story, never the
work** (§1, §5.1).

## 1. What this is

A funny, followable script of the real work, running **live** beside it — the reason
the project exists (HANDOFF, "The narrative layer"; the floor is one of its
renderers, ruling 12). The owner's direction: *"unique and really funny — a funny
script/narrative that runs while the work is going; each project or chat can be an
episode."* Later, the same script is staged as a pixel-art sitcom on the floor.

The rule that cannot bend: **every narrative line carries the id of the event it
describes, and nothing about the work is invented.** What was done, in what order,
with what outcome, at what count and cost, and anything shown as a worker's own
words, comes from the footage. **The story around the work may be invented**: why a
character did it, how it felt, who resents whom, what was said in the room. The
owner's words: it can create narratives without making things up. Every string any
renderer shows still traces back through one chain:

```
line ──cites──► beats ──rolled from──► event ids ──► raw frames
```

## 2. The format: a docudrama sitcom — "based on a true story"

Revision 2 proposed a pure mockumentary: a crew that can only film what happened,
comedy only from the edit. The owner read a script in that style and wanted more:
scenes that hang together, characters with reasons. That is the docudrama's bargain,
and every "based on a true story" film makes it — **the events are the record; the
scenes between them are written.**

- **The footage** is the event stream. No action, outcome or count appears that did
  not happen, and code fills every one of them in (§5.1).
- **The edit** is the rollup and the Director: selection, juxtaposition, timing.
- **The story** is the Director's to write: motive, feeling, rivalry, office
  politics, dialogue that dramatises a real exchange (a briefing becomes "Sit down.
  It's about the dot."). One invented motive per character is what turns a list of
  events into a plot — pride explains a needless flourish; fairness explains a long
  deliberation; rivalry explains a permission request.
- **The workers' own voices** remain the best material: their real words, verbatim,
  rendered as real (§5.1), cut against what they did next.

Tone within that format is still the owner's call (§12, D1).

## 3. What a real session actually looks like

Recorded live on 2026-10-13 against `opencode serve` (v2.0.27), about six minutes of
ordinary work in the desktop app: **1,805 frames across 5 sessions**. The recording
is git-ignored (it holds real prompts and output). Only types, keys, counts and
anonymised labels (S0–S4) appear here.

| Fact from the recording | What it means for the narrative |
|---|---|
| 72% of frames are reasoning or text deltas (57% reasoning alone; one unbroken run is 317 frames) | Almost everything is noise to a viewer. Runs collapse to one beat. |
| Sessions: S0 and S1 were already running when recording began; S2, S3, S4 were created during it, each with `parentID` = S1 | Guest stars are traceable. S0 and S1 had no `session.created`, so the recording cannot say whether they are roots: their roots and agents need the REST snapshot (§4.1). S1's first frame is a nameless tool success whose `metadata.sessionID` is S0, one frame after S0 wraps — so S0 was most likely S1's guest, joined mid-call. S0 itself is 317 reasoning deltas, 150 text deltas and a wrap, no tools, agent unknown: an "unidentified" cast member is a real case. |
| 4 `subagent` calls but 3 child `session.created`: the 2nd call passes `input.sessionID` = S2 and reuses it. S3 and S4 run the same agent, one after the other | A **returning guest** (no second arrival; a second briefing, start and departure). Two sessions, one actor: cast identity needs a session suffix (§6). |
| S2 opens 10 reasoning runs (`reasoning.started`/`.ended`) and streams zero reasoning deltas | A worker that visibly thinks and shares none of it. A `thinks` beat can have 0 deltas. |
| All 4 `inbox.enqueued` (all `item.type: "user"`) are on child sessions | Under the rule "a user item on a root is the Human asking", this recording has **zero** Human asks. Each is a guest's briefing. |
| Tool calls: shell 18, read 11, edit 8, subagent 4, write 2, spread across S1–S4 | Tool names are the cast's verbs; counts are running gags, and they are facts. |
| `tool.called` carries no tool name; `tool.input.started` does; one `tool.success` has no prior `input.started` (joined mid-call) | Join by call `id`, and allow a success whose tool is unknown. |
| All 43 `tool.success` frames have `executed: false`; all 18 `shell.exited` have exit 0; `shell.*` frames carry no sessionID, but `tool.progress` carries `metadata.shellID`, which matched all 18 | Exit codes are joinable to a session. This recording contains no failure of any kind, so it cannot show what one looks like (§4.1, `tool-fails`). |
| `subagent` successes carry the child's id in `metadata.sessionID`; calls carry `agent`, `description`, `prompt`, sometimes `sessionID`. Every `step.started` names agent and model; every `usage.updated` carries a cost | The briefing, who was hired, casting and expenses are all on the record. |
| One `permission.asked` → `permission.replied` (`once`), two frames apart | The Human's interventions are events too. |
| Recorded frames are `{id, type, data}` only | The recorder drops `created` and `location` (§10.1). A separate live probe of the wire showed that session frames on the wire carry `created` (ms) and `location.directory`, and `server.connected` carries neither. The recording itself cannot show this. |

Rolled up by §4.1, the recording is roughly 20:1 — about 86–90 beats (an uncommitted
prototype and a reviewer's hand count; approximate). Still too many lines for six
minutes: the Director narrates **scenes**, not beats (§4.2).

## 4. The pipeline

```
SSE frames ─► rollup (pure) ─► beats ─┬─► template lines (pure, live) ─────────────┐
                                      └─► Director (model, per scene) ─► lines ─► check ─┴─► renderers
```

Only the Director costs money. Template lines stream live as beats close; the
Director's checked lines replace them when a scene closes (§4.2).

### 4.1 Rollup — pure, deterministic, tested like the reducer

The same shape as `applyFrame`: `rollup(state, frame) → { state, beats[] }`, plus
`flush(state) → beats[]` at stream end. No model, no clock, no I/O. All timing comes
from frames' own `created`, so a recording replays to the identical beat list.

**Before any rule:** drop a frame whose `id` has been seen (reconnects replay). Seed
state from the REST snapshot (sessions with `parentID` and agent, open permissions)
so a session joined mid-stream still has a root, a parent and a cast member; re-seed
on every reconnect, as the floor does (spec §6.3).

| Beat kind | Raised by | Rolled from / closed by |
|---|---|---|
| `episode-opens` | the root's `session.created`, or its `execution.started` when we joined after creation, or the first run or call beat for that root — whichever comes first. A frame that is merely the first we happen to see does not open an episode | — |
| `human-asks` | `inbox.enqueued`, `item.type: "user"`, on a **root** session | — |
| `briefing` | the same, on a child session | linked to its call as `guest-arrives` is |
| `thinks` | `reasoning.started` (or the first `reasoning.delta` if joined mid-run) | closed by that session's `reasoning.ended`; carries the delta count, which may be 0 |
| `says` | `text.started` (or first `text.delta`) | closed by `text.ended`; carries the delta count and the ended frame's id |
| `uses-tool` | `tool.success`, any tool but `subagent` (a nameless success carrying `metadata.sessionID` is a `guest-leaves`) | joins `input.started` (name) → `called` → `progress`* by call `id`; name `unknown` if joined mid-call; shell exit code joined via `progress.metadata.shellID` → `shell.exited.id` |
| `tool-fails` | `tool.failed`, **and** a `tool.success` whose reported shell exit is non-zero (settled by the Task 4 recording) | as above; **immediate**; carries `exit` |
| `guest-arrives` | `session.created` carrying a `parentID` | linked to a call by that call's `input.sessionID`, which precedes the arrival and is therefore determinable; **never** by "the parent's open call"; and not from the success's `metadata.sessionID`, which arrives after the beat is emitted and beats are immutable |
| `guest-leaves` | `tool.success` of a `subagent` call | **instead of** `uses-tool`, never as well; the child is `metadata.sessionID`. One per call, so a returning guest leaves twice and arrives once |
| `knocks` | `permission.asked`, `form.created` | **immediate** |
| `answered` | `permission.replied` (`once` / `always` / `reject`), `form.replied`, `form.cancelled` | — |
| `retry` | `session.retry.scheduled` (carries `attempt`) | — |
| `memory-wipe` | `compaction.started` | closed by `compaction.ended` |
| `wrap` | `execution.succeeded` | — |
| `cut` | `execution.failed` / `.interrupted` (carries `reason`) | **immediate** |
| `silence` | a gap of ≥ 30 s between two frames of a **working** session | raised by the frame that ends it; cites both bounding frames |

**Working** = after the session's `execution.started` (or first frame, if joined),
before its `wrap`/`cut`, with no unanswered `knocks` and no open `subagent` call (a
parent waiting on its guest is not silent). Only **that session's** next frame ends a
silence. No timers, so replay stays pure; a silence is narrated once it ends.

**Flush.** At stream end, open runs close with the events they have; a call with no
success produces no beat.

**Absorbed without a beat:** `tool.input.delta`/`.ended`, `tool.called`,
`tool.progress` (joins); `reasoning.delta`, `text.delta` (counted); `step.started`
(agent, model), `step.ended`, `step.streamed`; `usage.updated` (cost, attached to the
step's beats); `shell.created`/`.exited` (exit code)/`.deleted`; `inbox.delivered`;
`execution.started` (opens "working"); `instructions.updated`, `project.updated`,
`provider.updated`, `model.updated`, `server.connected`, heartbeats; any unknown type (R2).

**Beat identity.** `b:<first event id>`, so a re-run yields the same ids. A beat
records **all** its event ids: a `thinks` of 317 deltas cites 317. When an
`episode-opens` rides a beat the root produced, it takes the id of the frame that
*produced* that beat rather than the beat's own first frame — an opener and its beat
must never share an id, because citing is by id and two beats with one id break it.

**`tool-fails` and non-zero exits — settled by the Task 4 recording (2026-10-13).**
A shell command that exits non-zero arrives as `tool.success` carrying
`metadata.exit` and `metadata.status: "completed"`; no `tool.failed` frame appeared
for it (or anywhere) in the recording. So the rule as first written misses every
real shell failure. `tool-fails` is raised by `tool.failed` **and** by a
`tool.success` whose reported exit code is non-zero. The exit is read from the
success's own `metadata.exit` first, falling back to the joined `shell.exited` code:
in the recording the `shell.exited` arrived 22 ms *after* the success it belongs to,
so the join alone is not dependable at decision time. `uses-tool` remains the beat
for exit 0 and carries the code from either source, citable.

### 4.2 The Director — the edit

The Director turns a closed scene's beats into lines — what to keep, in what order,
what to cut against what — seeing beats, never raw frames.

**A scene** is one location (§6) and closes on the first of: a root act boundary
(`human-asks`, `wrap`, `cut`), a guest arriving or leaving, **12 beats**, or **90 s**
of `created` time. The first draft's "8 act-boundary frames" were four child
briefings and four `execution.succeeded`; under root-only rules this recording has at most one (S0's
wrap, if S0 is a root). So the cap sets the call rate: ~90 beats in 12-beat scenes is
8–10 Director calls per six minutes.

**Live behaviour.** Template lines appear as each beat closes; when a scene closes,
the Director's checked lines replace them. A dropped line is filled by the template
lines of the beats it cited, so no beat goes unnarrated because a joke failed.

## 5. How it is funny without lying

### 5.1 Lines are templates with typed slots; code fills the slots

The first draft let the Director write free text and list its claims beside it, so
a claim it forgot to list went unchecked. Now **the Director never writes a checkable
claim as text**: it writes a template, and code fills each slot from the cited beats.

```ts
type Line = { id: string; speaker: 'narrator' | CastID;
              template: string;   // free text plus {slots}: "{agent:b7} runs {tool:b7}, {again:b4,b7}."
              cites: string[];    // beat ids; at least one — story lines too: they dramatise a moment
              flashback?: true }  // permits breaking time order (§5.2)
```

A line whose template is exactly one `{quote:…}` slot is **real speech** and renders
as such (verbatim, marked). Any other line a character speaks is **dramatised** and
renders visibly differently — the viewer can always tell what was really said from
what was written for the scene. The renderer decides from the template; the Director
cannot label a line real.

The slot vocabulary is closed. Each slot names the beats it reads; the checker
resolves it from their events or rejects the line.

| Slot | Renders | Proof required |
|---|---|---|
| `{count:K,b1..b9}` | number and noun, "seven shell runs", for beats of kind/tool K in range | counted from the cited beats |
| `{deltas:b4}`, `{deltas:b1..b9}` | delta count inside a `thinks`/`says` beat, or summed over a range ("none") | the beats' own counts |
| `{ordinal:K,b9}` | "third" | b9 is the nth beat of K in the episode |
| `{again:b4,b9}`, `{first:K,b4}`, `{last:K,b9}`, `{before:b4,b9}` | order words | sequence of the cited beats |
| `{tool:b7}`, `{agent:b7}` | a tool or cast name | the beat's own tool / session's cast |
| `{path:b7}` | a file or path | the tool call's input; the beat is cited |
| `{outcome:b7}` | succeeded / failed / interrupted / once / always / reject / exit 2 | the subject beat's own outcome |
| `{dur:b3..b9}` | "forty seconds" | `created` of b3's first event to b9's last, rounded **down** (to 5 s under a minute, to whole minutes above) |
| `{cost:b3..b9}` | "four cents" | sum of `usage.updated` cost in range, rounded down |
| `{quote:b8}` | a worker's own sentence, verbatim | the `text.ended` / `reasoning.ended` text of a `says`/`thinks` beat |
| `{never:K}` | "never once" | only after the episode (or series) closes, and only if a scan of the whole range finds no K |
| `{hedge}` | *presumably*, *one assumes* | marks the next clause as speculation (below) |

**Free text is linted, not trusted.** Outside slots, a line is rejected if it contains
a digit, a number word (*one* … *hundred*, *twice*, *dozen*, *several*), an order or
absence word (*again*, *first*, *last*, *finally*, *still*, *never*, *always*, *only*),
any known tool, agent or model name or its verb form (*writes*, *reads*), or anything
path-shaped. Absence is the trap: "it never ran the tests" is a claim about every
event in the episode, banned unless `{never:…}` proves it.

**Two layers: the work and the story.** The lint above guards the **work** — every
action, tool, file, count, order, outcome, duration and cost is a slot or nothing.
Free text is the **story**, and since revision 3 it is wide open: a worker's
**motive**, **feelings**, **relationships**, **what the Human was doing**, and
**dialogue that dramatises a cited moment** need no hedge. The story has three limits,
each enforced:

1. **It never asserts work.** The lint applies to dramatised dialogue too: a
   character may say "Sit down. It's about the dot," but not "I ran the tests twice"
   — that is a count and an action, so it must be a slot.
2. **It never contradicts the work.** A story line cites the beats it dramatises
   (§5.2), and may not imply an outcome other than theirs: no relief after a `cut`, no
   triumph over a `tool-fails` the scene does not show. The Director's instructions
   carry this; the scene check enforces the mechanical half (outcome words are slots).
3. **It is never passed off as real speech.** Only `{quote:}` renders as the worker's
   own words (above).

Clock time stays on the work side: "before lunch" asserts when something happened,
so it is a `{dur:}`/`created` slot or nothing.

The first draft offered this as acceptable; it is still rejected under revision 3:
*"Build thought about it for 317 deltas, which is a lot of deltas for a semicolon."*
"Semicolon" asserts what the change was — work, not story — and nothing cited says so.
By contrast, *"It could have let the dot go. Instead, it gave the dot a name"* passes:
the renaming is cited, and *could have let it go* is the story's.

A failing line is **dropped, never repaired** — a missing joke costs nothing; a wrong
one breaks the premise.

### 5.2 Scene-level checks

Lines that are each true can still compose a false story. After the per-line check,
a scene passes only if:

1. **Speaker matches footage.** A `CastID` speaker and every `{agent:…}` slot match
   the agent of each cited beat's session; unknown is **"unidentified"**, never a guess.
2. **One episode.** All cites in a scene come from one episode (recaps: §5.5).
3. **Time order.** Each line's anchor (latest cited beat) is no earlier than the
   previous line's, unless marked `flashback`, which renders as one.
4. **No burying.** Every `tool-fails`, `cut` and `knocks` beat is cited by a surviving
   line, or the scene falls back to templates.
5. **Story stays in the room.** A dramatised line is spoken only by a character whose
   session the scene cites; nobody gets dialogue in a scene they were not in.

**Why these exist:** the first draft's cold-open sketch failed them. It stitched S0's
317-delta think to S1's tools as one named actor, without evidence for the name, and
opened on a Human ask the recording does not contain.

### 5.3 A cold open, rebuilt from one session

From S2 alone — a guest, so a B-plot cold open — using only its real beat skeleton
(kinds, tool names, counts; beat labels are placeholders), as the Director emits it:

> **COLD OPEN — INT. S2'S DESK**
>
> NARRATOR: A temp arrives. {agent:b1} has been briefed. *[guest-arrives b1, briefing b2]*
> NARRATOR: It runs {tool:b3}. It runs {tool:b4}, {again:b3,b4}. *[b3, b4]*
> NARRATOR: It writes. It runs the shell. It writes again. *[b6, b7, b8]* ← **rejected**: *writes* and *shell* are tool names and *again* an order word, all outside slots.
> NARRATOR: {count:shell,b3..b16}, {count:edit,b3..b16} and {count:write,b3..b16} later, it reports back. *[b3..b16, wrap b17]*
> {agent:b1} *(to camera)*: {quote:b16} *[says b16]*
> NARRATOR: It is sent for {again:b2,b18}. *[briefing b18]*
> NARRATOR: {count:edit,b19..b22}. {count:shell,b19..b22}. {outcome:b24}. *[b19..b22, wrap b24]*
> NARRATOR: Across all of this it stopped to think {count:thinks,b1..b24}, and shared {deltas:b1..b24} of it. *[thinks beats]*
> **SMASH CUT TO TITLES.**

Rendered: seven shell runs, two edits, two writes; then two and two; and *"…to think
ten times, and shared none of it"* — all true of S2. The third line fails on purpose.
The talking head is withheld only because the recording is sensitive; in the product
it is the worker's real closing sentence.

### 5.4 Devices that are funny *and* grounded

Each comes from material the stream really carries.

| Device | Mechanism |
|---|---|
| **Famous last words** | `{quote:}` of a worker's own text or reasoning, cut against the next beat: it says it will be quick, then `{count}` shell runs. The juxtaposition is the joke; both halves are footage. |
| **The briefing vs the job** | The `subagent` call's `description` (what the guest was hired for) set against the tool counts of what it then did. |
| **Casting** | `step.started` names agent and model. S2 is the one cast member on a different model family, and the one that thinks without a word. |
| **Expenses, exit codes** | `{cost:}` from `usage.updated` ("That thought cost {cost:b4}."); `{outcome:}` carries a shell's real exit status (§4.1). |
| **The running count** | `{count:}` and `{ordinal:}` across an episode: "{tool:b40}, for the {ordinal:shell,b40} time." |
| **The returning guest** | One arrival, two briefings, two departures: "It is sent for {again:b2,b18}." |
| **Two sessions, one actor** | S3 and S4 are the same agent at two desks (sequential here; the device does not need overlap). |
| **The knock** | `knocks` → `answered`, with `{dur:}` between: "{dur:b5..b6}. The Human was {hedge} making tea." |
| **The Human's record** | Series-level counts with proof, e.g. `{count:reply=always,series}`. Zero, so far, is itself a running gag. |
| **Memory wipe** | `memory-wipe`: "And then, as happens to us all, it forgot." (attitude; the compaction is cited. The first draft's "…before lunch" is clock time, and would be rejected.) |
| **The episode title** | A `Line` over the episode's own slots: "The One With {count:shell,b1..b90}." |

**Footage contradicts talking head** — the first draft's favourite device — needed a
talking head that says something false. Revision 3 settles it (D3) as both, kept
apart by rendering: **talking heads to camera are the worker's real words**
(`{quote:}` of `text.ended`/`reasoning.ended`), cut against what it then did, so any
contradiction is real; **in-scene dialogue is dramatised** and may carry a
character's pride, doubt or denial, rendered as dramatised, never as a quote.

### 5.5 The cast, and continuity

- **Workers.** Each agent is a recurring character. Its **character bible** is
  computed, never written: statistics over past episodes (tool mix, deltas per think,
  wraps vs cuts, knocks), each citing its episodes and beats, usable only through
  slots. This resolves the first draft's "frozen or drifting?" question: bibles
  drift because they are recomputed, and stay true because they are counts.
- **Guests.** Subagents. Arrive with a citable briefing, leave on the call's success.
- **Unidentified.** Any session whose agent is unknown (S0 here).
- **The Human.** Never on screen; present through `human-asks`, `knocks` and
  `answered`. Whether the Human is a character at all is the owner's call (D5).
- **Personas** (story layer, revision 3). Alongside the computed bible, each recurring
  character gets an invented personality — the keen intern, the fair-minded foreman,
  the weary auditor — written once by the Director from its first episodes, stored
  with the series, and reused so the character is the same person next week. A
  persona is story: it may colour any line, but it never stands in for a bible fact.
- **The Narrator.** Deadpan, and allowed an inner life of its own. Its facts are slots.

**"Previously on…"** is a scene of ordinary lines citing `episodeID/beatID`. The
series store keeps past episodes' beats and event ids, so a recap is checked like a
live line against stored beats; an unstored episode cannot be recapped.

### 5.6 Episode structure

**Cold open** (first beats, to the first cut point) · **A-plot** (the root) ·
**B-plot** (a guest, intercut; more guests make a montage) · **Tag** (after the root's
`wrap`/`cut`: callback, title card).

An episode is one root session, opening on `episode-opens`. It ends on the root's
`wrap`/`cut` with no new `human-asks` on that root within **10 minutes of `created`
time** (decided by the root's next frame, or at flush), or on `session.deleted`. A
`human-asks` inside the window is Act 2. A chat resumed later: D2.

## 6. Data model

Ruling 12 stands, extended upward. There is no free-text field anywhere below: every
string a renderer shows — narrator line, talking head, title card, "previously on",
scene heading — is a `Line` and passes the check.

```ts
type CastID  = string   // agent name, e.g. "plan"; with a session suffix ("plan·2") when two
                        // sessions in one episode run the same agent; "unidentified" when unknown
type Series  = { id: string; key: string; episodes: string[] }   // key: §10.1
type Episode = { id: string; seriesID: string; rootSessionID: string;
                 title?: Line; scenes: Scene[]; cast: CastID[] }
type Scene   = { id: string; location: Location; rootSessionID: string; cast: CastID[]; beats: string[]; lines: Line[];
                 heading: Line }
type Location = { kind: 'desk'; sessionID: string } | { kind: 'to-camera' }   // a session's desk; addressing the audience
type Beat    = { id: string;        // `b:<first event id>`; BeatKind = the kinds in §4.1
                  at: number;        // `created` of the beat's first event (run start)
                  endAt: number;     // `created` of the beat's last contributing event
                 eventIDs: string[]; kind: BeatKind; sessionID: string; detail: BeatDetail }
type BeatDetail =
  | { kind: 'thinks' | 'says'; deltas: number; endedEventID?: string; text?: string }
  | { kind: 'uses-tool' | 'tool-fails'; tool: string | 'unknown'; callID?: string;
      path?: string; exit?: number }
  | { kind: 'guest-arrives' | 'guest-leaves' | 'briefing'; childSessionID: string; callID?: string }
  | { kind: 'knocks'; requestID: string } | { kind: 'answered'; reply: string }
  | { kind: 'retry'; attempt: number } | { kind: 'cut'; reason: string }
  | { kind: 'silence'; fromEventID: string; toEventID: string; ms: number }
  | { kind: 'episode-opens' | 'human-asks' | 'memory-wipe' | 'wrap' }

`text` is the ended run's own words, captured verbatim from the closing frame, and is
what `{quote:}` renders; absent on scrubbed or text-less runs, in which case a
quote-only line is rejected rather than rendered blank. `ms` is the silence's own gap
in milliseconds, computed from its two bounding frames at raise time, and is what
`{gap:}` renders. Both fields were added building slice 1; the table above is now the
authority, not the earlier prose that omits them.
```

`Beat.line` from ruling 12 is dropped: a beat's narration is its **template line**, a
pure function of the beat, cited to it. Renderings, in ruling 13's order: **script**,
**floor** (a scene's location is the desk in shot), **staged animation** (`knocks`
walks a worker to the Human's door; `guest-arrives` brings a sprite from the lift).

## 7. Runtime

- **It never blocks the work.** A separate consumer of the stream; if it falls behind
  it skips to the latest scene boundary; if it dies, the floor and OpenCode carry on.
- **A cheap paid model**, not a free tier: it runs as long as the owner works.
- **Degradation:** failed line → template lines; Director down → templates; all down
  → the floor alone. Templates are the same beats, unadorned, still cited.
- **A kill switch** and a per-episode budget cap that drops to templates.

## 8. Where model calls run, and with what key

Owner decision (D6). Threat model: beats carry tool names, paths, briefings and the
workers' own words, so **the owner's code, prompts and command output go to a
third-party model**; and whoever holds the key can spend on it.

| Option | Key lives | Problem |
|---|---|---|
| In the browser page | page JS | The page has no safe place for a secret — the problem ruling 10 met with the server credential. Any script on the page can read it. |
| Through OpenCode (`serve` runs the call) | OpenCode's provider config | Each call creates a session, and sessions appear on the floor: the narrator narrating itself. Needs a marker and a filter, and still spends from the owner's coding budget. |
| A route in the Vite dev process (ruling 10's pattern) | a local env file | Dev only, like ruling 10; a shipped build needs a real credential path. |

Recommended: the dev route, a separate key with a hard spend limit, and a per-session
opt-out. Template-only narration sends nothing and needs no key.

## 9. Testing

- **Rollup:** golden tests from scrubbed fixtures, one per §4.1 rule, including
  mid-stream join, nameless success, returning guest, zero-delta thinks, dedupe, flush.
- **Checker:** each slot accepts a true fill and rejects a false one; the lint rejects
  each banned class; each scene check rejects its failure case. The first draft's
  cold open is a fixture.
- **Director:** only through its contract (output must pass the checker); replays are
  a "still funny, still true" set, judged by a human.

**The current recording cannot golden-test silence, duration or series:** no
`created`, no `location` (§10.1), and no failures. Re-record after the `Frame` change,
deliberately including a failed shell command, a denied permission, an idle gap and a
resumed chat.

## 10. What this needs from the foundation

### 10.1 Blocking: `Frame` must keep `created` and `location`

`Frame` is `{ id?, type, data }`, so `parseFrames` and the recorder drop the rest. A
live probe showed session frames on the wire carry `created` (ms) and
`location.directory` (`server.connected` carries neither); the recording cannot show
it. Without them: no timing, no silence, no series. `src/api/sse.ts` is outside the
data-path agent's files, so this is reported, not changed; it is additive.

**Series key:** the frame's `location.directory`; else `session.created` data's
`location.directory` / `projectID` (present in the recording); else the REST snapshot.

### 10.2 Not blocking, but the narrative and floor must agree

- **`session.inbox.*` is not a sibling wait.** Every prompt passes through
  `inbox.enqueued`, so spec §6.3's "waiting on another worker" is wrong; the truthful
  signal is a parent with an open `subagent` call. The recording shows only
  `item.type: "user"`; `synthetic`, `compaction` and `move` come from the OpenCode
  build, not the recording.
- **A desk holds one open ask**; OpenCode tracks a set.
- **Ruling 14 is wrong in one detail.** It counts a repeated `execution.started` as a
  take; S2's second start is a returning guest with a new briefing. Only
  `retry.scheduled` is a take.

## 11. Suggested first slice

1. `Frame` keeps `created` and `location`; re-record (§9).
2. **Hand-write two or three short scripts** from one real recording in different
   tones, obeying §5 by hand; the owner picks. *Begun:* two versions of one episode
   were shown to the owner (not committed — they quote the recording); the
   mockumentary read as too dry, the docudrama version led to revision 3.
3. `rollup` + golden tests.
4. Template lines as a script beside the floor — already followable, and it proves
   the citing chain end to end.
5. The checker, then the Director behind it; then quotes, recaps and titles.

Funny comes last on purpose: a joke on top of an uncited line is the one failure
this design cannot recover from.

## 12. Owner decisions — settled 2026-10-13

**D1. Tone — deadpan, darkly comedic, nothing off limits.** The owner's direction, and
the boundary that survives it: "nothing off limits" sets how bleak the *framing* may be,
never whether events happened. The citing rule is untouched, so the darkness comes from
what actually occurred — a `cut`, a `memory-wipe`, a `retry`, a `silence`, a worker
stuck on the same failing call — which is both funnier and truer than invention. Dark
framing of a real failure is the target; invented nastiness is still forbidden. Two
consequences worth naming: a cruel line is cruel about something that really happened,
and the beats carry the owner's paths, prompts and command output.

**D2. An episode is a chat; a series is a project.** The series key is already
`location.directory` (§10.1), so this mapping is forced rather than chosen. A chat
resumed after a gap is the **same episode** — a session is the episode however long it
runs, and gaps inside it are `silence` beats, which the rollup already raises. A "Part 2"
boundary would need a rule for what counts as a gap, and that rule would be invented
rather than observed.

**D3. Talking heads.** Real quotes to camera; dramatised dialogue in scene, rendered
distinctly (§5.4).

**D4. Only `session.retry.scheduled` is a take.** A repeated `execution.started` is a
returning guest with a new briefing, not a retry (§10.2).

**D5. The Human is the audience — and is not a character.** There is no Human. The
audience is the owner, present and unseen, exactly as a documentary crew is present in a
docudrama. The design was already most of the way there: the `Location` variant called
`{ kind: 'door' }` becomes **`{ kind: 'to-camera' }`**. A worker with an unanswered
`knocks` addresses the audience instead of knocking at a door, and `answered` carries the
audience's reply — the approval itself. The fourth wall is load-bearing: `knocks` is the
audience being asked, `answered` is the audience answering. Dialogue is never written
*for* the audience, only *at* it.

**D6. Model calls: a dev route, an opt-in key, a hard cap.** Same shape and the same
limitation as the credential route — a route in the Vite dev process. The page has
nowhere safe for a secret, and routing the call through OpenCode would create sessions
that appear on the floor, i.e. the narrator narrating itself. A key of its own from a
local env file, never the OpenCode credentials, with a spend cap at the provider as well
as a per-episode cap in code. **With no key configured the narrative runs template-only
and sends nothing** — that is the default, so the Director is opt-in twice over. On a cap
or a failure it degrades down §7's ladder. Per-session opt-out. The threat model, stated
plainly: a Director call sends the owner's tool names, file paths, prompts and command
output to a third-party model.

**D7. Series storage: files through the dev route.** Continuity is the asset — running
jokes, callbacks, the bible — and it is exactly what a cache clear destroys, so IndexedDB
is the wrong home for it. Files also stay inspectable and hand-editable, which matters
while the tone is being tuned. Dev-only, like everything else here:
`~/.local/state/floorplan/series/<key>/`. The browser keeps a read-through cache and
holds nothing durable.

**D8. No season numbering yet, and the script takes the primary column.** A season is
simply a project's episodes in order and the bible accumulates across them; named seasons
are a presentation feature to add if episode cards are ever wanted, and inventing their
boundaries now would be guesswork. **The script takes the primary column with the floor a
panel beside it** — the owner's direction is that the script is the main surface now and
the visuals become the stage later, which is the same shell with the emphasis reversed.

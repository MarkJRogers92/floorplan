# Pixel office on OpenCode — foundation design

2026-10-12 · status: draft — awaiting builder check, then owner approval

## 1. Why this exists

The owner runs OpenCode as their main development harness: sixteen named worker
agents, provider quota routing with fallbacks, a per-repo memory plugin, several
MCP servers, and a pixel-art toolchain (Aseprite, Pixel Forge). What they want is
a workspace they sit in front of: **you choose who gets a job, then you watch it
happen.**

The reference point is Munder Difflin, a pixel-art office where every agent is an
avatar at a desk. It is not a model to copy — it wraps twelve other CLIs behind
six kinds of shim, a 1.5-second filesystem poll, and a git repo used as a message
bus; its "encrypted agent messages" and "fastest memory layer in the world"
claims are not borne out by its own source. What is worth taking is the shape:
**a room, a desk per worker, status driven by structured lifecycle events, and a
strict split between the process doing the work and the model making judgements.**

## 2. Goal of this foundation

Not a product, and not something the owner lives in yet. The point is to prove the
hard parts and settle the decisions while nothing depends on it, so later work is
additive. There are two things to prove:

1. A room can be drawn from **real** OpenCode session data, with no mock state
   anywhere on screen.
2. A job can be started, watched and steered from that room — permission requests
   included.

**Done means:** one command starts the app; it connects to a running OpenCode
server; a room shows one desk per active worker with correct idle / working /
waiting state; selecting a desk shows that session's conversation rendered in a
pixel font; typing in the rail starts or steers real work; and a permission
request raised by a worker can be answered in the rail.

A desk is a worker (§5). In the foundation a worker is realised as one OpenCode
session, so "a desk per active worker" and "a desk per session" mean the same thing
here; if a future worker spans sessions, this is the line that changes.

## 3. Non-goals

Explicitly out of scope for the foundation, and not because they are bad ideas:

- Animation beyond a static status glyph per worker.
- Multiple rooms, a hiring UI, worker configuration screens.
- Job history, cost dashboards, analytics.
- Packaging, installers, auto-update, code signing.
- Authentication, multi-user, remote access, tunnelling.
- Parity with OpenCode's existing frontends — the TUI and the desktop app. The owner keeps working in whichever they already use while this is built.
- Any change to OpenCode itself.
- Automatic *cost-optimal* routing. "Free" is answerable from the model catalogue
  (§6.8) and is in scope; anything richer — picking the cheapest paid model, or
  reading remaining quota — is not.

## 4. Anti-goals

The foundation fails, even if it runs, if any of these are true:

- **Any state on screen that is not derived from a real event.** No mock workers, no
  simulated progress, no placeholder sessions left in the shipped code path.
- **A second frontend that is prettier but cannot do anything.** If it cannot start
  a real job and answer a real permission prompt, it is scenery.
- **Wrapping the TUI**, scraping stdout, or parsing terminal output to infer state.
  This is the exact pile of hacks the reference project accumulated.
- **Patching OpenCode's engine** to make the frontend easier.
- **One file becoming the app.** No file over ~400 lines in our own code.

## 5. Decisions the owner made

These are settled. They came from a design conversation with reference mockups;
do not relitigate them without asking.

- **A room is the main screen.** Called the floor: a pixel-art room with a desk per
  worker. Chosen over a roster of models and over a kanban board.
- **A desk is a worker, not a model.** A worker is a role — its own instructions,
  tools and memory — sitting on a model. The floor is a team, not a provider list.
- **Steering happens in a rail beside the floor.** The floor never rearranges. A
  panel holds the selected worker's conversation, its requests, and the input box.
  Chosen over growing the desk in place and over a full-screen per-worker view.
- **Choosing is: you pick, with an automatic default.** The owner names the worker
  for a job; jobs they don't care about can be left on "anyone free / cheapest with
  budget left", which matters because the owner already runs quota and fallback
  rules.

  **Foundation scope:** the automatic default means **"a free model"**, defined in
  §6.8 — a model the catalogue prices at zero, that is on the owner's preferred
  list. Richer routing (cheapest paid model, remaining quota) is out of scope.
- **The look is full pixel, including a bitmap code font.** Coherence over
  legibility, chosen knowingly after seeing the tradeoff rendered. See risk R1.

## 6. Architecture

These are calls made in this document, not by the owner. Each is reversible; the
reversal is noted.

### 6.1 A standalone client on OpenCode's API, not a fork of its UI

OpenCode ships three frontends on one backend: the TUI, a web UI, and an Electron
desktop app. `opencode serve` starts the v2 API and web server. The engine is a
separate package from the UI.

Three routes were considered:

- **GUI extension.** Rejected, not chosen against. The extension system registers
  into fixed slots — side and dock panels, titlebar items, settings pages — and the
  main content area has no hook. The office cannot be a plugin.
- **Fork `packages/app`** (the SolidJS shell). This genuinely replaces OpenCode's
  interface and inherits its session components, routing and theming. It also means
  inheriting a SolidJS + Tailwind + Kobalte design language that a full-pixel UI
  deletes wholesale, and being pinned to a fork of a fast-moving repo on its `dev`
  branch.
- **Standalone client on the HTTP/SSE API.** **Chosen.** The engine stays untouched,
  so OpenCode keeps updating and the owner's existing setup — plugins, memory
  plugin, MCP servers, agents — keeps working. Full pixel is the default rather
  than a fight against an inherited design system.

The decisive argument is reversibility. If a single unified app is wanted later,
this UI can be moved into a fork of `packages/app`. The reverse move is not
available.

*Reversal:* if the owner wants one app, this section changes and nothing else in
the document does. The event mapping, the state machine and the art pipeline are
all frontend-agnostic.

### 6.2 What OpenCode provides

Verified against the installed build (v2.0.27) and its live server, not from docs.

- **Server.** `opencode serve` — "Start the v2 API and web server". 118 REST
  endpoints, full OpenAPI 3.1 at `GET /openapi.json`.
- **Auth.** HTTP Basic, `opencode:<password>`. The password is in
  `~/.local/state/opencode/service.json`. **Read it at runtime; never commit it,
  never print it, never send it anywhere.**
- **Event stream.** `GET /api/event`, `text/event-stream`. Frames look like
  `data: {"id":"evt_…","type":"<name>","location":{…},"data":{…}}`, with `: heartbeat`
  comments between them.

Endpoints the foundation needs:

| Purpose | Endpoint |
|---|---|
| List workers' sessions | `GET /api/session`, `GET /api/session/active` |
| A session's conversation | `GET /api/session/{id}/message` |
| Start or steer work | `POST /api/session/{id}/prompt` |
| Interrupt | `POST /api/session/{id}/interrupt` |
| Pending approvals | `GET /api/permission/request` |
| Answer an approval | `POST /api/session/{id}/permission/{requestID}/reply` — `once` \| `always` \| `reject` |
| Available agents | `GET /api/agent` |

### 6.3 Event to desk state

The whole room hangs off this mapping. Keep it in **one module**, not scattered
through components, because it is the part most likely to change under us.

**The room is seeded, then streamed.** Events alone cannot build the room: a
session that was already waiting on a permission before we connected never emitted
`permission.asked` to us, and a reconnect would silently blank the floor. So read a
one-off REST snapshot at connect — sessions plus any open permission requests — to
build the initial desks, then keep them current from the stream, and re-snapshot on
every reconnect. The snapshot and the deltas must feed the same mapper, so that a
session's state does not depend on how we happened to learn about it.

| Event | Desk state |
|---|---|
| `session.execution.started` | working |
| `session.tool.called` / `.success` / `.failed` | working (activity line) |
| `session.text.delta` | working |
| `session.compaction.*` | working, caption "compacting" |
| `permission.asked`, `form.created` | **waiting — needs you** |
| a parent whose child session (`session.created` with `parentID`) is busy | waiting, caption "waiting on another worker" |
| `session.inbox.*` | no change — input arriving, not a wait (see note below the table) |
| `session.execution.succeeded` | success, then idle after a short hold |
| `session.execution.failed` / `.interrupted` | failure, then idle |
| `session.created` / `.deleted` | desk appears / is removed |

*Amended 2026-10-13 by owner ruling.* This table first mapped `session.inbox.*` to
"waiting on another worker". OpenCode v2's inbox items are `user`, `synthetic`,
`compaction` and `move`, and every prompt passes through `inbox.enqueued`, so that
row made every prompt flash the state while a parent really blocked on a subagent
showed "working" (verified on a live recording). The wait now comes from the session
tree: the registry links children by `parentID`, and a parent waits while any child
is working or itself waiting. `execution.interrupted` with reason `shutdown` is idle,
not failure, as in OpenCode's own reducer.

Two states must never collapse into one: **"needs you"** and **"waiting on another
worker"**. The reference project learned this the hard way and encodes it in a
comment; a worker blocked on a sibling is not a worker that needs you.

**Precedence and clearing.** These rules are what stop a desk sticking:

- **"Needs you" wins over everything.** While a permission request is unanswered the
  desk stays on "needs you", whatever else arrives. A text delta, a tool success,
  even a completed execution does not clear it.
- **It clears on `permission.replied`, not on our own button.** The owner may answer
  the prompt in the TUI instead of our rail, and the event arrives either way. Write
  the clear path against the event, never against the UI action.
- **"Needs you" outranks "waiting on another worker."** If both hold, show "needs
  you"; the sibling wait is still true underneath and shows again once the prompt is
  answered.
- **Success and failure are transient.** They hold briefly and then fall back to the
  session's underlying state, which may be "needs you" again.
- **Unknown event types are no-ops, never errors** (§7 R2).

### 6.4 Two rendering planes

A canvas plane for the room (floor, desks, sprites, status glyphs) and a text plane
for the rail. In the reference project this split is canvas for the room and plain
DOM for panels — a direct consequence of their choosing ordinary web text. We
chose full pixel, so **both planes are ours**, but keep the boundary: the room
never renders text, and the text plane never knows about desks.

The boundary is what makes risk R1 survivable.

### 6.5 Develop against fixtures first

OpenCode contains a `packages/simulation` package that appears to be a headless
event-fixture harness. Confirm this early: it would let the room be built and
tested against recorded event streams, so UI work never has to wait on a live
session and the room can be tested deterministically. If it turns out to be
unsuitable, capture a real event stream to a file and replay that instead — the
requirement is only that the room can be driven from a file.

### 6.6 The shell

**An ordinary browser app built with Vite.** No Electron, no proxy process, no
packaging. Verified against the live server:

- The server returns `Access-Control-Allow-Origin` for `localhost` and `127.0.0.1`
  origins on any port, and its preflight answers `204` with `authorization` allowed
  in `Access-Control-Allow-Headers` for `GET, HEAD, PUT, PATCH, POST, DELETE`. A page
  served from a local dev server can therefore call the API directly, streaming
  included.
- The API wants an HTTP Basic header on every request. A browser's `EventSource`
  cannot send one, but `fetch` with a stream reader can, and that is the normal way
  to consume SSE with headers. **Use fetch-streaming, not `EventSource`.** The cost
  is that reconnect becomes ours to write — which we need anyway, since §6.3
  re-snapshots on every reconnect.

So Electron is not needed here, and it would contradict the foundation's own
non-goals (no packaging, no installers). If a real app window is wanted later,
wrapping this same renderer is a small job and changes nothing in §6.3–6.7.

*Earlier drafts of this section chose Electron on the grounds that a browser could
not authenticate. That was wrong on both counts — fetch carries the header, and the
server opens CORS to loopback — and the checks above are what disproved it.*

### 6.7 The rail's data model

The rail shows exactly one session — the selected one. Its backlog comes from
`GET /api/session/{id}/message` when a desk is selected; after that,
`session.text.delta` for **the selected session only** is appended live, and the
view is reconciled against the message list whenever a step ends
(`session.step.ended`). Deltas for unselected sessions are dropped: the room needs
their state, not their text. This trades roughly a step of latency in
reconciliation for a much simpler rail, which is the right trade here.

### 6.8 The automatic default: a free model

"Free" is answerable from OpenCode itself, with no quota introspection and no
routing engine of our own. Verified against the live server:

- `GET /api/model` returns 105 models. Each carries `cost` (tiers of `input`,
  `output`, `cache`), `capabilities` (including `tools`), `status` and `enabled`.
- 86 carry cost information, and **13 are priced at zero on every tier**. All 13 are
  currently tool-capable, active and enabled, and the set includes the owner's
  existing free routes by name.
- There is no free/paid flag, no price field and no quota field. Zero cost is a
  **comparison**, not a property.

So the rule is a filter, applied in this order:

1. `cost` is present, and `input` and `output` are zero on **every** tier.
2. `capabilities.tools` is not false. This matters more than cost does: a free model
   that cannot call tools cannot do agent work at all.
3. Not on the owner's reject list. Two of the thirteen zero-cost models —
   `step-5-preview-free` and the `nemotron-*` entries — are models the owner has
   already tested and excluded. A naive "pick any free model" would route work
   straight back to them.
4. Taken in the owner's preferred order, which already exists as configuration.

Then take the first. Zero cost is not a promise of acceptance — these are
rate-limited tiers, and a 429 is a runtime fact rather than a catalogue fact — so on
refusal fall to the next in order rather than failing the job. That fallback loop is
the entire mechanism: there is no cost model to maintain and nothing to keep in sync
with provider pricing.

Cost-optimising across *paid* models is a different and much larger problem, and
stays out of scope (§3).

## 7. Risks

| | Risk | Mitigation |
|---|---|---|
| **R1** | **Bitmap-font code is the riskiest choice, and nobody has shipped it.** The reference project renders all panels in ordinary DOM text. | Keep the rail's text rendering behind a single component with a plain-text implementation behind the same interface, so a crisp surface can be mounted inside the room without redesigning anything else. This is a fallback, not a plan — the pixel font is the intended look. |
| R2 | The event schema is versioned 0.0.1, OpenCode is on a `dev` branch, and event names may move. | Pin to a version. Keep the mapping in one module (§6.3). Treat unknown event types as no-ops rather than errors. |
| R3 | `opencode serve` may not be able to serve a custom web root. | Unverified, and it does not matter: we serve our own frontend and point it at the API. Do not spend time on this. |
| R4 | The permission flow may be harder to drive than the endpoint list suggests — a request may be tied to a turn rather than sitting in a global queue. | Prove it in slice 4 before building any rail UI around it. If it does not work, that is a finding to report, not something to paper over. |
| R5 | Asset licensing. The reference project's source is MIT but its tilesets are separately licensed. | Every asset is either generated by our own toolchain or under a licence we can state. Record the licence next to the assets. |
| R6 | Bitmap font availability. A complete glyph set is ~200 characters. | Start from an existing open bitmap font. Replace it only if it genuinely grates. Do not hand-draw a font as the first task. |

## 8. Left to the builder

Genuinely open, and cheap to change later:

- Sprite scale (16px is a sane default) and the tile grid.
- Which bitmap font, and its sizes. Needs to work down to a diff.
- How the rail wraps long text in a fixed-width bitmap font. Assume ~35 columns
  wide until proven otherwise; decide the wrapping rule.
- Canvas library: Pixi.js is the proven choice in this space; the platform's own
  2D context is fine for a foundation. Builder's call.
- Worker identity: whether a worker is bound to an OpenCode agent, a session
  template, or a small config file of our own. Investigate `GET /api/agent` first.
- Where the preferred free-model order and the reject list (§6.8) are read from —
  the owner's existing configuration, or a small file of our own. Verify before
  duplicating either.

## 9. Suggested first slices

Each ends in something runnable, and each is independently useful if work stops.

1. **Connect.** SSE client plus session listing, printed to a terminal. Proves auth
   and the event stream, and nothing else.
2. **Room.** A canvas room with one desk per active session, state from §6.3, no
   interaction at all. This is the foundation's centre of gravity.
3. **Rail.** Select a desk; show its messages in the bitmap font; a prompt box that
   posts to `/prompt`. First real steering.
4. **Loop.** Create a session, prompt it, and answer a permission request from the
   rail. This is the definition of done in §2.

## 10. References

- OpenCode: `anomalyco/opencode` (formerly `sst/opencode`), MIT, TypeScript,
  bun. UI is `packages/app`; engine is `core` / `server` / `protocol`.
- Munder Difflin: `HarnessMD/munder-difflin`, MIT source with separately licensed
  assets. Read it for the two-plane split, the status vocabulary and the
  anti-livelock rules; read §7 of that project's recon before copying anything else.

---

*Note for whoever picks this up: §5 is the owner's, §6 is mine and is where to push
back, §7 is what will actually bite. — Sol, 2026-10-12*

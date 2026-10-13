# Director runtime — first paid-model boundary

Implements narrative design §4.2, §5, §7 and D6. Owner delegated autonomous execution
and chose Sol. These implementation defaults are Sol's calls, not new owner decisions.

## Intent and scope

Templates remain immediate. A closed scene may be replaced by checked model lines.
Every surviving line cites its footage; dropped lines leave template coverage behind.
Scene composition failures fall back to the entire template scene. Invent the story,
never the work; real speech remains quote-only. No key means no provider calls.

This slice does NOT add series storage, personas/bibles, recaps, plot labels, model
routing, packaging, reconnect, or animation. No dependencies. No real provider call
is required to test or finish it. Do not borrow OpenCode's credential or provider key.

## Defaults and limits

- Fixed OpenAI `gpt-4.1-mini-2025-04-14`; HTTPS Chat Completions with strict JSON schema.
  Official model docs checked 2026-10-13: $0.40/M input, $1.60/M output.
- Max provider request 65,536 UTF-8 bytes, max completion 1,024 tokens; 3 cents reserved
  BEFORE each call conservatively covers request tokens/overhead and output. Reservations
  remain charged even on failure/abort; they are limits, not measured spend.
- Default per-chat cap 30 cents, per-server-run cap 100 cents. Config in integer cents;
  counters are in-memory and reset on server restart. Not a daily/lifetime budget.
- Separate `FLOORPLAN_DIRECTOR_KEY` and `FLOORPLAN_DIRECTOR_ENABLED=true` in ignored
  `.env.local`; additionally the page starts disabled and requires explicit enable.
- Configure provider-side enforced spending/prepaid limits before opting in. The app
  does not change billing settings and cannot verify provider limits; budget alerts
  alone must not be advertised as provider-enforced hard caps.
- One provider call at a time, one attempt per scene identity. Duplicate concurrent
  requests share an attempt; changed evidence under the same identity is refused.
  No retries on errors. While behind, client keeps only the newest closed scene queued.
- 32,768-byte HTTP scene body, 12 beats, 128 session rows, 24 output lines, 2,000 chars
  per template; finite timestamps/counts and whitelisted detail fields. Raw frames never
  cross the model boundary. Provider responses are bounded and refusal/truncation/errors
  become templates; upstream errors/key/headers are never logged or returned.

## Boundaries

Server-only Vite middleware at `/__director`: GET state; POST control, opt-out and scene.
POST requires a loopback Host, matching Origin, and JSON content type. No CORS. Reject
DNS rebinding/cross-origin requests before reading body or spending. Secrets are never
put in VITE_ variables, client defines, state responses, error strings or bundles.

State begins paused. Global disable aborts in-flight work, retains spent reservations,
and rejects late responses. Per-chat opt-out does the same for that root, including its
guests. Client replay/reset increments an epoch so an old reply can never replace new
footage; the server dedupe/caps survive page reloads within the same server run.

Client queues only scenes closed by a following scene/cap, or by replay flush. Disabling
never blocks the floor. The page offers one global button and an opt-out checkbox per
episode; it explains that scene text/paths/quotes go to OpenAI. No-key status is usable
with templates alone. Replays require explicit enable just like live work.

The output contract is `{lines:[{speaker,template,cites,flashback:boolean}]}`; IDs are
assigned by code. Each cite must belong to this scene. Scene-local slots are supported;
`ordinal`, `first`, `last`, `never`, `cost` are unavailable until full-episode closure/
cost/context is implemented. Dynamic tool/agent/model names and outcome words must be
slots too. Footage/quotes are untrusted data, not instructions. No model tools or I/O.
Missing beat coverage is filled by independent templates; invalid ordering/cast/episode
composition falls back wholesale. Completed narration is rechecked against current
footage/cast before display, never trusted simply because the server returned it.

Builder check (DeepSeek): shared wire types live in narrative/director.ts, not dev.
Server returns `{mode,lines,reason}` after the same pure validator; client validates again.
Client sends the COMPLETE chat's session snapshot (no truncation) to preserve suffixes;
over 128 sessions, corrupt/non-finite evidence or 32,768 bytes means templates/no request.
The provider targets 1–6 short lines; 24 is a defensive output-array ceiling, not a
generation target. The 1,024 token cap remains authoritative; truncation falls back.
Vite's default CORS would precede plugin middleware, so config explicitly disables it.

## Verification

TDD for the real validator, service budget/dedupe/cancellation and HTTP trust boundary,
provider wire contract (mock network only), asynchronous client lifecycle and actual
view replacement. Golden replay remains fully covered with no key. Typecheck, full
suite and build before commits; independent cross-family review before merge. Visible
pixel review remains a separate gap if the desktop browser is hidden.

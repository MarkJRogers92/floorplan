# Handoff — data path and the narrative design

You are picking up half of a project that is being built in parallel with another
agent. Read `HANDOFF.md` at the repo root first — it has the project, the conventions,
the fourteen rulings already made, and the state. This file adds only what is
specific to your half.

Two agents, two worktrees, one repo:

| | you | the other agent |
|---|---|---|
| worktree | `~/Developer/floorplan-claude` | `~/Developer/floorplan` |
| branch | `claude/data-and-narrative` | `foundation` |
| doing | **Tasks 5–9** (the data path) and **the narrative design** | Tasks 10–12 (the room and the wiring) |

Both branches start at `5866656`, where the shared interface was frozen.

## Your assignment

Two halves, and they feed each other:

**A. Tasks 5–9 of the plan — the hard part.**

- **5. Record a stream to disk** — and *keep the recording you make*; part B depends on it.
- **6. Frames → desk state** — the reducer. The centre of gravity of the whole project.
- **7. Seed the floor from a REST snapshot.**
- **8. The desk registry.**
- **9. Replay a recording through the same reducer.**

**B. The narrative layer's design — the creative part.**

A design document at
`docs/superpowers/specs/2026-10-12-narrative-layer-design.md`. This is the reason the
project exists and it is **not in the plan**. Everything known about it is in
`HANDOFF.md` under "The narrative layer — why this project exists", including its one
non-negotiable rule. Do part B after task 5, so you are designing against a real
recording rather than an imagined event stream. That ordering is deliberate: the
rollup layer's rules cannot be written from the spec alone.

## The boundary — the most important section here

Two agents in one repo is safe only if the file boundaries hold.

**Yours:** `src/record/**`, `src/state/**`, `src/replay/**`, `src/cli/**`,
`fixtures/**`, and the matching `tests/**`.

**Not yours:** `src/room/**`, `src/dev/**`, `index.html`, `src/main.ts`,
`vite.config.ts`, `package.json`, `docs/superpowers/plans/**`. If you need a change in
one of these, **stop and report it** rather than making it — a change there breaks
work happening in the other worktree.

**Frozen contract:** `src/state/desk.ts` already exists and exports `DeskStatus` and
`Desk`. The room is being built against those types *right now*. Task 6 adds
`createDesk` and `applyFrame` to that file — **leave the two type declarations
byte-identical.** If you conclude a type genuinely must change, stop and report it as
a concern. This is the one change that would silently break the other branch.

## The process

- One task at a time, in plan order, **test-first**: failing test, run it, see it
  fail, then implement.
- `bun run test` and `bun run typecheck` must both pass before every commit. Both
  commands already work. `node_modules` is installed in your worktree.
- One commit per task at minimum.
- Keep a ledger at `.superpowers/sdd/2026-10-12-foundation-connect-and-room/progress.md`
  in your worktree (it is git-ignored). Record each task's completion with its commit
  range, and record every ruling you make as
  `Ruling: <what you decided> — <why> — <what it costs if wrong>`.
- If the subagent-driven skills are available to you (superpowers: a fresh
  implementer per task, an independent reviewer per task), use them — that is how the
  first four tasks were done. If they are not, implement inline but **get an
  independent review of the whole branch before handing back.** The reviews on the
  first four tasks each caught something real; do not skip this.
- Never fix a review finding yourself if you are the one who wrote the code and you
  are also running the process. Send it back to the implementer.

## Notes that will save you time

- **Task 5's verification step needs a live server.** Run `opencode serve`, then do
  some real work in the OpenCode desktop app, then Ctrl-C the recorder and check
  `fixtures/raw/*.jsonl` has lines that all parse. Session *creation* is deliberately
  out of scope, so drive it from the app.
- **`fixtures/raw/` is git-ignored and recordings are sensitive** — they contain
  prompts, paths and command output. Only scrubbed fixtures go in `fixtures/`.
- **Task 9: check `packages/simulation` in the OpenCode repo first.** The plan asks
  you to; if it is a usable event-fixture harness, prefer it over the hand-written
  sample. Report which you used.
- **The reducer's rules are all in spec §6.3**, including the precedence and clearing
  rules. The plan's Task 6 pins them with fifteen tests. Read both before writing it —
  the subtle part is that "needs you" outranks everything and clears **on
  `permission.replied`, never on your own UI action**, because the human may answer
  the prompt in OpenCode itself.

## Non-negotiables

- **OpenCode is never modified.** This is a client. No patches, no forks, no plugins.
- **No Node-only globals in `src/`** — the shell is a browser app. `node:` imports are
  fine in `tests/`.
- **The service password is read at runtime from
  `~/.local/state/opencode/service.json` and is never committed, logged, printed or
  sent anywhere.** No copy of it exists in this repo.
- **No mock state in any shipped code path.**
- No file over ~400 lines. MIT-compatible dependencies only.

## What to hand back

1. The branch `claude/data-and-narrative`, committed, with tasks 5–9 complete and
   reviewed, and the full suite plus `typecheck` green on the branch tip.
2. `docs/superpowers/specs/2026-10-12-narrative-layer-design.md`, read by a fresh
   reviewer before you finish.
3. A short report: what you did, what you had to rule on and why, what you could not
   verify, and the recording you captured for task 5 (its path — do not commit it).

Then the other agent merges your branch, does Task 12, and runs the suite on the
merged tree.

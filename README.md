# floorplan

A workspace for [OpenCode](https://opencode.ai) that shows your coding agents as a
pixel-art office — one desk per worker, a rail beside the floor for steering, and
every desk's state derived from OpenCode's own event stream rather than guessed.

**Status: very early, and deliberately thin.** This is a foundation, not a tool to
live in. The design and the plan that is being executed both live in `docs/`.

## What exists today

A live room of desks drawn from real OpenCode state:

- reading OpenCode's service file (`src/api/service.ts`)
- one authenticated API client every call goes through (`src/api/client.ts`)
- a server-sent-event parser that survives frames split across chunks (`src/api/sse.ts`)
- a room that draws one desk per session, live from `/api/event` or from a `.jsonl` recording

The rail, the narrative script panel, and automatic permission-answering are deliberately not built yet. See the plan for the order.

## Running it

```sh
bun install
bun run dev         # start the Vite dev server and open the room
bun run test        # vitest
bun run typecheck   # tsc --noEmit
```

`bun run test` and `bun run typecheck` must both pass before any change is committed.

## How it relates to OpenCode

It is a **client**. It does not modify OpenCode, fork it, or patch it — it talks to
the HTTP and SSE API that `opencode serve` already exposes. That is a deliberate
constraint: the engine keeps updating and everything already configured in it keeps
working.

It is not affiliated with OpenCode.

## Where the ideas came from

[Munder Difflin](https://github.com/HarnessMD/munder-difflin) is the closest thing
that exists, and reading its source shaped this design. What was taken is the shape
— a room, a desk per worker, status driven by structured lifecycle events, and a
strict separation between the process doing the work and the model making
judgements. What was deliberately not taken is its approach of wrapping a dozen
other agent CLIs behind per-CLI hook shims and proxies; sitting on one engine's
native event stream removes that whole category of work.

## Licence

MIT — see `LICENSE`.

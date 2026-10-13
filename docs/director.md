# Optional Director

Without configuration the app uses templates, sends nothing to a model, and needs
no key. The floor and Replay work independently of the Director.

To opt in, create a **separate** OpenAI key/account with enforced provider-side
spending or prepaid limits. Do not reuse OpenCode's key. Provider budget alerts may
be advisory, not enforced; the app cannot verify or change your billing controls.
Copy `.env.example` to ignored `.env.local`, set `FLOORPLAN_DIRECTOR_KEY`, and set
`FLOORPLAN_DIRECTOR_ENABLED=true`. Restart `bun run dev`. Then explicitly enable
the Director on the page. No configuration or key is changed automatically.

**Privacy:** enabling sends closed scenes' tool names, paths, agent names and real
text/reasoning quotes to OpenAI. Quotes/footage are treated as untrusted model input.
No raw event stream or OpenCode password is sent. The API key stays in the local
dev process, never in a VITE_ variable, browser state, public response or build.

The fixed model is `gpt-4.1-mini-2025-04-14`. Requests are bounded to 65,536 UTF-8
bytes and 1,024 completion tokens. At the documented $0.40/M input and $1.60/M output
prices (verified 2026-10-13), a conservative **3-cent reservation** covers each
attempt. This is reserved capacity, not measured actual spend. Errors, cancellations
and invalid jokes still consume their reservation because they may be billed.
Recheck pricing before changing the model or request limits.

Defaults: **30 cents per chat** and **100 cents per dev-server run**. Integer-cent
env settings may change these caps. Duplicate scenes share one attempt; requests
over a cap, corrupt/oversize scenes, busy service, refusals, truncation and errors use
templates. There are no automatic retries. Counters survive page reloads but reset
on dev-server restart; these are **not daily or lifetime limits**. Use independent
provider controls for a durable account-wide spending boundary.

The global disable stops scheduling and aborts the in-flight request. A per-chat
opt-out excludes that root and its guests. A request already sent may still incur
a charge; its reply cannot be displayed after disable/opt-out/replay reset.
Slow narration keeps only the latest waiting scene; skipped scenes retain templates.

The middleware is dev-only and loopback-only. POST requires matching Origin and
Host plus JSON. Vite CORS is disabled explicitly; forged Hosts/foreign origins fail
before spending. No custom provider URL is accepted. Do not expose the dev server
through a public tunnel. A static production build deliberately has no Director route.

Series continuity, recaps, personas and full-episode absence/ordinal/cost slots are
not implemented yet. A scene closing does not prove that an episode never did something.

# Earlier-footage recaps

Owner approved “Previously on…” recaps, then staged reactions, with autonomous execution.
Recaps stay local/template-only: no model calls, archive edits or invented history.

## Montage, not a complete-history claim

When a live episode has known root/project scope and timestamped footage, read a short
montage above its script. Always label “From earlier archived footage; may be incomplete.”
Rejoined chats keep the same episode ID; the current root is excluded entirely.
Do not infer completion, absence, season/episode numbers or new parts of resumed chats.
Replay/unknown scope/missing times never read recap history. Failure leaves the script/floor running.

Choose at most3 moments from at most2 recent eligible archived episodes in the same key.
Only beats with finite positive at/endAt, endAt>=at and endAt strictly before the first
known current-footage at are eligible. Unknown/inverted/future/equal timestamps are not guessed.
Priority: tool-fails7, knocks/answered6, cut/memory-wipe5, retry4, wrap3, says2, uses-tool1.
Other kinds omitted. Quotes longer than240 chars, unrenderable lines or proof packets
over12,000 UTF8 bytes are omitted, never truncated. Prefer one highlight per eligible
episode; fill the third from remaining highest-priority/newest candidates. Present
episodes oldest-to-newest, retaining archived beat order within each selected episode.
Recent means latest eligible endAt, not filesystem write time; deterministic ties retain
first-seen archive order. Scope is a montage of available observations, not full-history ordinals.

## Evidence boundary

`RecapMoment={episodeID:string,beat:Beat,session:{id:string,agent?:string}}`.
`Recap={key:string,rootSessionID:string,before:number,coverage:'partial',moments:RecapMoment[]}`.
Use the stored actor's raw agent name (unknown stays unidentified). Ref is the pair
`{episodeID,beatID:beat.id}`; repeated beat IDs in different episodes cannot collide.
Reuse assembleScript/templateFor/renderLine for each isolated moment with castFor([session]).
No additional historical slots, model-authored factual text, full old streams or raw
archive forwarding. Browser revalidates proof and recomputes lines, rather than trusting
a server-supplied freeform story. Recap JSON max65,536 UTF8 bytes, moments max3/episodes max2.

Pure module `buildRecap(archive,root,before):Recap`, `parseRecap(value,key,root,before):Recap|undefined`,
`recapLines(recap):{ref:{episodeID,beatID},text,delivery,speaker}[]`.
Parser requires exact envelopes/moment/session fields, matching key/root/before, partial
coverage, unique paired refs, different valid ep:<root>, single-beat parseEvidence, matching
session.id/beat.sessionID, positive earlier timing, allowed kinds/quote/text/proof caps.
Unknown or inconsistent input refuses the whole recap. No I/O inside pure helpers.

## Serving and page

GET `/__series/recap?key&root&before` uses the existing loopback Host/Origin guards,
no-store/nosniff JSON, bounded output and private validated store.load; never creates data.
Validate before as finite positive <=Number.MAX_SAFE_INTEGER. No caller disk paths.
Standalone nonblocking recap client caches per root+key+cutoff, dedupes unchanged inputs,
aborts superseded/reset/replay reads and rejects late replies even when fetch ignores abort.
Only roots with observed footage read, not every REST chat. No read-triggered POST/retry loops.
Never pass recap content to Director, stage.update or current scene evidence.
Render safe textContent with real-speech styling, visible/focusable episode+beat citations.
No timestamp guessing or fake “no history” claim; empty recaps are hidden.
Keep main<400 lines by moving the existing DOM helpers into an app renderer, not duplicating them.

## Verification

Synthetic pure tests: selection/bounds/ties/current root/future/unknown times, repeated
beat IDs across episodes, quote/unsafe input, deterministic proved lines. Real temp-store
HTTP tests: matching scope/read-only/guards/bad clock/corrupt archive. Client tests:
known footage only, same input dedupe, scope/cutoff/reset/replay races, storage failures.
Full tests/typecheck/build/secret audit and actual synthetic page assertions; no real
private archive/recording/key material to workers or provider app traffic. Independent review.

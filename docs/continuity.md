# Local series continuity

Live episodes are stored by their observed project identity, under:

`~/.local/state/floorplan/series/<sha256(project-key)>/series.json`

The digest makes a safe filename, **not encryption**. Files are private0600 and
directories0700. They can contain real paths, worker quotes and event references;
do not commit them, share them with free/contributor models, or treat them as scrubbed
fixtures. The browser is only a read-through client, not the durable store.

The root chat's directory identity governs guests. Project IDs are a fallback when
no directory is known; an unknown root is not guessed from Floorplan's working
directory. An ID-to-directory upgrade uses a separate key without deleting old data.
Replays do not autosave, so test or incomplete recordings cannot pollute live history.

Saving a rejoined partial episode is additive: old beats remain, repeated IDs are
counted once, and genuinely conflicting immutable beats refuse the entire update.
Corrupt files, unsafe symlinks, stale locks and full archives are reported, never
silently replaced or evicted. Scope failures/storage errors do not stop OpenCode or
the floor. Existing restrictive permissions are respected, not loosened to force a save.

Limits:2MiB per episode update,10,000 beats/256 session rows;32MiB/256 episodes per
series archive. This is a dev-scale archive, not unbounded event storage. If it fills,
back up and inspect the JSON deliberately; no automatic history deletion is performed.
If a crashed writer leaves `.lock`, stop all writers and inspect/back up that series
before removing the exact stale lock. Never remove another active writer's lock.

Character bibles are computed from actual archived beats and retain episode/beat
proof refs. Recurring identity is the real agent name, not a per-chat display suffix.
Unknown agents stay unidentified. Bibles are facts; personas are short **invented
story descriptions**, saved once with a real debut reference and reused afterwards.
You may hand-edit a persona's text if the archive stays valid; generated suggestions
do not overwrite it. It is not a quote or a statement of work actually performed.

With no Director key/page opt-in, history stays local and narration is template-only.
When opted in, a bounded previous-episode summary and saved personas for this scene's
agents may be sent to the existing fixed model. No extra model call is added, no raw
old frames/quotes are sent, and the same spending/disable/opt-out checks apply.
Historical statistics guide fictional motives, not factual claims: full-history
ordinal/absence/cost slots and “Previously on…” are not implemented yet.

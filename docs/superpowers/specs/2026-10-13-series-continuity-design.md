# Series continuity — local archive and recurring characters

Implements narrative design §5.5/D2/D7. Owner approved autonomous continuation and
Sol integration, with Luna/Muse/free workers permitted for non-confidential tasks.

## Smallest useful result

Project-scoped episodes survive browser reloads and dev-server restarts. Character
bibles are recomputed from stored beats, each statistic retaining episode/beat refs.
The opted-in Director receives this evidence-backed background (never raw past frames)
and can create a short invented persona on an agent's first appearance. The persona
is saved once, reused in later episodes, and never substitutes for a work fact.

No recaps, season numbering, new model calls, history-derived factual slots, deletion
UI, remote storage, DB, authentication overhaul, reconnect or animation in this slice.
Historical work facts still cannot appear in free text; current scene slots remain
the only model line fact source. No key means templates and local archive only.

## Project identity and archive

Keep `SessionInfo.seriesKey?`: `directory:<directory>` from the frame or created-data
location, else `project:<projectID>` from created data or REST snapshot. Never infer
the working project from Floorplan's own directory. Root metadata governs its guests;
unknown identity stays unarchived with a plain status, not a fake default series.
Once a directory key is known, lower-priority project IDs never overwrite it.
Scope changes must not erase the earlier archive; ID→directory upgrades are visible
as separate keys for now, with no destructive automatic migration.

`ArchivedEpisode = {id:'ep:<root>',rootSessionID,seriesKey,sessions,beats}`.
`SeriesArchive = {version:1,key,episodes:ArchivedEpisode[],personas:Persona[]}`.
`Persona = {agent,text,debut:{episodeID,beatID}}`; max160 chars, no work-name/path/
number/outcome claims in text, actual known agent and stored debut. Fiction is labeled.
Character identity is the base agent name across episodes, not per-chat cast suffixes;
unknown is unidentified, never a guessed name. Bibles count tool mix, think deltas,
wraps/cuts/knocks with refs; duplicates never inflate counts. Current episode is
excluded from prior-history Director context.

Store at `~/.local/state/floorplan/series/<sha256(key)>/series.json`. Digest is a
filesystem-safe opaque name, not encryption. JSON keeps the exact key for inspection.
Directories0700/files0600; no browser-supplied disk path. Reject symlink series dirs,
archive files and locks, corrupt files or oversized existing data. Never silently
replace corruption with an empty file. A serialized/exclusive per-series lock rejects
concurrent external writers; atomic temp-write/fsync/rename preserves the previous
file on pre-rename failure. Stale locks are reported, never deleted speculatively.

Save is additive: merge episode/session/beat IDs in original first-seen order, retain
older beats absent from a rejoined partial snapshot, reject differing immutable beats
under the same ID, merge only defined session metadata. Persona creation is write-once;
later generated suggestions never overwrite existing/hand-edited personalities.
Bounds: episode request2MiB,10,000 beats,256 session rows; archive32MiB/256 episodes;
bad or full archive stays intact and the floor/narrative carries on. No silent eviction.

## Dev boundary and page

Node I/O stays in `server/series-store.ts`, outside browser src. Vite's loopback-only,
CORS-disabled dev plugin mounts `/__series/context` (GET key) and `/__series/episode`
(POST archive update). Reuse the exact Director Host/Origin/JSON protections rather
than introduce a weaker storage route. Shared pure validators accept only archive
fields, finite numbers, known beat kinds, unique IDs and acyclic parents.

Live observed closed beats save at scene boundaries/wraps through a nonblocking client
queue. Save failures are visible and never block OpenCode or floor drawing. Browser
holds only read-through context/status; files are durable. Replays do not autosave,
so an incomplete/test recording cannot pollute live history. Local history may contain
paths/quotes; it is private local data, not a committed fixture or free-model input.
Unknown key or a static build with no dev route uses live templates without persistence.

## Director continuity

Optional `seriesKey` on its existing request selects local history. Server loads a
bounded bible/persona context for agents in the current scene, excluding current root;
missing/corrupt history degrades to stateless checked narration. Context is advisory
for invented character motives only, never a license to assert past work without slots.
Only when already opted in does this background go to the fixed provider. Existing
3-cent reservation, request/output limits, kill switch and opt-outs remain unchanged.

The existing completion may additionally return `personas:[{agent,text}]` (max2 new
personas, short), no extra generation call. Server validates, archives the current
scene evidence then creates missing profiles; failed storage cannot produce a false
saved status or an invented debut. The client's lines are checked as before. Bad
persona proposals are dropped independently. Once saved, a persona stays the same
unless its local JSON is deliberately hand-edited and remains valid.

## Verification and defaults owned by Sol

TDD for scope fallbacks/root inheritance; real temporary-directory archive tests
for additive saves, conflict/corruption, symlinks, locks, permissions and atomic writes;
pure bible aggregation with exact refs; fake-provider context/profile reuse without
paid app calls; client live/replay/reset/error isolation. Fresh full suite/typecheck/
build plus independent cross-family review. All test storage uses approved temp dirs,
never the user's real archive. No worker may read `.env`, raw recordings, service
credentials or actual stored history; free/Muse work is public code + synthetic inputs.

Builder check clarifications: source scope is normalized once into seriesKey (no
redundant persisted directory/projectID fields); root key wins, unknown root stays
unknown. Canonical session.agent is already the base name—never strip a legitimate
agent's suffix merely because it resembles a chat cast suffix. Beat conflicts fail
the whole save, not just one beat, but JSON property ordering is immaterial.
Provider continuity is bounded to8KiB, at most8 current agents,6 tool categories and
illustrative proof refs per character; full citable bibles remain local in the archive.
This advisory subset cannot justify historical-fact slots. Scene evidence is never
truncated to make history fit; drop advisory context first at the fixed provider cap.

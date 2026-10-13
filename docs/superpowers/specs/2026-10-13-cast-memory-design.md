# Cast memory — make local continuity visible

Owner requested autonomous next improvements after continuity merged at e22e2d6.
Sol's choice: consume the existing read-through context before adding recaps or art.

## Smallest useful result

Live episodes gain a collapsed native `details` disclosure titled “Cast memory”.
For up to8 known agents belonging to this episode, show a saved persona as
“Invented persona” with its exact debut episode/beat reference, and prior archived
episode IDs as “Previous appearances”. Empty agents/cards are omitted. No guessed
names, current-episode historical claims, metrics dashboard, recap lines or quotes.
Disclosure state survives script rerenders; script/floor layout remains unchanged.
Use textContent/native summary for safe text and keyboard accessibility.

## Read-through client

Read context when a live root has observed footage and known scope/agents, even before
a save milestone. Metadata-only REST roots have no displayed episode and do not read
history. Cache by BOTH series key and root ID: the server excludes that root,
so a project-wide-only cache is incorrect when two live chats share a project.
Refresh on agent-list changes and acknowledged saves; ignore/abort superseded reads.
Keep last-good context during agent changes; current-cast filtering prevents departed
agents from being shown, and the open disclosure remains present while new data loads.
Reset/replay abort reads and clear context; replay never fetches durable history.
Read failures are reported in the shared status and never abort saving, the floor or
template narration. Later read/save activity may replace that status message.
No fetch on each frame for unchanged scope/root/agents. Current cast only, at most8.

`CastMemoryContext = {key,episodeCount,bibles:{agent,episodes}[],personas:Persona[]}`.
`parseCastMemoryContext(value,key,root)` validates/project-selects only displayed
fields, rejecting mismatched key, invalid counts/IDs, duplicate rows and current-root
appearances. Persona text uses existing validPersonaText; debut may be in current
root because it is fiction already saved with real proof. No new factual story slots.
`castMemoryCards(context,agents)` filters/dedupes current real agents, omits unknown
and empty rows, returns `{agent,episodes,persona?}` in cast order (max8).

Client produces `contextFor(key,root)` rather than an unscoped project cache getter.
Keep all existing save retry/reset/Origin/spend behavior. Load and save are independent;
successful save cannot wait on context, and failed GET cannot trigger repeated POSTs.

## Boundaries and verification

Existing TypeScript/Vite/Vitest/Node only; no dependencies/provider calls/art generation.
No archive editing or old beat bodies. Unknown scope and replay remain isolated.
Workers use public code and synthetic fixtures, never keys/raw/default archives.
TDD for projection/filtering, root-specific initial reads, coalescing/supersession,
no-key reads, failure isolation and reset/replay. Actual browser synthetic cards check
safe text/native disclosure persistence; normal replay stays empty. Full suite,
typecheck/build and a fresh independent read-only final review before integration.

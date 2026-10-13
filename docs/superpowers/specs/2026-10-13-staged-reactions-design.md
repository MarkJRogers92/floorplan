# Staged reactions, first pass

Owner approved poses/reactions driven by the same real beats, after recaps. Aseprite
live connection was restored (1.3.18.6/extension0.8.2), with no sprite initially open.
Use existing room/layout/status truth; no new model/art generation calls or dependencies.

## Runtime

Pure `createStageRuntime()` produces `update(arrived:Beat[],now:number)`,
`frames(now:number,reducedMotion=false):Map<string,StageFrame>`, `reset()`.
`StageFrame={sessionID,beatID,kind:BeatKind,pose:StagePose,dx,dy}`.
`StagePose='idle'|'think'|'speak'|'work'|'recoil'|'alert'|'arrive'|'leave'|'wrap'|'cut'|'forget'|'retry'`.
Map thinks→think, says→speak, uses-tool→work, tool-fails→recoil, knocks/answered→alert,
guest-arrives/leaves→arrive/leave, wrap→wrap (not success), cut→cut, memory-wipe→forget,
retry→retry; all other known kinds→idle. No invented outcome or missing-agent name.
Guest arrival/departure/briefing actors are detail.childSessionID, not the parent.
Deduplicate by source session+beat ID so re-render/repeated input cannot replay reactions.
Reception clock is explicit finite nonnegative now, never archived epoch timestamps.
Keep the newest cue per actor for2,000ms; invalid/negative/backwards clock produces no frame.
Offsets are deterministic integer pixels in[-3,3], expire to baseline, and become0/0
under reduced motion. No timers/provider work in the runtime; reset clears cues/dedupe.
Only arrived current/replay beats update it: historical recap callbacks never animate it.

## Rendering and art

Extend room.draw with optional stage frames and worker image; old draw(desks) still works.
Draw only existing desks, never resurrect deleted actors. Keep status colours/ordering/
overflow policy unchanged; staged rectangles/poses stay inside their own layout cell.
Show a small stage notice and latest visible cue's kind/beat citation as a dramatised
reaction, not a claim that the actual worker physically walked or celebrated.
Respect matchMedia prefers-reduced-motion. Shared neutral sprites represent workers,
not the human audience. If image load fails, existing desk geometry remains usable.

Create one small neutral office-worker asset by hand in the user's live Aseprite:
Five16x20 transparent poses idle/think/speak/work/recoil, reusable for all agent names.
Execution refinement: one80x20 layered frame with five named pose slices, not five
timeline frames, so each rig-layer painting batch covers all poses in one undo step.
PICO-8 initialization was explicitly approved for the new black-only blank palette.
Choose existing document palette entries after sprite_info; no palette widening or
reference/model generation. New document only, not repainting the user's work.
Follow artist workflows: rules index/brief/concept (continue without generated reference),
new/sprite_info, batched draw, look/validate, explicit live save/export.
Export PNG atlas + native source into repo assets using artist tools only; nearest-neighbour
draw in browser. No sprite files written by shell/code fallback and no headless bypass.
If the artist cannot connect or visual/validation fails, preserve stage/runtime progress
but do not claim finished character art. Report the actual remaining limitation.

## Verification

Pure cue tests cover kind/target/proof, duplicate and cross-session IDs, expiry/reset,
reduced motion/clock validation and bounded changing offsets. Pure room geometry tests
cover clipping/own-cell bounds and unchanged status colours. Browser synthetic beats
prove stage citations/current actor association, no history-driven movement, replay/reset,
image load/actual canvas draw. Inspect sprite with look and validate, not mechanical-only
claims. Full suite/typecheck/build and independent public/synthetic-only review.

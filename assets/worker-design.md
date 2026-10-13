# Office-clerk actor, first pass

Sol's art choice under delegated staging work: a small monitor-headed robot clerk,
not a likeness or the unseen human audience. Symbolic reusable worker; individual
identity remains the real session/agent name and cited footage, not a guessed face.

16x20 RGBA, front three-quarter facing right, upper-left light, selective dark navy
outline, hard pixels/binary alpha. Five static key poses: idle, think (hand under chin),
speak (one raised hand), work (arms forward), recoil (lean/raised arms). No text/scenery.
Head7px, torso6px, separate short legs/feet, feet share y18. Keep the body/rig volumes
stable, distinguish poses by silhouette, do not claim a finished walk/breathing cycle.

User explicitly approved PICO-8 initialization on this new document after its palette
was found to be entirely black. The prior user artwork was not changed. Used roles:
navy#1d2b53 outline/cloth shadow, purple#83769c cool metal shadow,
grey#c2c3c7 metal base, warm cream#fff1e8 highlight,
cyan#29adff coat, amber#ffa300 badge, green#00e436 screen eyes.
No palette widening after that initialization, reference generation or paid calls.

Optional ready-to-paste reference prompt (not executed; proceeding without references
under the owner's “keep pushing forward” delegation):

```text
Pixel art character concept sheet of a monitor-headed robot office clerk, dependable
and mildly exhausted. Front three-quarter view facing right, camera locked, light from
upper-left. About eighteen pixels tall on a sixteen-by-twenty transparent sprite,
hard pixel edges, no anti-aliasing or gradients, selective dark navy outline.
Use only #1d2b53 navy, #83769c cool shadow, #c2c3c7 grey metal, #fff1e8 warm highlight,
#29adff cyan coat, #ffa300 amber badge and #00e436 green screen eyes.
Exactly five equal panels in one horizontal row, identical scale and ground line:
idle; thinking with a hand at its chin; speaking with one raised hand; working with
arms forward; recoiling with a leftward lean and raised arms.
Flat plain grey background; no scenery, text, labels, borders or watermark.
```

Native source is one layered frame with five named16x20 slices,80x20 total. This lets
the live draw API batch all five poses on each rig layer in one undo step. Exported JSON
preserves the slices; these are static key poses, not a timeline animation.
The app uses nearest-neighbour2x rendering; stage offsets stay in the actor's own cell.

Independent Luna/OpenAI visual critique scored the first draft6/10, usable as first-pass
poses without blockers, and requested clearer hand-to-chin contact. Sol made that
focused thinking-arm fix, inspected it at2x/8x, then saved/exported through live tools.
Luna's follow-up read of the final PNG scored7/10, with clearer chin contact and no
concrete blockers; contact remains subtle at1x. Still first-pass poses, not full office art.
Aseprite validate passed80/100 with four selective/per-layer-outline warnings;
Pixel Forge lint passed95/100 with one flattened-outline warning. Retained deliberately:
upper-left highlights and limb attachment edges are not uniformly outlined. No palette,
stray-pixel or soft-alpha errors were reported. Mechanical scores are not art approval.

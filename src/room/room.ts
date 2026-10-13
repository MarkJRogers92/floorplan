/**
 * The public room surface (Task 1, office-experiment). The scene itself is the office in
 * `./office`; this module keeps the names existing callers and tests already import.
 *
 * `statusColour` and `reactionRect` keep their exact values and semantics, and
 * `createRoom(canvas, worker)` still takes the same two arguments, so the two-argument
 * callers are unchanged. The legacy grid in `./layout` is untouched.
 */
export { createRoom, officeLayout, reactionRect, statusColour } from './office'

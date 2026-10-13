export type Rect = { x: number; y: number; w: number; h: number }

const PAD = 8
// The brief says 6px, but its own test expects 8 -> 62 with 50px cells (a 4px gap); the tests win.
const GAP = 4

// Desk rectangles on a grid, filled row by row. Pure: no DOM, no desks.
// shortcut: desks beyond the last visible row are placed off-screen and simply not drawn; add scrolling or paging when a person actually runs more sessions than fit.
export function layout(count: number, bounds: { w: number; h: number }, cell = 48): Rect[] {
  const cols = Math.max(1, Math.floor((bounds.w - PAD * 2) / (cell + GAP)))
  const out: Rect[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      x: PAD + (i % cols) * (cell + GAP),
      y: PAD + Math.floor(i / cols) * (cell + GAP),
      w: cell,
      h: cell,
    })
  }
  return out
}

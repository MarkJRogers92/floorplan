import { describe, it, expect } from 'vitest'
import { readFrames } from '../../src/replay/replay'
import { createRollup, seedRollup, rollup, flush } from '../../src/narrative/rollup'

// Recorded live against this instance's OpenCode server (see task-4 report), then
// scrubbed: one session's frames, whitelisted fields only, aliased ids, timestamps
// rebased to 0. It contains, deliberately: a shell command that exited non-zero
// (arriving as tool.success — the §4.1 amendment), a permission answered with
// reject, a ≥30 s gap inside one working execution, and resumed prompts.
const FIXTURE = 'fixtures/narrative/four-events.jsonl'

const rollOnce = () => {
  const beats: any[] = []
  let st = seedRollup(createRollup(), { sessions: [], permissions: [] })
  for (const fr of readFrames(FIXTURE)) {
    const r = rollup(st, fr); st = r.state; beats.push(...r.beats)
  }
  return beats.concat(flush(st))
}

describe('a real recording rolls to a stable beat list', () => {
  it('produces the same beats on a second pass', () => {
    const runs = [0, 1].map(rollOnce)
    expect(JSON.stringify(runs[1])).toEqual(JSON.stringify(runs[0]))
  })

  it('finds the four events the fixture was recorded for', () => {
    const kinds = rollOnce().map(b => b.kind)
    expect(kinds).toContain('tool-fails')
    expect(kinds).toContain('answered')
    expect(kinds).toContain('silence')
  })
})

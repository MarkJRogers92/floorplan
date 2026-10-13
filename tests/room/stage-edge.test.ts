import { it, expect } from 'vitest'
import { createStageRuntime } from '../../src/room/stage'
import type { Beat } from '../../src/narrative/types'

const beat = (sessionID: string, id: string): Beat => ({ id, sessionID, at: 1_700_000_000_000,
  endAt: 1_700_000_000_010, eventIDs: ['proof'], kind: 'tool-fails', detail: { kind: 'tool-fails', tool: 'shell', exit: 7 } })
it('reaction motion changes with reception time rather than only changing when the beat changes', () => {
  const stage = createStageRuntime()
  stage.update([beat('actor', 'reaction')], 0)
  const first = stage.frames(0).get('actor')!
  const later = stage.frames(150).get('actor')!
  expect([later.dx, later.dy]).not.toEqual([first.dx, first.dy])
  expect([later.beatID, later.kind, later.pose]).toEqual(['reaction', 'tool-fails', 'recoil'])
})
it('opaque source-session and beat pairs do not collide through embedded separators', () => {
  const stage = createStageRuntime()
  stage.update([beat('a', 'b\u0000c'), beat('a\u0000b', 'c')], 0)
  expect([...stage.frames(0).keys()]).toEqual(['a', 'a\u0000b'])
})

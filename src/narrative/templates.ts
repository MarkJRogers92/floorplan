/**
 * Default template lines for every beat kind (design §5.1). Each returns a
 * `Line` that cites at least its own beat, written in the owner's settled
 * voice: deadpan, darkly comic, bleak about the framing, never about whether
 * the events happened.
 */

import type { CastID, castFor } from './cast'
import type { Beat } from './types'
import type { Line } from './line'

type Ctx = { cast: ReturnType<typeof castFor>; beats: Beat[] }

const id = (beat: Beat): string => beat.id

const narrator = (template: string, cites: string[]): Line => ({
  id: `line-${cites[0] ?? 'none'}`,
  speaker: 'narrator',
  template,
  cites,
})

const character = (speaker: CastID, template: string, cites: string[]): Line => ({
  id: `line-${cites[0] ?? 'none'}`,
  speaker,
  template,
  cites,
})

const agentOf = (beat: Beat, ctx: Ctx): CastID => ctx.cast(beat.sessionID)

export function templateFor(beat: Beat, ctx: Ctx): Line {
  switch (beat.kind) {
    case 'episode-opens':
      return narrator('The episode opened.', [id(beat)])

    case 'human-asks':
      return narrator('The Human had a question.', [id(beat)])

    case 'briefing':
      return narrator('A guest was briefed.', [id(beat)])

    case 'thinks':
      return narrator('{agent:' + id(beat) + '} sat with {deltas:' + id(beat) + '} thoughts.', [id(beat)])

    case 'says': {
      const runDetail = beat.detail as { deltas: number; text?: string }
      if (runDetail.text !== undefined && runDetail.text !== '') {
        return character(agentOf(beat, ctx), '{quote:' + id(beat) + '}', [id(beat)])
      }
      if (runDetail.deltas === 0) return narrator('{agent:' + id(beat) + '} said its piece.', [id(beat)])
      return narrator('{agent:' + id(beat) + '} said its piece in {deltas:' + id(beat) + '} parts.', [id(beat)])
    }

    case 'uses-tool': {
      const toolDetail = beat.detail as { tool: string | 'unknown'; callID?: string; path?: string; exit?: number }
      const pathPart = toolDetail.path ? ' on {path:' + id(beat) + '}' : ''
      return narrator('{agent:' + id(beat) + '} pointed {tool:' + id(beat) + '}' + pathPart + '.', [id(beat)])
    }

    case 'tool-fails':
      return narrator('{agent:' + id(beat) + '} called {tool:' + id(beat) + '}; the result was {outcome:' + id(beat) + '}.', [id(beat)])

    case 'guest-arrives':
      return narrator('{agent:' + id(beat) + '} arrived.', [id(beat)])

    case 'guest-leaves':
      return narrator('A guest left.', [id(beat)])

    case 'knocks':
      return narrator('Someone knocked.', [id(beat)])

    case 'answered':
      return narrator((beat.detail as { reply: string }).reply
        ? 'The knock was answered: {outcome:' + id(beat) + '}.'
        : 'The knock was answered.', [id(beat)])

    case 'retry':
      return narrator('A retry was scheduled.', [id(beat)])

    case 'memory-wipe':
      return narrator('And then, as happens to us all, it forgot.', [id(beat)])

    case 'wrap':
      return narrator('The episode wrapped.', [id(beat)])

    case 'cut':
      return narrator('{outcome:' + id(beat) + '}.', [id(beat)])

    case 'silence':
      return narrator('Nothing happened for {gap:' + id(beat) + '}.', [id(beat)])
  }
}

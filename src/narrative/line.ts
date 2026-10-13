/**
 * Template lines and their checker (design §5.1). A `Line` is a speaker, a
 * template string with typed `{slots}`, and the beat ids it cites. Rendering
 * fills each slot from those beats' own events, rejects any line that cannot
 * prove its claims, and marks every line with a delivery so the viewer can tell
 * a worker's real words from words written for the scene.
 */

import type { CastID } from './cast'
import type { Beat } from './types'
import { lintFreeText, numberToWords } from './vocabulary'

export type Line = {
  id: string
  speaker: 'narrator' | CastID
  template: string
  cites: string[]
  flashback?: true
}

export type Rendered = { text: string; delivery: 'narration' | 'real-speech' | 'dramatised' }

type Ctx = { cast: (sessionID: string) => CastID; beats: Beat[]; closed?: boolean }

const reject = (reason: string): { rejected: string } => ({ rejected: reason })

// ---------------------------------------------------------------------------
// Slot grammar
// ---------------------------------------------------------------------------

type Slot =
  | { name: 'count'; key: string; range: Range }
  | { name: 'deltas'; range: Range }
  | { name: 'ordinal'; key: string; beat: string }
  | { name: 'again'; a: string; b: string }
  | { name: 'first'; key: string; beat: string }
  | { name: 'last'; key: string; beat: string }
  | { name: 'before'; a: string; b: string }
  | { name: 'tool'; beat: string }
  | { name: 'agent'; beat: string }
  | { name: 'path'; beat: string }
  | { name: 'outcome'; beat: string }
  | { name: 'dur'; range: Range }
  | { name: 'cost'; range: Range }
  | { name: 'quote'; beat: string }
  | { name: 'gap'; beat: string }
  | { name: 'never'; key: string }
  | { name: 'hedge' }

type Range = { from: string; to: string }

const SLOT_RE = /\{([^}]+)\}/g

const splitArgs = (inner: string): string[] =>
  inner.split(',').map(s => s.trim()).filter(Boolean)

const parseRange = (s: string): Range | undefined => {
  const parts = s.split('..')
  if (parts.length === 2) return { from: parts[0]!.trim(), to: parts[1]!.trim() }
  if (parts.length === 1) return { from: s.trim(), to: s.trim() }
  return undefined
}

const parseSlot = (inner: string): Slot | undefined => {
  const [name, ...rest] = inner.split(':')
  const args = splitArgs(rest.join(':'))
  switch (name) {
    case 'count': {
      if (args.length < 2) return undefined
      const range = parseRange(args.slice(1).join(','))
      if (range === undefined) return undefined
      return { name: 'count', key: args[0]!, range }
    }
    case 'deltas': {
      if (args.length < 1) return undefined
      const range = parseRange(args.join(','))
      if (range === undefined) return undefined
      return { name: 'deltas', range }
    }
    case 'ordinal': {
      if (args.length < 2) return undefined
      return { name: 'ordinal', key: args[0]!, beat: args[args.length - 1]! }
    }
    case 'again': {
      if (args.length < 2) return undefined
      return { name: 'again', a: args[0]!, b: args[args.length - 1]! }
    }
    case 'first': {
      if (args.length < 2) return undefined
      return { name: 'first', key: args[0]!, beat: args[args.length - 1]! }
    }
    case 'last': {
      if (args.length < 2) return undefined
      return { name: 'last', key: args[0]!, beat: args[args.length - 1]! }
    }
    case 'before': {
      if (args.length < 2) return undefined
      return { name: 'before', a: args[0]!, b: args[args.length - 1]! }
    }
    case 'tool':
    case 'agent':
    case 'path':
    case 'outcome':
    case 'quote':
    case 'gap': {
      if (args.length !== 1) return undefined
      return { name, beat: args[0]! }
    }
    case 'dur':
    case 'cost': {
      if (args.length < 1) return undefined
      const range = parseRange(args.join(','))
      if (range === undefined) return undefined
      return { name, range }
    }
    case 'never': {
      if (args.length !== 1) return undefined
      return { name: 'never', key: args[0]! }
    }
    case 'hedge': {
      if (args.length !== 0) return undefined
      return { name: 'hedge' }
    }
    default:
      return undefined
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ordinalWord = (n: number): string => {
  const map = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth',
    'seventh', 'eighth', 'ninth', 'tenth']
  if (n >= 1 && n <= 10) return map[n - 1]!
  const s = String(n)
  const last = s.slice(-1)
  const suffix = last === '1' ? 'st' : last === '2' ? 'nd' : last === '3' ? 'rd' : 'th'
  return `${s}${suffix}`
}

const formatDuration = (ms: number): string | undefined => {
  if (!Number.isFinite(ms)) ms = 0
  if (ms < 0) return undefined
  const sec = Math.floor(ms / 1000)
  if (sec < 60) {
    const rounded = Math.floor(sec / 5) * 5
    return rounded === 0 ? 'a moment' : `${numberToWords(rounded)} seconds`
  }
  const min = Math.floor(sec / 60)
  return `${numberToWords(min)} minute${min === 1 ? '' : 's'}`
}

const isToolBeat = (beat: Beat): boolean =>
  beat.kind === 'uses-tool' || beat.kind === 'tool-fails'

const isRunBeat = (beat: Beat): beat is Beat & { detail: { kind: 'thinks' | 'says'; deltas: number } } =>
  beat.kind === 'thinks' || beat.kind === 'says'

const matchesKey = (beat: Beat | undefined, key: string): boolean => {
  if (beat === undefined) return false
  if (beat.kind === key) return true
  if (isToolBeat(beat) && (beat.detail as { tool?: string }).tool === key) return true
  return false
}

const getBeat = (beats: Map<string, Beat>, id: string): Beat | undefined => beats.get(id)

const beatsInRange = (beats: Map<string, Beat>, order: string[], range: Range): Beat[] => {
  const fromIdx = order.indexOf(range.from)
  const toIdx = order.indexOf(range.to)
  if (fromIdx === -1 || toIdx === -1) return []
  const start = Math.min(fromIdx, toIdx)
  const end = Math.max(fromIdx, toIdx)
  return order.slice(start, end + 1).flatMap(id => {
    const beat = beats.get(id)
    return beat === undefined ? [] : [beat]
  })
}

type ToolDetail = { tool: string | 'unknown'; callID?: string; path?: string; exit?: number }
type RunDetail = { kind: 'thinks' | 'says'; deltas: number; text?: string; endedEventID?: string }

const toolDetail = (beat: Beat): ToolDetail | undefined =>
  isToolBeat(beat) ? (beat.detail as ToolDetail) : undefined

const runDetail = (beat: Beat): RunDetail | undefined =>
  isRunBeat(beat) ? (beat.detail as RunDetail) : undefined

const renderSlot = (
  slot: Slot,
  beats: Map<string, Beat>,
  order: string[],
  ctx: Ctx,
): string | undefined => {
  switch (slot.name) {
    case 'count': {
      const list = beatsInRange(beats, order, slot.range)
      const count = list.filter(b => matchesKey(b, slot.key)).length
      return `${count}`
    }
    case 'deltas': {
      const list = beatsInRange(beats, order, slot.range)
      const total = list.reduce((sum, b) => {
        const d = runDetail(b)
        return d !== undefined ? sum + d.deltas : sum
      }, 0)
      return `${total}`
    }
    case 'ordinal': {
      const target = getBeat(beats, slot.beat)
      if (target === undefined) return undefined
      const idx = order.filter(id => matchesKey(beats.get(id), slot.key)).indexOf(slot.beat)
      if (idx === -1) return undefined
      return ordinalWord(idx + 1)
    }
    case 'again':
    case 'before': {
      const beatA = getBeat(beats, slot.a)
      const beatB = getBeat(beats, slot.b)
      if (beatA === undefined || beatB === undefined) return undefined
      const aIdx = order.indexOf(slot.a)
      const bIdx = order.indexOf(slot.b)
      if (aIdx === -1 || bIdx === -1 || aIdx >= bIdx) return undefined
      if (slot.name === 'again') {
        if (beatA.kind !== beatB.kind) return undefined
        const ta = toolDetail(beatA)?.tool
        const tb = toolDetail(beatB)?.tool
        if (ta !== undefined && tb !== undefined && ta !== tb) return undefined
      }
      return slot.name === 'again' ? 'again' : 'before'
    }
    case 'first': {
      const target = getBeat(beats, slot.beat)
      if (target === undefined) return undefined
      const idx = order.filter(id => matchesKey(beats.get(id), slot.key)).indexOf(slot.beat)
      return idx === 0 ? 'first' : undefined
    }
    case 'last': {
      const target = getBeat(beats, slot.beat)
      if (target === undefined) return undefined
      const matches = order.filter(id => matchesKey(beats.get(id), slot.key))
      return matches[matches.length - 1] === slot.beat ? 'last' : undefined
    }
    case 'tool': {
      const beat = getBeat(beats, slot.beat)
      const d = beat && toolDetail(beat)
      return d?.tool
    }
    case 'agent': {
      const beat = getBeat(beats, slot.beat)
      if (beat === undefined) return undefined
      return ctx.cast(beat.sessionID)
    }
    case 'path': {
      const beat = getBeat(beats, slot.beat)
      if (beat === undefined || beat.kind !== 'uses-tool') return undefined
      return (beat.detail as ToolDetail).path
    }
    case 'outcome': {
      const beat = getBeat(beats, slot.beat)
      if (beat === undefined) return undefined
      switch (beat.kind) {
        case 'wrap': return 'succeeded'
        case 'cut': return (beat.detail as { reason: string }).reason || 'interrupted'
        case 'answered': return (beat.detail as { reply: string }).reply || undefined
        case 'tool-fails': {
          const d = toolDetail(beat)
          return d?.exit !== undefined ? `exit ${d.exit}` : 'failed'
        }
        case 'uses-tool': {
          const d = toolDetail(beat)
          return d?.exit !== undefined ? `exit ${d.exit}` : 'succeeded'
        }
        default: return undefined
      }
    }
    case 'dur': {
      const list = beatsInRange(beats, order, slot.range)
      if (list.length === 0) return undefined
      const first = list[0]!.at
      const last = list[list.length - 1]!.endAt
      return formatDuration(last - first)
    }
    case 'cost': {
      // Beats do not yet carry cost; the slot exists for the full vocabulary.
      return undefined
    }
    case 'quote': {
      const beat = getBeat(beats, slot.beat)
      const d = beat && runDetail(beat)
      if (d?.text === undefined || d.text === '') return undefined
      return d.text
    }
    case 'gap': {
      const beat = getBeat(beats, slot.beat)
      if (beat === undefined || beat.kind !== 'silence') return undefined
      return formatDuration((beat.detail as { ms: number }).ms)
    }
    case 'never': {
      if (ctx.closed !== true) return undefined
      const count = order.filter(id => matchesKey(beats.get(id), slot.key)).length
      return count === 0 ? 'never once' : undefined
    }
    case 'hedge': {
      return 'presumably'
    }
  }
}

export function renderLine(line: Line, beats: Map<string, Beat>, ctx: Ctx): Rendered | { rejected: string } {
  if (line.cites.length === 0) return reject('line cites no beats')

  const order = ctx.beats.map(b => b.id)
  const cited = new Set(line.cites)
  if ([...order, ...cited].some(id => !beats.has(id))) return reject('missing beat evidence')

  // Parse and validate every slot before any rendering.
  const slots: { raw: string; slot: Slot; start: number; end: number }[] = []
  let m: RegExpExecArray | null
  SLOT_RE.lastIndex = 0
  while ((m = SLOT_RE.exec(line.template)) !== null) {
    const inner = m[1]!
    const slot = parseSlot(inner)
    if (slot === undefined) return reject(`unrecognised slot "${m[0]}"`)
    slots.push({ raw: m[0], slot, start: m.index, end: m.index + m[0].length })
  }

  // Every slot must cite only beats the line cites. A range slot reads every
  // beat between its endpoints, so all of them must appear in line.cites.
  const rangeBeats = (range: Range): string[] => {
    const fromIdx = order.indexOf(range.from)
    const toIdx = order.indexOf(range.to)
    if (fromIdx === -1 || toIdx === -1) return [range.from, range.to]
    const start = Math.min(fromIdx, toIdx)
    const end = Math.max(fromIdx, toIdx)
    return order.slice(start, end + 1)
  }

  const slotBeats = (slot: Slot): string[] => {
    switch (slot.name) {
      case 'count':
      case 'deltas':
      case 'dur':
      case 'cost':
        return rangeBeats(slot.range)
      case 'ordinal':
      case 'tool':
      case 'agent':
      case 'path':
      case 'outcome':
      case 'quote':
      case 'gap':
        return [slot.beat]
      case 'again':
      case 'before':
        return [slot.a, slot.b]
      case 'first':
      case 'last':
        return [slot.beat]
      case 'never':
      case 'hedge':
        return []
    }
  }

  for (const { raw, slot } of slots) {
    for (const beatID of slotBeats(slot)) {
      if (!cited.has(beatID)) return reject(`slot "${raw}" cites beat ${beatID} not listed in line.cites`)
    }
  }

  // Lint only the free text between slots.
  let freeText = ''
  let pos = 0
  for (const { start, end } of slots) {
    freeText += line.template.slice(pos, start)
    pos = end
  }
  freeText += line.template.slice(pos)
  const lint = lintFreeText(freeText)
  if (lint !== undefined) return reject(lint)

  // Render slots and assemble the line.
  let text = ''
  pos = 0
  for (const { raw, slot, start, end } of slots) {
    text += line.template.slice(pos, start)
    const value = renderSlot(slot, beats, order, ctx)
    if (value === undefined) return reject(`slot "${raw}" cannot be proved from cited beats`)
    text += value
    pos = end
  }
  text += line.template.slice(pos)

  const delivery: Rendered['delivery'] = line.speaker === 'narrator'
    ? 'narration'
    : slots.length === 1 && slots[0]!.slot.name === 'quote' &&
        line.template.trim() === slots[0]!.raw
      ? 'real-speech'
      : 'dramatised'

  return { text, delivery }
}

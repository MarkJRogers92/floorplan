/** Safe DOM views; story facts still come from the existing evidence checker. */
import type { ScriptLine } from '../narrative/script'
import { recapLines, type Recap } from '../narrative/recap'
import { castMemoryCards } from './cast-memory'

export function scriptRow(line: ScriptLine, kind: 'episode' | 'scene' | 'line') {
  const row = document.createElement('div')
  row.className = kind
  row.dataset.beats = line.beatIDs.join(' ')
  row.tabIndex = 0
  if (kind === 'line') {
    row.dataset.delivery = line.delivery
    if (line.line.flashback) row.dataset.flashback = 'true'
  }
  const text = document.createElement('span')
  text.textContent = line.text
  const ids = document.createElement('span')
  ids.className = 'beats'
  ids.textContent = line.beatIDs.join(' ')
  row.append(text, ids)
  return row
}

export function memoryElement(cards: ReturnType<typeof castMemoryCards>, id: string, open: boolean) {
  const memory = document.createElement('details')
  memory.className = 'cast-memory'
  memory.dataset.memory = id
  memory.open = open
  const summary = document.createElement('summary')
  summary.textContent = 'Cast memory'
  memory.append(summary)
  for (const card of cards) {
    const entry = document.createElement('div')
    const name = document.createElement('strong')
    name.textContent = card.agent
    entry.append(name)
    if (card.persona) {
      const fiction = document.createElement('p')
      fiction.textContent = `Invented persona: ${card.persona.text}`
      const proof = document.createElement('small')
      proof.textContent = `Stored debut: ${card.persona.debut.episodeID} · ${card.persona.debut.beatID}`
      entry.append(fiction, proof)
    }
    if (card.episodes.length) {
      const appearances = document.createElement('p')
      appearances.textContent = `Previous appearances: ${card.episodes.join(', ')}`
      entry.append(appearances)
    }
    memory.append(entry)
  }
  return memory
}

export function recapElement(recap: Recap) {
  const lines = recapLines(recap)
  if (!lines.length) return undefined
  const section = document.createElement('section')
  section.className = 'recap'
  section.dataset.recap = 'partial'
  const heading = document.createElement('h3')
  heading.textContent = 'Previously on…'
  const note = document.createElement('p')
  note.className = 'recap-note'
  note.textContent = 'From earlier archived footage; may be incomplete.'
  section.append(heading, note)
  for (const line of lines) {
    const row = document.createElement('div')
    row.className = 'line recap-line'
    row.tabIndex = 0
    row.dataset.delivery = line.delivery
    row.dataset.historyRef = JSON.stringify(line.ref)
    const text = document.createElement('span')
    text.textContent = line.delivery === 'real-speech' ? `${line.speaker}: ${line.text}` : line.text
    const ids = document.createElement('span')
    ids.className = 'beats'
    ids.textContent = `${line.ref.episodeID} · ${line.ref.beatID}`
    row.append(text, ids)
    section.append(row)
  }
  return section
}

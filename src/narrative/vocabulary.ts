/**
 * Free-text lint data (design §5.1). Kept separate from `line.ts` so the file
 * stays under the project size limit; the logic that uses it lives there.
 */

export const NUMBER_WORDS = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
  'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million',
  'once', 'twice', 'double', 'triple', 'dozen', 'several', 'few', 'many',
])

export const ORDER_ABSENCE_WORDS = new Set([
  'again', 'first', 'last', 'finally', 'still', 'never', 'always', 'only',
])

/** Tool, agent and model names and their verb forms (design §5.1). */
export const KNOWN_NAMES = new Set([
  // tools
  'read', 'reads', 'reading', 'edited', 'edit', 'edits', 'editing',
  'write', 'writes', 'writing', 'wrote', 'written',
  'bash', 'bashes', 'bashed', 'bashing',
  'shell', 'shells', 'shelled', 'shelling',
  'subagent', 'subagents',
  'search', 'searches', 'searched', 'searching',
  // agents
  'plan', 'plans', 'planned', 'planning',
  'build', 'builds', 'built', 'building',
  'research', 'researches', 'researched', 'researching',
  'review', 'reviews', 'reviewed', 'reviewing',
  'code', 'codes', 'coded', 'coding',
  'test', 'tests', 'tested', 'testing',
  'fix', 'fixes', 'fixed', 'fixing',
  'refactor', 'refactors', 'refactored', 'refactoring',
  'architect', 'architects', 'architected', 'architecting',
  'explore', 'explores', 'explored', 'exploring',
  'document', 'documents', 'documented', 'documenting',
  'unidentified',
  // models
  'claude', 'gpt', 'o1', 'sonnet', 'haiku', 'opus', 'kimi', 'qwen', 'llama',
])

const digitRe = /\d/
const pathRe = /[a-zA-Z0-9_\-.]+\/[a-zA-Z0-9_\-./]+|[a-zA-Z]:\\[^\s]+|~\/[^\s]+|\/[^\s]+/

const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

export const numberToWords = (n: number): string => {
  if (n === 0) return 'none'
  if (n < 10) return ones[n]!
  if (n < 20) return teens[n - 10]!
  if (n < 100) {
    const t = Math.floor(n / 10)
    const o = n % 10
    return o === 0 ? tens[t]! : `${tens[t]!}-${ones[o]!}`
  }
  return String(n)
}

export const lintFreeText = (text: string): string | undefined => {
  if (digitRe.test(text)) return 'template contains a digit'
  const words = text.toLowerCase().match(/[a-z]+/g) ?? []
  for (const w of words) {
    if (NUMBER_WORDS.has(w)) return `template contains number word "${w}"`
    if (ORDER_ABSENCE_WORDS.has(w)) return `template contains order/absence word "${w}"`
    if (KNOWN_NAMES.has(w)) return `template contains known name or verb form "${w}"`
  }
  if (pathRe.test(text)) return 'template contains a path'
  return undefined
}

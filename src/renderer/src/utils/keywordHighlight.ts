export const KEYWORD_CLASSES = [
  'bg-sky-300/70 dark:bg-sky-500/40',
  'bg-lime-300/70 dark:bg-lime-500/40',
  'bg-fuchsia-300/70 dark:bg-fuchsia-500/40',
  'bg-orange-300/70 dark:bg-orange-500/40',
  'bg-teal-300/70 dark:bg-teal-500/40'
]

export interface KeywordChunk {
  text: string
  group: number | null
}

export function buildKeywordRegex(keywords: string[]): RegExp | null {
  const nonEmpty = keywords.filter((k) => k.length > 0)
  if (nonEmpty.length === 0) {
    return null
  }
  const parts = nonEmpty.map((k) => `(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`)
  return new RegExp(parts.join('|'), 'gi')
}

export function splitByKeywords(text: string, regex: RegExp | null): KeywordChunk[] {
  if (!regex || !text) {
    return [{ text, group: null }]
  }
  const re = regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`)
  const chunks: KeywordChunk[] = []
  let last = 0
  re.lastIndex = 0
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex += 1
      continue
    }
    if (m.index > last) {
      chunks.push({ text: text.slice(last, m.index), group: null })
    }
    const groupIdx = m.findIndex((value, i) => i > 0 && value !== undefined)
    const group = groupIdx > 0 ? groupIdx - 1 : 0
    chunks.push({ text: m[0], group })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    chunks.push({ text: text.slice(last), group: null })
  }
  return chunks.length > 0 ? chunks : [{ text, group: null }]
}

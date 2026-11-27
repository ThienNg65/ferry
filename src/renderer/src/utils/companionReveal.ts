export const REVEAL_TICK_MS = 60
export const REVEAL_MAX_TOTAL_MS = 1200

export interface RevealPlan {
  chunks: string[]
  tickMs: number
}

const MIN_WORDS_PER_CHUNK = 3

/** Splits a reply into timed chunks for a client-side typing reveal; null = show full text now. */
export function planReveal(text: string, reducedMotion: boolean): RevealPlan | null {
  if (reducedMotion) return null
  // Each token owns its surrounding whitespace, so chunks join back to the exact text.
  const tokens = text.match(/\s*\S+\s*/g)
  if (!tokens) return null
  const maxChunks = Math.floor(REVEAL_MAX_TOTAL_MS / REVEAL_TICK_MS)
  const perChunk = Math.max(MIN_WORDS_PER_CHUNK, Math.ceil(tokens.length / maxChunks))
  const chunks: string[] = []
  for (let i = 0; i < tokens.length; i += perChunk) {
    chunks.push(tokens.slice(i, i + perChunk).join(''))
  }
  return chunks.length < 2 ? null : { chunks, tickMs: REVEAL_TICK_MS }
}

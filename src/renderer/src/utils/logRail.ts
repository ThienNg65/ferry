import type { ParsedTailLine } from './tailLineCache'

export interface RailBucket {
  error: boolean
  warn: boolean
  match: boolean
  pinned: boolean
}

/**
 * Collapses the visible lines into `bucketCount` rail cells; a cell lights up when any line in it
 * is an error / warning / search match / pinned line.
 */
export function buildRailMarks(
  items: readonly ParsedTailLine[],
  matchedIndices: ReadonlySet<number>,
  pinned: ReadonlySet<number>,
  bucketCount: number
): RailBucket[] {
  const count = Number.isFinite(bucketCount) ? Math.max(1, Math.floor(bucketCount)) : 1
  const buckets: RailBucket[] = Array.from({ length: count }, () => ({
    error: false,
    warn: false,
    match: false,
    pinned: false
  }))
  const total = items.length
  if (total === 0) return buckets
  for (let i = 0; i < total; i++) {
    const b = buckets[Math.min(count - 1, Math.floor((i / total) * count))]
    const item = items[i]
    if (item.level === 'error') b.error = true
    else if (item.level === 'warn') b.warn = true
    if (matchedIndices.has(i)) b.match = true
    if (pinned.has(item.originalIndex)) b.pinned = true
  }
  return buckets
}

/** Maps a 0..1 rail position to a line index (clamped). */
export function railPositionToIndex(ratio: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  if (!Number.isFinite(ratio)) return 0
  return Math.min(total - 1, Math.max(0, Math.floor(ratio * total)))
}

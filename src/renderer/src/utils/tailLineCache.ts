import { parseLogLevel, type LogLevel } from './logParser'

export interface ParsedTailLine {
  originalIndex: number
  /** Stable across rolling-buffer evictions; safe as a virtualizer row key. */
  sequence: number
  text: string
  level: LogLevel
}

export interface TailLineCache {
  lines: readonly string[]
  dropped: number
  items: ParsedTailLine[]
}

/**
 * Parse only newly appended lines. Existing classifications survive buffer updates,
 * while evicted lines are reindexed without changing their stable sequence keys.
 * A clear/reset (or unexpected replacement) falls back to a full rebuild.
 */
export function reconcileTailLines(
  lines: readonly string[],
  dropped: number,
  previous: TailLineCache | null
): TailLineCache {
  if (previous && dropped >= previous.dropped) {
    const evicted = dropped - previous.dropped
    const retainedCount = previous.items.length - evicted
    const appendCount = lines.length - retainedCount
    const samePrefix =
      retainedCount === 0 ||
      (previous.lines[evicted] === lines[0] &&
        previous.lines[previous.lines.length - 1] === lines[retainedCount - 1])

    if (retainedCount >= 0 && appendCount >= 0 && samePrefix) {
      const retained =
        evicted === 0
          ? previous.items
          : previous.items.slice(evicted).map((item, index) => ({ ...item, originalIndex: index }))
      const appended = lines.slice(retainedCount).map((text, index) => ({
        originalIndex: retainedCount + index,
        sequence: dropped + retainedCount + index,
        text,
        level: parseLogLevel(text)
      }))
      return { lines, dropped, items: retained.concat(appended) }
    }
  }

  return {
    lines,
    dropped,
    items: lines.map((text, index) => ({
      originalIndex: index,
      sequence: dropped + index,
      text,
      level: parseLogLevel(text)
    }))
  }
}

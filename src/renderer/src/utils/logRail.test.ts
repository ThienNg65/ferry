import { describe, expect, it } from 'vitest'
import { buildRailMarks, railPositionToIndex } from './logRail'
import type { ParsedTailLine } from './tailLineCache'

const line = (i: number, level: ParsedTailLine['level']): ParsedTailLine => ({
  originalIndex: i,
  sequence: i,
  text: `l${i}`,
  level
})

describe('buildRailMarks', () => {
  it('lights the bucket containing errors, warnings, matches and pins', () => {
    const items = [line(0, 'info'), line(1, 'error'), line(2, 'warn'), line(3, 'info')]
    const marks = buildRailMarks(items, new Set([3]), new Set([0]), 4)
    expect(marks.map((m) => m.error)).toEqual([false, true, false, false])
    expect(marks.map((m) => m.warn)).toEqual([false, false, true, false])
    expect(marks.map((m) => m.match)).toEqual([false, false, false, true])
    expect(marks.map((m) => m.pinned)).toEqual([true, false, false, false])
  })

  it('merges many lines into fewer buckets and handles empty input', () => {
    const items = Array.from({ length: 10 }, (_, i) => line(i, i === 9 ? 'error' : 'info'))
    const marks = buildRailMarks(items, new Set(), new Set(), 2)
    expect(marks.map((m) => m.error)).toEqual([false, true])
    expect(buildRailMarks([], new Set(), new Set(), 3)).toHaveLength(3)
  })
})

describe('railPositionToIndex', () => {
  it('clamps to the valid range', () => {
    expect(railPositionToIndex(0.5, 10)).toBe(5)
    expect(railPositionToIndex(1.2, 10)).toBe(9)
    expect(railPositionToIndex(-1, 10)).toBe(0)
    expect(railPositionToIndex(0.5, 0)).toBe(0)
  })
})

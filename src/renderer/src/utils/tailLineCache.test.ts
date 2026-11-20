import { describe, expect, it } from 'vitest'
import { reconcileTailLines } from './tailLineCache'

describe('reconcileTailLines', () => {
  it('classifies appended lines without reparsing existing entries', () => {
    const first = reconcileTailLines(['INFO ready', 'WARN slow'], 0, null)
    const second = reconcileTailLines(['INFO ready', 'WARN slow', 'ERROR failed'], 0, first)
    expect(second.items.map((line) => line.level)).toEqual(['info', 'warn', 'error'])
    expect(second.items[0]).toBe(first.items[0])
    expect(second.items[1]).toBe(first.items[1])
  })

  it('preserves stable virtual keys when the rolling window evicts lines', () => {
    const first = reconcileTailLines(['INFO one', 'WARN two', 'ERROR three'], 0, null)
    const second = reconcileTailLines(['WARN two', 'ERROR three', 'DEBUG four'], 1, first)
    expect(second.items.map((line) => [line.originalIndex, line.sequence])).toEqual([
      [0, 1], [1, 2], [2, 3]
    ])
    expect(second.items.map((line) => line.text)).toEqual(['WARN two', 'ERROR three', 'DEBUG four'])
  })

  it('rebuilds correctly after clearing the stream or replacing the buffer', () => {
    const first = reconcileTailLines(['ERROR stale', 'INFO old'], 8, null)
    const cleared = reconcileTailLines([], 0, first)
    const restarted = reconcileTailLines(['INFO fresh'], 0, cleared)
    expect(restarted.items).toEqual([
      { originalIndex: 0, sequence: 0, text: 'INFO fresh', level: 'info' }
    ])
    const replaced = reconcileTailLines(['WARN replaced'], 0, restarted)
    expect(replaced.items[0].level).toBe('warn')
  })

  it('handles batches larger than the retained window', () => {
    const before = reconcileTailLines(['INFO old'], 0, null)
    const after = reconcileTailLines(['ERROR latest'], 10, before)
    expect(after.items[0]).toMatchObject({ sequence: 10, originalIndex: 0, level: 'error' })
  })
})

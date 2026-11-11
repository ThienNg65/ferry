import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutputBatcher } from './OutputBatcher'

describe('OutputBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('merges chunks pushed within the delay into one emit', () => {
    const emit = vi.fn()
    const batcher = new OutputBatcher(emit, 8)
    batcher.push(Buffer.from('ab'))
    batcher.push(Buffer.from('cd'))
    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(Buffer.from(emit.mock.calls[0][0]).toString()).toBe('abcd')
  })

  it('flushes immediately once maxBytes is reached', () => {
    const emit = vi.fn()
    const batcher = new OutputBatcher(emit, 8, 4)
    batcher.push(Buffer.from('abcd'))
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('flush() drains pending data and cancels the timer', () => {
    const emit = vi.fn()
    const batcher = new OutputBatcher(emit, 8)
    batcher.push(Buffer.from('x'))
    batcher.flush()
    vi.advanceTimersByTime(20)
    expect(emit).toHaveBeenCalledTimes(1)
  })
})

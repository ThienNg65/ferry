import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutputBatcher } from './OutputBatcher'

describe('OutputBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('emits immediately when idle and merges subsequent chunks within the cooldown window', () => {
    const emit = vi.fn()
    const batcher = new OutputBatcher(emit, 8)
    batcher.push(Buffer.from('a'))
    expect(emit).toHaveBeenCalledTimes(1)
    expect(Buffer.from(emit.mock.calls[0][0]).toString()).toBe('a')

    batcher.push(Buffer.from('bc'))
    batcher.push(Buffer.from('de'))
    expect(emit).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(8)
    expect(emit).toHaveBeenCalledTimes(2)
    expect(Buffer.from(emit.mock.calls[1][0]).toString()).toBe('bcde')

    // After another idle window, the next chunk emits immediately again.
    vi.advanceTimersByTime(8)
    batcher.push(Buffer.from('f'))
    expect(emit).toHaveBeenCalledTimes(3)
    expect(Buffer.from(emit.mock.calls[2][0]).toString()).toBe('f')
  })

  it('flushes buffered chunks immediately once maxBytes is reached', () => {
    const emit = vi.fn()
    const batcher = new OutputBatcher(emit, 8, 4)
    batcher.push(Buffer.from('init'))
    batcher.push(Buffer.from('abcd'))
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('flush() drains pending data and cancels the timer', () => {
    const emit = vi.fn()
    const batcher = new OutputBatcher(emit, 8)
    batcher.push(Buffer.from('a'))
    batcher.push(Buffer.from('x'))
    batcher.flush()
    vi.advanceTimersByTime(20)
    expect(emit).toHaveBeenCalledTimes(2)
    expect(Buffer.from(emit.mock.calls[1][0]).toString()).toBe('x')
  })
})

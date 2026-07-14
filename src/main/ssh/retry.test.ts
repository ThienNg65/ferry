import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withRetry } from './retry'
import { SshError } from './errors'

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rethrows a non-transient error immediately without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('validation failed'))
    await expect(withRetry(fn, { attempts: 3 })).rejects.toThrow('validation failed')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries a transient error and resolves once it stops failing', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockResolvedValueOnce('ok')
    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 100 })
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(200)
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('exhausts all attempts on a persistently transient error and throws the last one', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'))
    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 50 })
    const assertion = expect(promise).rejects.toThrow('ETIMEDOUT')
    await vi.advanceTimersByTimeAsync(50)
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('doubles the backoff delay each attempt (300, 600, 1200...)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const promise = withRetry(fn, { attempts: 4, baseDelayMs: 300 }).catch(() => undefined)

    expect(fn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(299)
    expect(fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(599)
    expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(1199)
    expect(fn).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(4)

    await promise
  })

  it('throws CANCELLED immediately if the signal is already aborted before the first attempt', async () => {
    const controller = new AbortController()
    controller.abort()
    const fn = vi.fn()
    await expect(withRetry(fn, { attempts: 3, signal: controller.signal })).rejects.toThrow(SshError)
    expect(fn).not.toHaveBeenCalled()
  })

  it('aborts mid-delay and rejects with CANCELLED instead of retrying', async () => {
    const controller = new AbortController()
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 1000, signal: controller.signal })
    const assertion = expect(promise).rejects.toMatchObject({ code: 'CANCELLED' })

    await vi.advanceTimersByTimeAsync(500)
    controller.abort()
    await assertion
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimiter } from './TransferQueue'

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately when unlimited (the default)', async () => {
    const limiter = new RateLimiter()
    const spy = vi.fn()
    await limiter.acquire(10_000_000).then(spy)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('resolves immediately when explicitly cleared back to unlimited', async () => {
    const limiter = new RateLimiter()
    limiter.setLimitKBps(10)
    limiter.setLimitKBps(null)
    const spy = vi.fn()
    await limiter.acquire(10_000_000).then(spy)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('never delays the very first request after a limit is set, even one bigger than one second of budget', async () => {
    const limiter = new RateLimiter()
    limiter.setLimitKBps(1) // 1 KB/s = 1024 bytes/s — this request is worth 2 virtual seconds
    const spy = vi.fn()
    await limiter.acquire(2048).then(spy)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('delays a second request until the first has finished its reserved virtual duration', async () => {
    const limiter = new RateLimiter()
    limiter.setLimitKBps(1) // 1024 bytes/s
    await limiter.acquire(1024) // reserves the next 1000ms of virtual time, but returns immediately itself

    const spy = vi.fn()
    const promise = limiter.acquire(512).then(spy) // needs the first's reserved second, plus its own 500ms share

    await vi.advanceTimersByTimeAsync(900)
    expect(spy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    expect(spy).toHaveBeenCalledTimes(1)
    await promise
  })

  it('does not compound delay once the schedule has caught up to real time', async () => {
    const limiter = new RateLimiter()
    limiter.setLimitKBps(1024) // 1 MB/s — effectively unthrottled for a tiny request
    await limiter.acquire(1)
    await vi.advanceTimersByTimeAsync(50)
    const spy = vi.fn()
    await limiter.acquire(1).then(spy)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

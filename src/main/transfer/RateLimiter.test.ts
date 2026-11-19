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

  it('exposes isLimited and rejects immediately when AbortSignal aborts while waiting', async () => {
    const limiter = new RateLimiter()
    expect(limiter.isLimited).toBe(false)
    limiter.setLimitKBps(1)
    expect(limiter.isLimited).toBe(true)

    await limiter.acquire(1024)
    const controller = new AbortController()
    const waiting = limiter.acquire(1024, controller.signal)
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ code: 'CANCELLED' })
  })
  it('reclaims cancelled queued reservations without delaying unrelated transfers', async () => {
    const limiter = new RateLimiter()
    limiter.setLimitKBps(1)
    await limiter.acquire(1024)
    const controller = new AbortController()
    const cancelled = limiter.acquire(1024, controller.signal)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' })
    const next = vi.fn()
    const request = limiter.acquire(1024).then(next)
    await vi.advanceTimersByTimeAsync(999)
    expect(next).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await request
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('does not accumulate delays from repeated cancellations', async () => {
    const limiter = new RateLimiter()
    limiter.setLimitKBps(1)
    await limiter.acquire(1024)
    for (let i = 0; i < 5; i++) {
      const controller = new AbortController()
      const pending = limiter.acquire(1024, controller.signal)
      controller.abort()
      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    }
    const done = vi.fn()
    const request = limiter.acquire(1024).then(done)
    await vi.advanceTimersByTimeAsync(1000)
    await request
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('preserves FIFO ordering for surviving requests', async () => {
    const limiter = new RateLimiter()
    limiter.setLimitKBps(1)
    await limiter.acquire(1024)
    const cancelledController = new AbortController()
    const cancelled = limiter.acquire(1024, cancelledController.signal)
    const order: number[] = []
    const second = limiter.acquire(1024).then(() => order.push(2))
    const third = limiter.acquire(1024).then(() => order.push(3))
    cancelledController.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(order).toEqual([2])
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all([second, third])
    expect(order).toEqual([2, 3])
  })

  it('releases pending work when the cap is removed', async () => {
    const limiter = new RateLimiter()
    limiter.setLimitKBps(1)
    await limiter.acquire(1024)
    const pending = limiter.acquire(1024)
    limiter.setLimitKBps(null)
    await expect(pending).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recalculates pending work when the bandwidth cap changes', async () => {
    const limiter = new RateLimiter()
    limiter.setLimitKBps(1)
    await limiter.acquire(1024)
    const pending = limiter.acquire(1024)
    limiter.setLimitKBps(2)
    await expect(pending).resolves.toBeUndefined()
    const next = vi.fn()
    const request = limiter.acquire(1024).then(next)
    await vi.advanceTimersByTimeAsync(499)
    expect(next).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await request
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('does not retain abort listeners or timers after queued cancellation', async () => {
    const limiter = new RateLimiter()
    limiter.setLimitKBps(1)
    await limiter.acquire(1024)
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = limiter.acquire(1024, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

})

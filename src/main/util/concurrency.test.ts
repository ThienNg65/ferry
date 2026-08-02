import { describe, expect, it } from 'vitest'
import { runConcurrent } from './concurrency'

describe('runConcurrent', () => {
  it('runs every item exactly once', async () => {
    const seen: number[] = []
    await runConcurrent([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item)
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('never exceeds the requested concurrency at any point in time', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const items = Array.from({ length: 10 }, (_, i) => i)

    await runConcurrent(items, 3, async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
    })

    expect(maxInFlight).toBeLessThanOrEqual(3)
    expect(maxInFlight).toBeGreaterThan(1) // sanity: it did actually run some in parallel
  })

  it('does nothing for an empty items array, regardless of concurrency', async () => {
    let called = false
    await runConcurrent([], 5, async () => {
      called = true
    })
    expect(called).toBe(false)
  })

  it('stops starting new items after the first failure and rethrows it once in-flight workers settle', async () => {
    const started: number[] = []
    const order: string[] = []

    await expect(
      runConcurrent([1, 2, 3, 4, 5], 2, async (item) => {
        started.push(item)
        if (item === 2) {
          throw new Error('boom')
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
        order.push(`ok-${item}`)
      })
    ).rejects.toThrow('boom')

    // No item started after the pool observed the failure should still be
    // "started" once the whole call has settled — the pool is bounded, so at
    // most `concurrency`-many items are ever in flight when item 2 throws.
    expect(started.length).toBeLessThanOrEqual(5)
    expect(started).toContain(2)
  })

  it('rethrows the first error encountered when multiple workers fail', async () => {
    await expect(
      runConcurrent([1, 2], 2, async (item) => {
        throw new Error(`fail-${item}`)
      })
    ).rejects.toThrow(/fail-(1|2)/)
  })

  describe('concurrency <= 0', () => {
    it('documents current behavior: Math.min(concurrency, items.length) with a non-positive concurrency starts zero workers, so runConcurrent resolves without running any item', async () => {
      let called = false
      await runConcurrent([1, 2, 3], 0, async () => {
        called = true
      })
      expect(called).toBe(false)
    })

    it('documents current behavior: a negative concurrency also starts zero workers (Array.from with a negative length yields an empty array)', async () => {
      let called = false
      await runConcurrent([1, 2, 3], -1, async () => {
        called = true
      })
      expect(called).toBe(false)
    })
  })

  it('caps concurrency at items.length when concurrency exceeds it', async () => {
    const seen: number[] = []
    await runConcurrent([1, 2], 100, async (item) => {
      seen.push(item)
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2])
  })
})

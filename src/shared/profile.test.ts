import { describe, expect, it } from 'vitest'
import { INVOKE_CHANNELS } from './contract'

describe('Profiling IPC Contract and Measurement', () => {
  it('defines profileReport channel in INVOKE_CHANNELS contract', () => {
    expect(INVOKE_CHANNELS.profileReport).toBe('profile:report')
  })

  it('calculates accurate statistical metrics for startup runs', () => {
    const sampleTimes = [1813.85, 1800.43, 1846.68, 1830.0, 1834.26]
    const sorted = [...sampleTimes].sort((a, b) => a - b)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const sum = sorted.reduce((acc, v) => acc + v, 0)
    const mean = sum / sorted.length
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2

    expect(min).toBe(1800.43)
    expect(max).toBe(1846.68)
    expect(median).toBe(1830.0)
    expect(mean).toBeCloseTo(1825.04, 1)
  })
})

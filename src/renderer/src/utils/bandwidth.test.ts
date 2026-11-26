import { describe, expect, it } from 'vitest'
import {
  BANDWIDTH_PRESETS,
  convertBandwidthValue,
  formatBandwidthCap,
  splitBandwidthLimit,
  toBandwidthKBps
} from './bandwidth'

describe('bandwidth utils', () => {
  it('formats Unlimited, KB/s, and MB/s caps cleanly', () => {
    expect(formatBandwidthCap(null)).toBe('Unlimited')
    expect(formatBandwidthCap(undefined)).toBe('Unlimited')
    expect(formatBandwidthCap(0)).toBe('Unlimited')
    expect(formatBandwidthCap(-10)).toBe('Unlimited')
    expect(formatBandwidthCap(512)).toBe('512 KB/s')
    expect(formatBandwidthCap(1024)).toBe('1 MB/s')
    expect(formatBandwidthCap(2560)).toBe('2.5 MB/s')
    expect(formatBandwidthCap(10240)).toBe('10 MB/s')
  })

  it('splits stored KB/s values into display values and units while preserving non-exact caps', () => {
    expect(splitBandwidthLimit(null)).toEqual({ value: 1, unit: 'MB/s' })
    expect(splitBandwidthLimit(512)).toEqual({ value: 512, unit: 'KB/s' })
    expect(splitBandwidthLimit(1024)).toEqual({ value: 1, unit: 'MB/s' })
    expect(splitBandwidthLimit(1025)).toEqual({ value: 1025, unit: 'KB/s' })
    expect(splitBandwidthLimit(5120)).toEqual({ value: 5, unit: 'MB/s' })
    expect(splitBandwidthLimit(1536)).toEqual({ value: 1.5, unit: 'MB/s' })
  })

  it('converts values smoothly between KB/s and MB/s', () => {
    expect(convertBandwidthValue(1024, 'KB/s', 'MB/s')).toBe(1)
    expect(convertBandwidthValue(2560, 'KB/s', 'MB/s')).toBe(2.5)
    expect(convertBandwidthValue(5, 'MB/s', 'KB/s')).toBe(5120)
    expect(convertBandwidthValue(512, 'KB/s', 'KB/s')).toBe(512)
    expect(convertBandwidthValue(0, 'KB/s', 'MB/s')).toBe(0)
  })

  it('normalizes UI values to IPC KB/s contract and maps 0 to Unlimited (null)', () => {
    expect(toBandwidthKBps(0, 'KB/s')).toBeNull()
    expect(toBandwidthKBps(0, 'MB/s')).toBeNull()
    expect(toBandwidthKBps(512, 'KB/s')).toBe(512)
    expect(toBandwidthKBps(2.5, 'MB/s')).toBe(2560)
    expect(toBandwidthKBps(10, 'MB/s')).toBe(10240)
    expect(toBandwidthKBps(-1, 'KB/s')).toBeUndefined()
    expect(toBandwidthKBps(Number.NaN, 'MB/s')).toBeUndefined()
    expect(toBandwidthKBps(Number.POSITIVE_INFINITY, 'MB/s')).toBeUndefined()
    expect(toBandwidthKBps(0.0001, 'MB/s')).toBeUndefined()
  })

  it('includes Unlimited as the first preset followed by ascending limits', () => {
    expect(BANDWIDTH_PRESETS[0]).toEqual({ label: 'Unlimited', limitKBps: null })
    const numeric = BANDWIDTH_PRESETS.slice(1).map((p) => p.limitKBps!)
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b))
  })
})

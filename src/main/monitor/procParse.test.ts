import { describe, expect, it } from 'vitest'
import {
  cpuPercentages,
  parseLoadAvg,
  parseMeminfo,
  parseProcStat,
  parseUptime,
  splitSections,
  type CpuTimes
} from './procParse'

// Realistic 4-core /proc/stat excerpt (columns: user nice system idle iowait irq softirq steal guest guest_nice).
const PROC_STAT = `cpu  100 0 100 700 100 0 0 0 0 0
cpu0 25 0 25 175 25 0 0 0 0 0
cpu1 25 0 25 175 25 0 0 0 0 0
cpu2 25 0 25 175 25 0 0 0 0 0
cpu3 25 0 25 175 25 0 0 0 0 0
intr 12345 0 0
ctxt 987654
btime 1700000000
processes 4242`

const MEMINFO_MODERN = `MemTotal:        8000000 kB
MemFree:         2000000 kB
MemAvailable:    5000000 kB
Buffers:          300000 kB
Cached:          2500000 kB
SwapTotal:       1000000 kB
SwapFree:         750000 kB`

const MEMINFO_PRE_314 = `MemTotal:        8000000 kB
MemFree:         2000000 kB
Buffers:          300000 kB
Cached:          2500000 kB
SwapTotal:             0 kB
SwapFree:              0 kB`

describe('splitSections', () => {
  it('splits four @@@-separated sections', () => {
    const out = splitSections('statpart\n@@@\nmempart\n@@@\nloadpart\n@@@\nuppart')
    expect(out).toEqual(['statpart', 'mempart', 'loadpart', 'uppart'])
  })

  it('pads missing trailing sections with empty strings (BSD: no /proc at all)', () => {
    expect(splitSections('\n@@@\n\n@@@\n\n@@@\n')).toEqual(['', '', '', ''])
    expect(splitSections('')).toEqual(['', '', '', ''])
  })
})

describe('parseProcStat', () => {
  it('parses aggregate + per-core rows, ignoring non-cpu lines', () => {
    const rows = parseProcStat(PROC_STAT)
    expect(rows).toHaveLength(5)
    expect(rows[0].label).toBe('cpu')
    expect(rows.slice(1).map((r) => r.label)).toEqual(['cpu0', 'cpu1', 'cpu2', 'cpu3'])
    // aggregate: total = 1000, idle = 700 + 100 iowait = 800
    expect(rows[0].total).toBe(1000)
    expect(rows[0].idle).toBe(800)
  })

  it('handles a busybox-style minimal stat (fewer columns)', () => {
    const rows = parseProcStat('cpu  10 0 10 80\ncpu0 10 0 10 80')
    expect(rows).toHaveLength(2)
    expect(rows[0].total).toBe(100)
    expect(rows[0].idle).toBe(80)
  })

  it('returns [] on garbage / empty input (the unsupported signal)', () => {
    expect(parseProcStat('')).toEqual([])
    expect(parseProcStat('not a stat file\nat all')).toEqual([])
  })
})

describe('cpuPercentages', () => {
  const at = (label: string, idle: number, total: number): CpuTimes => ({ label, idle, total })

  it('computes busy percentage from the delta, counting iowait as idle', () => {
    const prev = [at('cpu', 800, 1000), at('cpu0', 800, 1000)]
    const curr = [at('cpu', 850, 1100), at('cpu0', 850, 1100)]
    // total delta 100, idle delta 50 → 50% busy
    const result = cpuPercentages(prev, curr)
    expect(result).not.toBeNull()
    expect(result?.aggregatePct).toBe(50)
    expect(result?.perCorePct).toEqual([50])
  })

  it('reports 100% for a fully-busy delta and 0% for a fully-idle one', () => {
    expect(
      cpuPercentages([at('cpu', 100, 1000)], [at('cpu', 100, 1100)])?.aggregatePct
    ).toBe(100)
    expect(
      cpuPercentages([at('cpu', 100, 1000)], [at('cpu', 200, 1100)])?.aggregatePct
    ).toBe(0)
  })

  it('returns null on zero total delta', () => {
    expect(cpuPercentages([at('cpu', 100, 1000)], [at('cpu', 100, 1000)])).toBeNull()
  })

  it('returns null on core-count mismatch (CPU hotplug)', () => {
    const prev = [at('cpu', 0, 100), at('cpu0', 0, 100)]
    const curr = [at('cpu', 0, 200), at('cpu0', 0, 200), at('cpu1', 0, 200)]
    expect(cpuPercentages(prev, curr)).toBeNull()
  })

  it('returns null when there is no previous reading', () => {
    expect(cpuPercentages([], [at('cpu', 0, 100)])).toBeNull()
  })
})

describe('parseMeminfo', () => {
  it('parses a modern meminfo with MemAvailable, converting kB to bytes', () => {
    const mem = parseMeminfo(MEMINFO_MODERN)
    expect(mem).not.toBeNull()
    expect(mem?.totalBytes).toBe(8000000 * 1024)
    expect(mem?.availableBytes).toBe(5000000 * 1024)
    expect(mem?.usedBytes).toBe(3000000 * 1024) // total − available
    expect(mem?.buffersBytes).toBe(300000 * 1024)
    expect(mem?.cachedBytes).toBe(2500000 * 1024)
    expect(mem?.swap.totalBytes).toBe(1000000 * 1024)
    expect(mem?.swap.usedBytes).toBe(250000 * 1024)
  })

  it('falls back to MemFree + Buffers + Cached when MemAvailable is missing', () => {
    const mem = parseMeminfo(MEMINFO_PRE_314)
    expect(mem?.availableBytes).toBe((2000000 + 300000 + 2500000) * 1024)
    expect(mem?.usedBytes).toBe((8000000 - 4800000) * 1024)
  })

  it('handles a swap-less host', () => {
    expect(parseMeminfo(MEMINFO_PRE_314)?.swap).toEqual({ totalBytes: 0, usedBytes: 0 })
  })

  it('returns null on garbage or missing totals', () => {
    expect(parseMeminfo('')).toBeNull()
    expect(parseMeminfo('nonsense')).toBeNull()
    expect(parseMeminfo('MemFree: 100 kB')).toBeNull()
  })
})

describe('parseLoadAvg', () => {
  it('parses the three load figures', () => {
    expect(parseLoadAvg('0.42 0.38 0.30 2/512 12345')).toEqual([0.42, 0.38, 0.3])
  })

  it('returns null on garbage', () => {
    expect(parseLoadAvg('')).toBeNull()
    expect(parseLoadAvg('a b c')).toBeNull()
  })
})

describe('parseUptime', () => {
  it('parses seconds since boot', () => {
    expect(parseUptime('123456.78 654321.00')).toBe(123456.78)
  })

  it('returns null on garbage', () => {
    expect(parseUptime('')).toBeNull()
    expect(parseUptime('up 3 days')).toBeNull()
  })
})

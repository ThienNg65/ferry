import { describe, expect, it } from 'vitest'
import {
  capProcesses,
  cpuPercentages,
  parseDiskUsage,
  parseLoadAvg,
  parseMeminfo,
  parseProcessSnapshot,
  parseProcStat,
  parseUptime,
  processCpuPercentages,
  splitSections,
  type CpuTimes,
  type ProcessSnapshot
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
    const out = splitSections('statpart\n@@@\nmempart\n@@@\nloadpart\n@@@\nuppart', 4)
    expect(out).toEqual(['statpart', 'mempart', 'loadpart', 'uppart'])
  })

  it('pads missing trailing sections with empty strings (BSD: no /proc at all)', () => {
    expect(splitSections('\n@@@\n\n@@@\n\n@@@\n', 4)).toEqual(['', '', '', ''])
    expect(splitSections('', 4)).toEqual(['', '', '', ''])
  })

  it('splits six sections (adds disk usage + process dump)', () => {
    const out = splitSections('a\n@@@\nb\n@@@\nc\n@@@\nd\n@@@\ne\n@@@\nf', 6)
    expect(out).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
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

describe('parseDiskUsage', () => {
  it('parses a normal single-line df -Pk / output', () => {
    const df = `Filesystem     1024-blocks     Used Available Capacity Mounted on
/dev/sda1        104857600 20971520  78643200      22% /`
    const disk = parseDiskUsage(df)
    expect(disk).toEqual({
      totalBytes: 104857600 * 1024,
      usedBytes: 20971520 * 1024,
      availableBytes: 78643200 * 1024
    })
  })

  it('tolerates a wrapped long device name (numeric columns on their own line)', () => {
    const df = `Filesystem                                                                1024-blocks     Used Available Capacity Mounted on
/dev/mapper/very--long--volume--group-name-that-wraps-onto-the-next-line
                                                                              104857600 20971520  78643200      22% /`
    const disk = parseDiskUsage(df)
    expect(disk).toEqual({
      totalBytes: 104857600 * 1024,
      usedBytes: 20971520 * 1024,
      availableBytes: 78643200 * 1024
    })
  })

  it('returns null on garbage / missing df', () => {
    expect(parseDiskUsage('')).toBeNull()
    expect(parseDiskUsage('nonsense')).toBeNull()
    expect(parseDiskUsage('just a header line, no data')).toBeNull()
  })
})

// 22 fields after "pid (comm) " — fields 3..24 (state..rss); utime=10, stime=5, rss=380 pages.
const STAT_TAIL = 'S 1 123 123 0 -1 4194560 100 0 5 0 10 5 0 0 20 0 1 0 12345 8482816 380'

describe('parseProcessSnapshot', () => {
  it('parses a standard record', () => {
    const text = `@P@123\n123 (bash) ${STAT_TAIL}`
    const snaps = parseProcessSnapshot(text)
    expect(snaps).toEqual([{ pid: 123, comm: 'bash', utime: 10, stime: 5, rssPages: 380 }])
  })

  it('parses a comm containing spaces and embedded parens via first "(" / last ")"', () => {
    const text = `@P@456\n456 (my (weird) proc) ${STAT_TAIL}`
    const snaps = parseProcessSnapshot(text)
    expect(snaps).toEqual([{ pid: 456, comm: 'my (weird) proc', utime: 10, stime: 5, rssPages: 380 }])
  })

  it('parses multiple @P@ records in order', () => {
    const text = `@P@1\n1 (init) ${STAT_TAIL}\n@P@2\n2 (sshd) ${STAT_TAIL}`
    const snaps = parseProcessSnapshot(text)
    expect(snaps.map((s) => s.pid)).toEqual([1, 2])
    expect(snaps.map((s) => s.comm)).toEqual(['init', 'sshd'])
  })

  it('skips a malformed/too-short record rather than throwing', () => {
    const text = '@P@789\n789 (short) S 1 2 3'
    expect(parseProcessSnapshot(text)).toEqual([])
  })

  it('returns [] on empty input', () => {
    expect(parseProcessSnapshot('')).toEqual([])
  })
})

describe('processCpuPercentages', () => {
  const snap = (pid: number, utime: number, stime: number, rssPages = 100): ProcessSnapshot => ({
    pid,
    comm: `proc${pid}`,
    utime,
    stime,
    rssPages
  })

  it('computes cpuPct from the busy-time delta over the aggregate total delta', () => {
    const prev = new Map([[1, snap(1, 10, 5)]])
    const curr = [snap(1, 20, 10)]
    // busyDelta = (20+10) - (10+5) = 15; aggregateTotalDelta = 100 -> 15%
    const result = processCpuPercentages(prev, curr, 100)
    expect(result).toEqual([{ pid: 1, name: 'proc1', rssBytes: 100 * 4096, cpuPct: 15 }])
  })

  it('reports cpuPct null for a pid absent from the previous sample (new process)', () => {
    const result = processCpuPercentages(new Map(), [snap(2, 20, 10)], 100)
    expect(result[0].cpuPct).toBeNull()
  })

  it('reports cpuPct null for every process on the first tick overall (no aggregate delta yet)', () => {
    const prev = new Map([[1, snap(1, 10, 5)]])
    const result = processCpuPercentages(prev, [snap(1, 20, 10)], null)
    expect(result[0].cpuPct).toBeNull()
  })
})

describe('capProcesses', () => {
  it('sorts by a combined CPU+RAM score and truncates, without favoring only one axis', () => {
    const memTotalBytes = 1000
    const cpuHeavy = { pid: 1, name: 'cpu-heavy', rssBytes: 0, cpuPct: 90 }
    const ramHeavy = { pid: 2, name: 'ram-heavy', rssBytes: 1000, cpuPct: 0 }
    const light = { pid: 3, name: 'light', rssBytes: 50, cpuPct: 5 }
    const { processes, totalCount } = capProcesses([cpuHeavy, ramHeavy, light], memTotalBytes, 2)
    expect(totalCount).toBe(3)
    expect(processes.map((p) => p.pid)).toEqual([2, 1])
  })

  it('reports the full totalCount even when not truncated', () => {
    const { totalCount } = capProcesses([{ pid: 1, name: 'a', rssBytes: 0, cpuPct: 1 }], 1000)
    expect(totalCount).toBe(1)
  })
})

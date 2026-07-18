/**
 * Pure parsers for the Monitor tick command's output — no Electron/Node
 * imports so everything here is unit-testable without a server (the
 * regQuery.ts/keyboardInteractive.ts precedent).
 *
 * The tick command concatenates /proc/stat, /proc/meminfo, /proc/loadavg and
 * /proc/uptime separated by a `@@@` marker line; each section parser is
 * tolerant of garbage and returns null/[] so MonitorManager can distinguish
 * "not Linux / no procfs" from a transient failure.
 */

import type { MonitorSample } from '../../shared/contract'

/** Marker line the tick command echoes between /proc sections. */
export const SECTION_MARKER = '@@@'

/** Cumulative CPU times for one /proc/stat `cpu*` row. */
export interface CpuTimes {
  /** 'cpu' for the aggregate row, 'cpu0'/'cpu1'/... per core. */
  label: string
  /** idle + iowait — time the core did no useful work. */
  idle: number
  /** Sum of every column — the full time base for percentage deltas. */
  total: number
}

/** Memory + swap figures parsed from /proc/meminfo. */
export type MemInfo = MonitorSample['memory'] & { swap: MonitorSample['swap'] }

/**
 * Splits the combined tick output into exactly 4 section strings
 * (stat, meminfo, loadavg, uptime) — missing trailing sections come back as
 * empty strings rather than being absent.
 */
export function splitSections(output: string, marker: string = SECTION_MARKER): string[] {
  const parts = output.split(new RegExp(`^${marker}\\s*$`, 'm')).map((s) => s.trim())
  while (parts.length < 4) {
    parts.push('')
  }
  return parts.slice(0, 4)
}

/**
 * Parses /proc/stat's `cpu*` rows into cumulative times. Index 0 is the
 * aggregate `cpu` row, the rest are per-core in order. Returns [] when no cpu
 * row is present (no procfs — the "unsupported" signal).
 */
export function parseProcStat(text: string): CpuTimes[] {
  const rows: CpuTimes[] = []
  for (const line of text.split('\n')) {
    const match = /^(cpu\d*)\s+(.*)$/.exec(line.trim())
    if (!match) {
      continue
    }
    const fields = match[2].split(/\s+/).map(Number)
    if (fields.length < 4 || fields.some((n) => !Number.isFinite(n))) {
      continue
    }
    // Columns: user nice system idle [iowait irq softirq steal guest guest_nice]
    const idle = fields[3] + (fields[4] ?? 0)
    const total = fields.reduce((sum, n) => sum + n, 0)
    rows.push({ label: match[1], idle, total })
  }
  // The aggregate 'cpu' row always sorts before 'cpu0' in real /proc/stat, but
  // don't rely on it — put it first explicitly.
  rows.sort((a, b) => {
    if (a.label === 'cpu') {
      return -1
    }
    if (b.label === 'cpu') {
      return 1
    }
    return Number(a.label.slice(3)) - Number(b.label.slice(3))
  })
  return rows
}

/**
 * Computes busy percentages from two consecutive /proc/stat readings.
 * Returns null when the readings aren't comparable (core count changed —
 * CPU hotplug — or a zero total delta).
 */
export function cpuPercentages(
  prev: CpuTimes[],
  curr: CpuTimes[]
): { aggregatePct: number; perCorePct: number[] } | null {
  if (prev.length === 0 || prev.length !== curr.length) {
    return null
  }
  const pct = (p: CpuTimes, c: CpuTimes): number | null => {
    const totalDelta = c.total - p.total
    if (totalDelta <= 0) {
      return null
    }
    const idleDelta = c.idle - p.idle
    const busy = ((totalDelta - idleDelta) / totalDelta) * 100
    return Math.min(100, Math.max(0, busy))
  }
  const aggregatePct = pct(prev[0], curr[0])
  if (aggregatePct === null) {
    return null
  }
  const perCorePct: number[] = []
  for (let i = 1; i < curr.length; i++) {
    const core = pct(prev[i], curr[i])
    perCorePct.push(core === null ? 0 : Math.round(core * 10) / 10)
  }
  return { aggregatePct: Math.round(aggregatePct * 10) / 10, perCorePct }
}

const KB = 1024

function meminfoValueKb(lines: Map<string, number>, key: string): number | null {
  const value = lines.get(key)
  if (value === undefined) {
    return null
  }
  return value
}

/**
 * Parses /proc/meminfo (kB values → bytes). Falls back to
 * MemFree + Buffers + Cached when MemAvailable is missing (pre-3.14 kernels).
 * Returns null when the section is unparseable.
 */
export function parseMeminfo(text: string): MemInfo | null {
  const lines = new Map<string, number>()
  for (const line of text.split('\n')) {
    const match = /^(\w+):\s+(\d+)\s*kB?\s*$/.exec(line.trim())
    if (match) {
      lines.set(match[1], Number(match[2]))
    }
  }
  const totalKb = meminfoValueKb(lines, 'MemTotal')
  const freeKb = meminfoValueKb(lines, 'MemFree')
  if (totalKb === null || freeKb === null || totalKb <= 0) {
    return null
  }
  const buffersKb = meminfoValueKb(lines, 'Buffers') ?? 0
  const cachedKb = meminfoValueKb(lines, 'Cached') ?? 0
  const availableKb = meminfoValueKb(lines, 'MemAvailable') ?? freeKb + buffersKb + cachedKb
  const swapTotalKb = meminfoValueKb(lines, 'SwapTotal') ?? 0
  const swapFreeKb = meminfoValueKb(lines, 'SwapFree') ?? 0
  return {
    totalBytes: totalKb * KB,
    usedBytes: Math.max(0, (totalKb - availableKb) * KB),
    availableBytes: availableKb * KB,
    buffersBytes: buffersKb * KB,
    cachedBytes: cachedKb * KB,
    swap: {
      totalBytes: swapTotalKb * KB,
      usedBytes: Math.max(0, (swapTotalKb - swapFreeKb) * KB)
    }
  }
}

/** Parses /proc/loadavg's first three fields. Returns null on garbage. */
export function parseLoadAvg(text: string): [number, number, number] | null {
  const fields = text.trim().split(/\s+/).slice(0, 3).map(Number)
  if (fields.length < 3 || fields.some((n) => !Number.isFinite(n))) {
    return null
  }
  return [fields[0], fields[1], fields[2]]
}

/** Parses /proc/uptime's first field (seconds since boot). Returns null on garbage. */
export function parseUptime(text: string): number | null {
  const first = text.trim().split(/\s+/)[0]
  if (!first) {
    return null
  }
  const value = Number(first)
  if (!Number.isFinite(value) || value < 0) {
    return null
  }
  return value
}

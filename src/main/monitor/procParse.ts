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

import type { MonitorProcessSample, MonitorSample } from '../../shared/contract'

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
 * Splits the combined tick output into exactly `count` section strings —
 * missing trailing sections come back as empty strings rather than being
 * absent.
 */
export function splitSections(output: string, count: number, marker: string = SECTION_MARKER): string[] {
  const parts = output.split(new RegExp(`^${marker}\\s*$`, 'm')).map((s) => s.trim())
  while (parts.length < count) {
    parts.push('')
  }
  return parts.slice(0, count)
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

/** Root-filesystem usage figures parsed from `df -Pk /`. */
export interface DiskUsage {
  totalBytes: number
  usedBytes: number
  availableBytes: number
}

/**
 * Parses `df -Pk /`'s output (POSIX format, 1024-byte blocks — stable across
 * GNU coreutils and BusyBox). POSIX `df` wraps the device name onto its own
 * line when it's long, pushing the numeric columns onto the next line — this
 * is tolerated by dropping the header line, joining every remaining line
 * with a space, and walking backward from the last token, which is always
 * the queried mount point ("/"), regardless of how many tokens the device
 * name itself contributed. Returns null on garbage/missing `df` — not fatal
 * to the tick, unlike a missing /proc/stat.
 */
export function parseDiskUsage(text: string): DiskUsage | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length < 2) {
    return null
  }
  const tokens = lines.slice(1).join(' ').split(/\s+/)
  if (tokens.length < 5) {
    return null
  }
  const totalKb = Number(tokens[tokens.length - 5])
  const usedKb = Number(tokens[tokens.length - 4])
  const availableKb = Number(tokens[tokens.length - 3])
  if (![totalKb, usedKb, availableKb].every(Number.isFinite) || totalKb <= 0) {
    return null
  }
  return {
    totalBytes: totalKb * KB,
    usedBytes: usedKb * KB,
    availableBytes: availableKb * KB
  }
}

/** Marker prefixing each per-process record, followed by the raw /proc/[pid]/stat line. */
export const PROCESS_MARKER = '@P@'

/** Raw per-process figures parsed straight from one /proc/[pid]/stat line. */
export interface ProcessSnapshot {
  pid: number
  /** comm — process name, parsed via the first '(' / last ')' to tolerate spaces/parens in the name itself. */
  comm: string
  utime: number
  stime: number
  /** RSS in pages (not yet converted to bytes — see PAGE_SIZE_BYTES). */
  rssPages: number
}

/**
 * Assumed page size for RSS-in-pages → bytes conversion. Correct on every
 * mainstream x86_64/aarch64 Linux distro this app targets — a documented
 * simplification rather than a second per-pid /proc/[pid]/status read just
 * for VmRSS.
 */
export const PAGE_SIZE_BYTES = 4096

/**
 * Parses the @P@-delimited process-stat dump into one entry per pid. Skips
 * any record whose /proc/[pid]/stat line is missing, malformed, or too short
 * (minimal busybox stat, or a pid that raced away between listing and read)
 * rather than throwing.
 */
export function parseProcessSnapshot(text: string, marker: string = PROCESS_MARKER): ProcessSnapshot[] {
  const snapshots: ProcessSnapshot[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith(marker)) {
      continue
    }
    const statLine = (lines[i + 1] ?? '').trim()
    const open = statLine.indexOf('(')
    const close = statLine.lastIndexOf(')')
    if (open === -1 || close === -1 || close < open) {
      continue
    }
    const pid = Number(statLine.slice(0, open).trim())
    const comm = statLine.slice(open + 1, close)
    // Fields after "pid (comm) " start at stat's field 3 (state) as index 0:
    // utime is field 14 -> index 11, stime is field 15 -> index 12, rss is field 24 -> index 21.
    const rest = statLine.slice(close + 1).trim().split(/\s+/)
    if (!Number.isFinite(pid) || rest.length < 22) {
      continue
    }
    const utime = Number(rest[11])
    const stime = Number(rest[12])
    const rssPages = Number(rest[21])
    if (![utime, stime, rssPages].every(Number.isFinite)) {
      continue
    }
    snapshots.push({ pid, comm, utime, stime, rssPages })
  }
  return snapshots
}

/** One process's resolved figures for a single Monitor tick — mirrors {@link MonitorProcessSample}. */
export type ProcessSample = MonitorProcessSample

/**
 * Computes each process's CPU% by reusing the SAME aggregate 'cpu' row total
 * delta that {@link cpuPercentages} already computes as the denominator:
 * `cpuPct = ((utimeDelta + stimeDelta) / aggregateTotalDelta) * 100`. This
 * needs no CLK_TCK/HZ constant and no wall-clock elapsed time — utime/stime
 * and /proc/stat's aggregate row are measured in the same tick units on the
 * same machine, so the ratio is unit-independent — and it keeps per-process
 * % directly comparable to/summable against the aggregate % already shown
 * (100 = all cores fully busy for the interval). Returns `cpuPct: null` for
 * a pid with no prior sample yet (new process, or the first tick overall).
 */
export function processCpuPercentages(
  prev: Map<number, ProcessSnapshot> | null,
  curr: ProcessSnapshot[],
  aggregateTotalDelta: number | null
): ProcessSample[] {
  return curr.map((snap) => {
    const name = snap.comm
    const rssBytes = snap.rssPages * PAGE_SIZE_BYTES
    const prevSnap = prev?.get(snap.pid)
    if (!prevSnap || aggregateTotalDelta === null || aggregateTotalDelta <= 0) {
      return { pid: snap.pid, name, rssBytes, cpuPct: null }
    }
    const busyDelta = snap.utime + snap.stime - (prevSnap.utime + prevSnap.stime)
    const cpuPct = Math.max(0, (busyDelta / aggregateTotalDelta) * 100)
    return { pid: snap.pid, name, rssBytes, cpuPct: Math.round(cpuPct * 10) / 10 }
  })
}

/** Result of capping the process list before transmission. */
export interface CappedProcesses {
  processes: ProcessSample[]
  /** Full count before capping, so the UI can show "showing top N of M". */
  totalCount: number
}

/**
 * Bounds the transmitted process list — collection always walks every pid;
 * this only bounds the IPC payload against pathological process counts
 * (e.g. a fork bomb).
 */
export const MAX_PROCESSES = 200

/**
 * Sorts by a combined 0–100-scale score (cpuPct + rss-as-%-of-total-memory)
 * so neither a CPU-heavy nor a memory-heavy process is systematically
 * excluded from the transmitted top-N, then slices to `max`.
 */
export function capProcesses(
  samples: ProcessSample[],
  memTotalBytes: number,
  max: number = MAX_PROCESSES
): CappedProcesses {
  const score = (s: ProcessSample): number =>
    (s.cpuPct ?? 0) + (memTotalBytes > 0 ? (s.rssBytes / memTotalBytes) * 100 : 0)
  const sorted = [...samples].sort((a, b) => score(b) - score(a))
  return { processes: sorted.slice(0, max), totalCount: samples.length }
}

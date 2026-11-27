import type { MonitorProcessSample, MonitorSample } from '@shared/contract'

export type MonitorTone = 'primary' | 'warning' | 'error'
export type ProcessSortKey = 'name' | 'pid' | 'cpuPct' | 'rssBytes'
export type SortDirection = 'asc' | 'desc'

export interface SparklinePoint {
  x: number
  y: number
  value: number
  index: number
}

export interface SparklineGeometry {
  linePoints: string
  areaPoints: string
  coords: SparklinePoint[]
}

export interface MemoryBreakdown {
  activeBytes: number
  buffersBytes: number
  cachedBytes: number
  availableBytes: number
  activePct: number
  buffersPct: number
  cachedPct: number
  availablePct: number
}

/** Maps a 0–100 usage percentage to a semantic status tone. */
export function usageTone(pct: number): MonitorTone {
  if (pct >= 90) return 'error'
  if (pct >= 75) return 'warning'
  return 'primary'
}

/** Maps 1-minute load average relative to core count to a semantic status tone. */
export function loadTone(load1m: number, coreCount: number): MonitorTone {
  const cores = Math.max(1, coreCount)
  if (load1m >= cores * 1.5) return 'error'
  if (load1m >= cores) return 'warning'
  return 'primary'
}

/** Builds SVG polyline, closed area polygon, and point coordinates for a 0–100 series. */
export function buildSparklineGeometry(
  values: number[],
  width: number,
  height: number
): SparklineGeometry {
  if (values.length < 2 || width <= 0 || height <= 0) {
    return { linePoints: '', areaPoints: '', coords: [] }
  }
  const step = width / (values.length - 1)
  const coords: SparklinePoint[] = values.map((raw, index) => {
    const value = Math.min(100, Math.max(0, raw))
    const x = Number((index * step).toFixed(1))
    const y = Number((height - (value / 100) * height).toFixed(1))
    return { x, y, value, index }
  })
  const linePoints = coords.map((p) => `${p.x},${p.y}`).join(' ')
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`
  return { linePoints, areaPoints, coords }
}

/** Splits `/proc/meminfo` fields into non-overlapping segments for stacked bar display. */
export function computeMemoryBreakdown(memory: MonitorSample['memory']): MemoryBreakdown {
  const total = Math.max(0, memory.totalBytes)
  if (total === 0) {
    return {
      activeBytes: 0,
      buffersBytes: 0,
      cachedBytes: 0,
      availableBytes: 0,
      activePct: 0,
      buffersPct: 0,
      cachedPct: 0,
      availablePct: 0
    }
  }
  const availableBytes = Math.min(total, Math.max(0, memory.availableBytes))
  const usedBytes = Math.min(total, Math.max(0, memory.usedBytes))
  // Active memory excludes reclaimable buffers/cached; clamp so segments never exceed total.
  const buffersBytes = Math.min(total - usedBytes, Math.max(0, memory.buffersBytes))
  const cachedBytes = Math.min(total - usedBytes - buffersBytes, Math.max(0, memory.cachedBytes))
  const freeRemainder = Math.max(0, total - usedBytes - buffersBytes - cachedBytes)

  const toPct = (bytes: number): number => Number(((bytes / total) * 100).toFixed(1))
  return {
    activeBytes: usedBytes,
    buffersBytes,
    cachedBytes,
    availableBytes: Math.max(availableBytes, freeRemainder),
    activePct: toPct(usedBytes),
    buffersPct: toPct(buffersBytes),
    cachedPct: toPct(cachedBytes),
    availablePct: toPct(freeRemainder)
  }
}

export function processLabel(process: MonitorProcessSample): string {
  return process.service ?? process.name
}

/** Filters processes by name or PID substring and sorts by the selected column. */
export function filterAndSortProcesses(
  processes: MonitorProcessSample[],
  query: string,
  sortKey: ProcessSortKey,
  sortDir: SortDirection
): MonitorProcessSample[] {
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? processes.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          (p.service?.toLowerCase().includes(needle) ?? false) ||
          String(p.pid).includes(needle) ||
          (p.cmdline?.toLowerCase().includes(needle) ?? false)
      )
    : processes

  const dir = sortDir === 'asc' ? 1 : -1
  return [...filtered].sort((a, b) => {
    if (sortKey === 'name') {
      return processLabel(a).localeCompare(processLabel(b)) * dir
    }
    if (sortKey === 'pid') {
      return (a.pid - b.pid) * dir
    }
    const av = sortKey === 'cpuPct' ? (a.cpuPct ?? -1) : a.rssBytes
    const bv = sortKey === 'cpuPct' ? (b.cpuPct ?? -1) : b.rssBytes
    return (av - bv) * dir
  })
}

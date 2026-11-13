import { describe, expect, it } from 'vitest'
import type { MonitorProcessSample } from '@shared/contract'
import {
  buildSparklineGeometry,
  computeMemoryBreakdown,
  filterAndSortProcesses,
  loadTone,
  usageTone
} from './monitorHelpers'

describe('usageTone', () => {
  it('maps thresholds to primary, warning, and error', () => {
    expect(usageTone(0)).toBe('primary')
    expect(usageTone(74.9)).toBe('primary')
    expect(usageTone(75)).toBe('warning')
    expect(usageTone(89.9)).toBe('warning')
    expect(usageTone(90)).toBe('error')
  })
})

describe('loadTone', () => {
  it('compares 1m load average against core count', () => {
    expect(loadTone(1.5, 4)).toBe('primary')
    expect(loadTone(4, 4)).toBe('warning')
    expect(loadTone(6, 4)).toBe('error')
    expect(loadTone(1.5, 0)).toBe('error')
  })
})

describe('buildSparklineGeometry', () => {
  it('returns empty geometry for fewer than 2 points', () => {
    expect(buildSparklineGeometry([], 100, 40)).toEqual({ linePoints: '', areaPoints: '', coords: [] })
    expect(buildSparklineGeometry([50], 100, 40)).toEqual({ linePoints: '', areaPoints: '', coords: [] })
  })

  it('builds clamped line and area points across the viewport', () => {
    const geom = buildSparklineGeometry([-10, 50, 120], 100, 40)
    expect(geom.coords).toEqual([
      { x: 0, y: 40, value: 0, index: 0 },
      { x: 50, y: 20, value: 50, index: 1 },
      { x: 100, y: 0, value: 100, index: 2 }
    ])
    expect(geom.linePoints).toBe('0,40 50,20 100,0')
    expect(geom.areaPoints).toBe('0,40 0,40 50,20 100,0 100,40')
  })
})

describe('computeMemoryBreakdown', () => {
  it('handles zero totalBytes safely', () => {
    expect(
      computeMemoryBreakdown({
        totalBytes: 0,
        usedBytes: 0,
        availableBytes: 0,
        buffersBytes: 0,
        cachedBytes: 0
      })
    ).toEqual({
      activeBytes: 0,
      buffersBytes: 0,
      cachedBytes: 0,
      availableBytes: 0,
      activePct: 0,
      buffersPct: 0,
      cachedPct: 0,
      availablePct: 0
    })
  })

  it('computes non-overlapping percentages summing to ~100%', () => {
    const res = computeMemoryBreakdown({
      totalBytes: 1000,
      usedBytes: 500,
      availableBytes: 500,
      buffersBytes: 100,
      cachedBytes: 200
    })
    expect(res.activePct).toBe(50)
    expect(res.buffersPct).toBe(10)
    expect(res.cachedPct).toBe(20)
    expect(res.availablePct).toBe(20)
  })
})

describe('filterAndSortProcesses', () => {
  const sample: MonitorProcessSample[] = [
    { pid: 101, name: 'nginx', cpuPct: 2.5, rssBytes: 4096 },
    { pid: 202, name: 'node', cpuPct: null, rssBytes: 8192 },
    { pid: 303, name: 'postgres', cpuPct: 12.0, rssBytes: 2048 }
  ]

  it('filters by process name or PID substring', () => {
    expect(filterAndSortProcesses(sample, 'NGI', 'cpuPct', 'desc').map((p) => p.pid)).toEqual([101])
    expect(filterAndSortProcesses(sample, '202', 'cpuPct', 'desc').map((p) => p.pid)).toEqual([202])
  })

  it('sorts by cpuPct with null treated as lowest', () => {
    expect(filterAndSortProcesses(sample, '', 'cpuPct', 'desc').map((p) => p.pid)).toEqual([303, 101, 202])
    expect(filterAndSortProcesses(sample, '', 'cpuPct', 'asc').map((p) => p.pid)).toEqual([202, 101, 303])
  })

  it('sorts by pid and name', () => {
    expect(filterAndSortProcesses(sample, '', 'pid', 'desc').map((p) => p.pid)).toEqual([303, 202, 101])
    expect(filterAndSortProcesses(sample, '', 'name', 'asc').map((p) => p.name)).toEqual([
      'nginx',
      'node',
      'postgres'
    ])
  })
})

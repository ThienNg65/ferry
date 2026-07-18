import { BrowserWindow } from 'electron'
import { SessionManager } from '../ssh/SessionManager'
import {
  cpuPercentages,
  parseLoadAvg,
  parseMeminfo,
  parseProcStat,
  parseUptime,
  splitSections,
  type CpuTimes
} from './procParse'
import { EVENT_CHANNELS, type MonitorSample, type MonitorStatusEvent } from '../../shared/contract'

/** Default/clamped bounds for the polling interval — an IPC-sourced numeric field must never be trusted as-is (see TailManager's sanitizeHistoryLines). */
const DEFAULT_INTERVAL_MS = 2000
const MIN_INTERVAL_MS = 1000
const MAX_INTERVAL_MS = 30_000
/** Consecutive failed ticks (after a previously-working loop) before giving up. */
const MAX_CONSECUTIVE_FAILURES = 3
/** Per-tick exec timeout — generous but bounded so a hung shell can't wedge the loop. */
const TICK_TIMEOUT_MS = 10_000

const TICK_COMMAND =
  'cat /proc/stat 2>/dev/null; echo @@@; cat /proc/meminfo 2>/dev/null; echo @@@; ' +
  'cat /proc/loadavg 2>/dev/null; echo @@@; cat /proc/uptime 2>/dev/null'

function sanitizeIntervalMs(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_INTERVAL_MS
  }
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_INTERVAL_MS
  }
  return Math.min(Math.max(n, MIN_INTERVAL_MS), MAX_INTERVAL_MS)
}

interface MonitorEntry {
  sessionId: string
  intervalMs: number
  prevStat: CpuTimes[] | null
  consecutiveFailures: number
  timer: ReturnType<typeof setTimeout> | null
  stopped: boolean
}

/**
 * Polls a connected session's server for CPU/memory/load stats, feeding the
 * Monitor dock tab. Modeled on TailManager's shape (singleton, one entry per
 * key, broadcast helpers) but simpler: each tick is a self-contained buffered
 * `exec` on a self-rescheduling `setTimeout` chain rather than a long-lived
 * streaming command, so there is no remote process to track/kill and no
 * reconnect-with-backoff machinery — a dropped tick just misses one sample.
 *
 * Keyed directly by sessionId (unlike tails, there is nothing to multiplex —
 * one monitor per session at most).
 */
export class MonitorManager {
  private static instance: MonitorManager | null = null

  static getInstance(): MonitorManager {
    if (!MonitorManager.instance) {
      MonitorManager.instance = new MonitorManager()
    }
    return MonitorManager.instance
  }

  private readonly entries = new Map<string, MonitorEntry>()

  /** Starts (or restarts) polling for a session. */
  start(sessionId: string, intervalMs?: number): void {
    this.stop(sessionId)
    const entry: MonitorEntry = {
      sessionId,
      intervalMs: sanitizeIntervalMs(intervalMs),
      prevStat: null,
      consecutiveFailures: 0,
      timer: null,
      stopped: false
    }
    this.entries.set(sessionId, entry)
    this.broadcastStatus(sessionId, 'started')
    void this.tick(entry)
  }

  /** Stops polling for a session. Safe to call when nothing is running. */
  stop(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      return
    }
    entry.stopped = true
    if (entry.timer) {
      clearTimeout(entry.timer)
    }
    this.entries.delete(sessionId)
    this.broadcastStatus(sessionId, 'stopped')
  }

  /** Alias of stop() — hooked into SessionManager.close(). */
  stopAllForSession(sessionId: string): void {
    this.stop(sessionId)
  }

  private async tick(entry: MonitorEntry): Promise<void> {
    if (entry.stopped) {
      return
    }
    let shell
    try {
      shell = SessionManager.getInstance().shell(entry.sessionId)
    } catch {
      // Session already closed/dead — stop quietly, no error broadcast.
      this.stop(entry.sessionId)
      return
    }

    try {
      const result = await shell.exec(TICK_COMMAND, { timeoutMs: TICK_TIMEOUT_MS })
      const [statText, memText, loadText, uptimeText] = splitSections(result.stdout)
      const currStat = parseProcStat(statText)

      if (currStat.length === 0) {
        // No /proc/stat at all — not Linux (BSD/macOS) or a locked-down shell.
        // Report once and stop; retrying would just spam identical failures.
        this.broadcastStatus(entry.sessionId, 'unsupported', 'Resource monitoring requires a Linux /proc filesystem')
        this.stop(entry.sessionId)
        return
      }

      const mem = parseMeminfo(memText)
      const loadAvg = parseLoadAvg(loadText)
      const uptimeSec = parseUptime(uptimeText)
      if (!mem || !loadAvg || uptimeSec === null) {
        throw new Error('Unparseable /proc output')
      }

      const cpu = entry.prevStat ? cpuPercentages(entry.prevStat, currStat) : null
      const sample: MonitorSample = {
        sessionId: entry.sessionId,
        timestamp: Date.now(),
        cpu: cpu ? { ...cpu, coreCount: currStat.length - 1 } : null,
        memory: {
          totalBytes: mem.totalBytes,
          usedBytes: mem.usedBytes,
          availableBytes: mem.availableBytes,
          buffersBytes: mem.buffersBytes,
          cachedBytes: mem.cachedBytes
        },
        swap: mem.swap,
        loadAvg,
        uptimeSec
      }
      entry.prevStat = currStat
      entry.consecutiveFailures = 0
      this.broadcastSample(sample)
    } catch (e) {
      entry.consecutiveFailures += 1
      if (entry.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.broadcastStatus(entry.sessionId, 'error', e instanceof Error ? e.message : String(e))
        this.stop(entry.sessionId)
        return
      }
    }

    if (!entry.stopped) {
      entry.timer = setTimeout(() => void this.tick(entry), entry.intervalMs)
    }
  }

  private broadcastSample(sample: MonitorSample): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.monitorSample, sample)
      }
    }
  }

  private broadcastStatus(sessionId: string, state: MonitorStatusEvent['state'], message?: string): void {
    const payload: MonitorStatusEvent = { sessionId, state, message }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.monitorStatus, payload)
      }
    }
  }
}

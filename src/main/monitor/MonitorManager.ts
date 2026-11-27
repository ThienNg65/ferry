import { host } from '../host/host'
import { SessionManager } from '../ssh/SessionManager'
import {
  DEFAULT_PAGE_SIZE_BYTES,
  capProcesses,
  cpuPercentages,
  parseDiskUsage,
  parseLoadAvg,
  parseMeminfo,
  parseProcessCmdlines,
  parseProcessSnapshot,
  parseProcStat,
  parseUptime,
  processCpuPercentages,
  resolvePageSizeBytes,
  splitSections,
  type CpuTimes,
  type ProcessSnapshot
} from './procParse'
import {
  CMDLINE_ENRICH_MAX,
  CMDLINE_MAX_CHARS,
  CMDLINE_UI_MAX_CHARS,
  ENRICH_COMMS,
  deriveServiceName,
  redactCmdline
} from './serviceNames'
import { EVENT_CHANNELS, type MonitorSample, type MonitorStatusEvent } from '../../shared/contract'

/** Default/clamped bounds for the polling interval — an IPC-sourced numeric field must never be trusted as-is (see TailManager's sanitizeHistoryLines). */
const DEFAULT_INTERVAL_MS = 2000
const MIN_INTERVAL_MS = 1000
const MAX_INTERVAL_MS = 30_000
/** Consecutive failed ticks (after a previously-working loop) before giving up. */
const MAX_CONSECUTIVE_FAILURES = 3
/** Per-tick exec timeout — generous but bounded so a hung shell can't wedge the loop. */
const TICK_TIMEOUT_MS = 10_000

/** Number of @@@-delimited sections in TICK_COMMAND's output — keep in sync with splitSections() calls below. */
const TICK_SECTION_COUNT = 7
const INITIAL_TICK_SECTION_COUNT = TICK_SECTION_COUNT + 1
/** Number of top hot processes to enrich with cached `/proc/[pid]/cmdline`. */
const CMDLINE_ENRICH_TOP_N = 15
const CMDLINE_TIMEOUT_MS = 2_000

const TICK_COMMAND =
  'cat /proc/stat 2>/dev/null; echo @@@; cat /proc/meminfo 2>/dev/null; echo @@@; ' +
  'cat /proc/loadavg 2>/dev/null; echo @@@; cat /proc/uptime 2>/dev/null; echo @@@; ' +
  'df -Pk / 2>/dev/null; echo @@@; ' +
  'df -Pi / 2>/dev/null || true; echo @@@; ' +
  'for d in /proc/[0-9]*; do p=${d#/proc/}; if IFS= read -r s < "$d/stat" 2>/dev/null; then printf "@P@%s\\n%s\\n" "$p" "$s"; fi; done'

const INITIAL_TICK_COMMAND = `${TICK_COMMAND}; echo @@@; getconf PAGE_SIZE 2>/dev/null || true`

export function sanitizeIntervalMs(value: number | undefined): number {
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
  /** Rebuilt fully from every tick's process dump (not merged) — naturally sheds exited pids and gives any newly-hot pid a fresh baseline. */
  prevProcesses: Map<number, ProcessSnapshot> | null
  /** Cached `/proc/[pid]/cmdline` per live pid (invalidated if comm changes or pid exits) so steady-state ticks do zero extra execs. */
  cmdlineCache: Map<number, { comm: string; cmdline: string; service: string | null }>
  /** Resolved once per session; null means the first tick still needs discovery. */
  pageSizeBytes: number | null
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
      prevProcesses: null,
      cmdlineCache: new Map(),
      pageSizeBytes: null,
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
      const discoveringPageSize = entry.pageSizeBytes === null
      const command = discoveringPageSize ? INITIAL_TICK_COMMAND : TICK_COMMAND
      const result = await shell.exec(command, { timeoutMs: TICK_TIMEOUT_MS })
      if (entry.stopped) {
        // stop()/stopAllForSession() fired while the exec was in flight — don't
        // broadcast a sample or status for a monitor that's already stopped.
        return
      }
      const sections = splitSections(
        result.stdout,
        discoveringPageSize ? INITIAL_TICK_SECTION_COUNT : TICK_SECTION_COUNT
      )
      const [statText, memText, loadText, uptimeText, diskText, inodeText, procText] = sections
      if (discoveringPageSize) {
        entry.pageSizeBytes = resolvePageSizeBytes(sections[TICK_SECTION_COUNT] ?? '')
      }
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
      const aggregateTotalDelta = entry.prevStat ? currStat[0].total - entry.prevStat[0].total : null
      const currProcesses = parseProcessSnapshot(procText)
      const livePids = new Set(currProcesses.map((p) => p.pid))
      for (const cachedPid of entry.cmdlineCache.keys()) {
        if (!livePids.has(cachedPid)) entry.cmdlineCache.delete(cachedPid)
      }
      const processSamples = processCpuPercentages(
        entry.prevProcesses,
        currProcesses,
        aggregateTotalDelta,
        entry.pageSizeBytes ?? DEFAULT_PAGE_SIZE_BYTES
      )
      const { processes, totalCount } = capProcesses(processSamples, mem.totalBytes)

      // Enrich top hot processes with cached `/proc/[pid]/cmdline` (only queries uncached PIDs).
      const enrichCandidates = [
        ...processes.slice(0, CMDLINE_ENRICH_TOP_N),
        ...processes.filter((p) => ENRICH_COMMS.includes(p.name))
      ]
      const topSlice = [...new Map(enrichCandidates.map((p) => [p.pid, p])).values()].slice(0, CMDLINE_ENRICH_MAX)
      const missingPids = topSlice
        .filter((p) => {
          const cached = entry.cmdlineCache.get(p.pid)
          return !cached || cached.comm !== p.name
        })
        .map((p) => p.pid)
      if (missingPids.length > 0 && !entry.stopped) {
        try {
          const cmd = `for p in ${missingPids.join(' ')}; do if [ -r "/proc/$p/cmdline" ]; then printf '@C@%s\\t' "$p"; tr '\\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | head -c ${CMDLINE_MAX_CHARS}; printf '\\n'; fi; done`
          const cmdRes = await shell.exec(cmd, { timeoutMs: CMDLINE_TIMEOUT_MS })
          if (!entry.stopped && cmdRes.stdout) {
            const parsed = parseProcessCmdlines(cmdRes.stdout)
            for (const p of topSlice) {
              if (missingPids.includes(p.pid)) {
                const cmdline = parsed.get(p.pid) ?? ''
                entry.cmdlineCache.set(p.pid, { comm: p.name, cmdline, service: deriveServiceName(cmdline) })
              }
            }
          }
        } catch {
          // Non-fatal: kernel threads or restricted /proc hide cmdline.
        }
      }
      if (entry.stopped) {
        return
      }
      const enrichedProcesses = processes.map((p) => {
        const cached = entry.cmdlineCache.get(p.pid)
        if (!cached || cached.comm !== p.name || !cached.cmdline) {
          return p
        }
        const cmdline = redactCmdline(cached.cmdline).slice(0, CMDLINE_UI_MAX_CHARS)
        return cached.service ? { ...p, cmdline, service: cached.service } : { ...p, cmdline }
      })

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
        disk: parseDiskUsage(diskText, inodeText),
        processes: enrichedProcesses,
        processTotalCount: totalCount,
        loadAvg,
        uptimeSec
      }
      entry.prevStat = currStat
      entry.prevProcesses = new Map(currProcesses.map((p) => [p.pid, p]))
      entry.consecutiveFailures = 0
      this.broadcastSample(sample)
    } catch (e) {
      if (entry.stopped || this.entries.get(entry.sessionId) !== entry) {
        return
      }
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
    host().broadcast(EVENT_CHANNELS.monitorSample, sample)
  }

  private broadcastStatus(sessionId: string, state: MonitorStatusEvent['state'], message?: string): void {
    const payload: MonitorStatusEvent = { sessionId, state, message }
    host().broadcast(EVENT_CHANNELS.monitorStatus, payload)
  }
}

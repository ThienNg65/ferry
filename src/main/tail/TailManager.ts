import { BrowserWindow } from 'electron'
import { SessionManager } from '../ssh/SessionManager'
import { isTransient } from '../ssh/errors'
import { EVENT_CHANNELS, type TailEndEvent, type TailLineEvent, type TailNoticeEvent } from '../../shared/contract'

interface TailEntry {
  controller: AbortController
  sessionId: string
  remotePath: string
  /** PID of the remote `tail` process, captured from its first output line. */
  remotePid: number | null
  /** Wall-clock ms of the last activity; used by the idle reaper. */
  lastActive: number
}

/** Marker line the remote command prints first to report the tail's PID. */
const PID_MARKER = 'FERRYPID:'
/** Streams with no activity for this long are reaped. */
const IDLE_TTL_MS = 30 * 60 * 1000
/** Reconnect attempts before giving up and ending the stream. */
const MAX_RECONNECT_ATTEMPTS = 5

/** Single-quotes a value for safe interpolation into a remote shell command. */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Clamps `historyLines` to a safe non-negative integer. This value is
 * interpolated directly (unquoted) into a remote shell command as `tail -n
 * ${historyLines}`, and the IPC boundary only casts the incoming request to
 * its TypeScript type without runtime validation — so a compromised or buggy
 * renderer could otherwise smuggle arbitrary shell syntax through this field.
 */
function sanitizeHistoryLines(value: number): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 0) {
    return 200
  }
  return Math.min(n, 100_000)
}

/**
 * TailManager — `tail -F` multiplexer over the SSH exec channel.
 *
 * Uses `-F` (retry + follow-by-name), not plain `-f`, so a rotated/truncated
 * remote log file is followed correctly — this is the core differentiator
 * versus WinSCP's non-tailing log panel. A PID-capture trick lets `stop()`
 * kill the exact remote `tail` process; closing the SSH channel alone does
 * not reliably kill a backgrounded remote process without a PTY.
 *
 * Auto-reconnects on transient drops (unlike file-browsing sessions, where
 * silent reconnect would be unsafe) with capped exponential backoff, and
 * reaps streams that see no activity for {@link IDLE_TTL_MS}.
 */
export class TailManager {
  private static instance: TailManager | null = null
  private readonly tails = new Map<string, TailEntry>()
  private reaper: ReturnType<typeof setInterval> | null = null

  static getInstance(): TailManager {
    if (TailManager.instance === null) {
      TailManager.instance = new TailManager()
    }
    return TailManager.instance
  }

  private broadcastLine(tailId: string, line: string): void {
    const payload: TailLineEvent = { tailId, line }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.tailLine, payload)
      }
    }
  }

  private broadcastNotice(tailId: string, message: string): void {
    const payload: TailNoticeEvent = { tailId, message }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.tailNotice, payload)
      }
    }
  }

  private broadcastEnd(tailId: string, error?: string): void {
    const payload: TailEndEvent = { tailId, error }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.tailEnd, payload)
      }
    }
  }

  private ensureReaper(): void {
    if (this.reaper) {
      return
    }
    this.reaper = setInterval(() => {
      const now = Date.now()
      for (const [id, entry] of this.tails) {
        if (now - entry.lastActive > IDLE_TTL_MS) {
          this.stop(id)
        }
      }
      if (this.tails.size === 0 && this.reaper) {
        clearInterval(this.reaper)
        this.reaper = null
      }
    }, 60_000)
  }

  /** Starts following a remote file. `tailId` is caller-chosen (used to route lines and to stop). */
  start(tailId: string, sessionId: string, remotePath: string, historyLines = 200): void {
    this.stop(tailId)
    const controller = new AbortController()
    this.tails.set(tailId, { controller, sessionId, remotePath, remotePid: null, lastActive: Date.now() })
    this.ensureReaper()
    void this.follow(tailId, sanitizeHistoryLines(historyLines), 0)
  }

  /** Runs one `tail -F` attempt and reconnects on transient end. */
  private async follow(tailId: string, historyLines: number, attempt: number): Promise<void> {
    const entry = this.tails.get(tailId)
    if (!entry || entry.controller.signal.aborted) {
      return
    }
    try {
      const shell = SessionManager.getInstance().shell(entry.sessionId)
      const command = `printf '${PID_MARKER}%s\\n' $$; exec tail -n ${historyLines} -F ${shellEscape(entry.remotePath)}`
      await shell.execLines(command, {
        signal: entry.controller.signal,
        timeoutMs: 6 * 60 * 60 * 1000, // effectively unbounded; the reaper handles idle streams
        onLine: (line) => {
          entry.lastActive = Date.now()
          if (line.startsWith(PID_MARKER)) {
            const pid = parseInt(line.slice(PID_MARKER.length).trim(), 10)
            if (!Number.isNaN(pid)) {
              entry.remotePid = pid
            }
            return
          }
          this.broadcastLine(tailId, line)
        },
        onStderr: (chunk) => {
          entry.lastActive = Date.now()
          const trimmed = chunk.trim()
          if (trimmed) {
            this.broadcastNotice(tailId, trimmed)
          }
        }
      })
      if (!entry.controller.signal.aborted) {
        await this.reconnect(tailId, historyLines, attempt)
      }
    } catch (e) {
      if (entry.controller.signal.aborted) {
        this.broadcastEnd(tailId)
        return
      }
      if (!isTransient(e)) {
        const msg = e instanceof Error ? e.message : String(e)
        this.broadcastEnd(tailId, msg)
        this.tails.delete(tailId)
        return
      }
      await this.reconnect(tailId, historyLines, attempt, e)
    }
  }

  private async reconnect(
    tailId: string,
    historyLines: number,
    attempt: number,
    lastError?: unknown
  ): Promise<void> {
    const entry = this.tails.get(tailId)
    if (!entry || entry.controller.signal.aborted) {
      return
    }
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      const msg = lastError instanceof Error ? lastError.message : lastError ? String(lastError) : 'stream ended'
      this.broadcastEnd(tailId, msg)
      this.tails.delete(tailId)
      return
    }
    const backoff = Math.min(2000 * Math.pow(2, attempt), 15_000)
    setTimeout(() => {
      // Re-tail with 0 history lines so we don't replay the whole buffer.
      void this.follow(tailId, 0, attempt + 1)
    }, backoff)
  }

  /** Stops a stream, kills its remote `tail`, and notifies the renderer. */
  stop(tailId: string): void {
    const entry = this.tails.get(tailId)
    if (!entry) {
      return
    }
    entry.controller.abort()
    this.tails.delete(tailId)
    this.killRemoteTail(entry)
    this.broadcastEnd(tailId)
  }

  /** Stops every tail bound to a session — called when that session closes. */
  stopAllForSession(sessionId: string): void {
    for (const [tailId, entry] of this.tails) {
      if (entry.sessionId === sessionId) {
        this.stop(tailId)
      }
    }
  }

  /** Best-effort kill of the remote tail process captured for a stream. */
  private killRemoteTail(entry: TailEntry): void {
    if (entry.remotePid === null) {
      return
    }
    try {
      const shell = SessionManager.getInstance().shell(entry.sessionId)
      void shell.exec(`kill ${entry.remotePid} 2>/dev/null || true`, { attempts: 1, timeoutMs: 5000 }).catch(() => undefined)
    } catch {
      // Session already disconnected — the tail dies with the connection anyway.
    }
  }
}

import { host } from '../host/host'
import { SessionManager } from '../ssh/SessionManager'
import { isTransient } from '../ssh/errors'
import { shellEscape } from '../ssh/shellEscape'
import {
  EVENT_CHANNELS,
  type TailEndEvent,
  type TailLineEvent,
  type TailNoticeEvent,
  type TailReadyEvent
} from '../../shared/contract'

interface TailEntry {
  controller: AbortController
  sessionId: string
  remotePath: string
  /** PID of the remote `tail` process, captured from its first output line. */
  remotePid: number | null
  /** Pending reconnect timer handle, cleared on stop/supersede. */
  reconnectTimer: ReturnType<typeof setTimeout> | null
  /** Last non-empty stderr line observed for this stream. */
  lastStderr: string | null
  /** Ensures `tail:end` is emitted at most once per entry. */
  ended: boolean
}

/** Marker line the remote command prints first to report the tail's PID. */
const PID_MARKER = 'FERRYPID:'
/** Reconnect attempts before giving up and ending the stream. */
const MAX_RECONNECT_ATTEMPTS = 5

/**
 * Clamps `historyLines` to a safe non-negative integer. This value is
 * interpolated directly (unquoted) into a remote shell command as `tail -n
 * ${historyLines}`, and the IPC boundary only casts the incoming request to
 * its TypeScript type without runtime validation — so a compromised or buggy
 * renderer could otherwise smuggle arbitrary shell syntax through this field.
 */
export function sanitizeHistoryLines(value: unknown): number {
  if (typeof value !== 'number') {
    return 200
  }
  const n = Math.trunc(value)
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
 * silent reconnect would be unsafe) with capped exponential backoff.
 * A tail stays active until its tab, SSH session or the sidecar closes.
 */
export class TailManager {
  private static instance: TailManager | null = null
  private readonly tails = new Map<string, TailEntry>()

  static getInstance(): TailManager {
    if (TailManager.instance === null) {
      TailManager.instance = new TailManager()
    }
    return TailManager.instance
  }

  private broadcastReady(tailId: string): void {
    const payload: TailReadyEvent = { tailId }
    host().broadcast(EVENT_CHANNELS.tailReady, payload)
  }

  private broadcastLine(tailId: string, line: string): void {
    const payload: TailLineEvent = { tailId, line }
    host().broadcast(EVENT_CHANNELS.tailLine, payload)
  }

  private broadcastNotice(tailId: string, message: string): void {
    const payload: TailNoticeEvent = { tailId, message }
    host().broadcast(EVENT_CHANNELS.tailNotice, payload)
  }

  private broadcastEnd(tailId: string, error?: string): void {
    const payload: TailEndEvent = { tailId, error }
    host().broadcast(EVENT_CHANNELS.tailEnd, payload)
  }

  private finishEntry(tailId: string, entry: TailEntry, error?: string): void {
    if (entry.ended) {
      return
    }
    entry.ended = true
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer)
      entry.reconnectTimer = null
    }
    if (this.tails.get(tailId) === entry) {
      this.tails.delete(tailId)
    }
    this.broadcastEnd(tailId, error)
  }

  /** Starts following a remote file. `tailId` is caller-chosen (used to route lines and to stop). */
  start(tailId: string, sessionId: string, remotePath: string, historyLines = 200): void {
    // Validate the session synchronously before registering or returning so an
    // invalid/disconnected session rejects `tail:start` instead of emitting
    // `tail:end` before the IPC reply arrives.
    SessionManager.getInstance().shell(sessionId)
    this.stop(tailId)
    const controller = new AbortController()
    this.tails.set(tailId, {
      controller,
      sessionId,
      remotePath,
      remotePid: null,
      reconnectTimer: null,
      lastStderr: null,
      ended: false
    })
    void this.follow(tailId, sanitizeHistoryLines(historyLines), 0)
  }

  /** Runs one `tail -F` attempt and reconnects on transient end. */
  private async follow(tailId: string, historyLines: number, attempt: number): Promise<void> {
    const entry = this.tails.get(tailId)
    if (!entry || entry.ended || entry.controller.signal.aborted) {
      return
    }
    let currentAttempt = attempt
    let readyEmitted = false
    let pidConsumed = false
    let sawLogLine = false
    const attemptStartMs = Date.now()
    let stderrBuf = ''
    const flushStderr = (final: boolean): void => {
      const parts = stderrBuf.split('\n')
      stderrBuf = final ? '' : (parts.pop() ?? '')
      for (const raw of parts) {
        const line = raw.replace(/\r$/, '').trim()
        if (line.length > 0) {
          entry.lastStderr = line
          this.broadcastNotice(tailId, line)
        }
      }
    }
    const markHealthy = (): void => {
      currentAttempt = 0
      if (!readyEmitted) {
        readyEmitted = true
        this.broadcastReady(tailId)
      }
    }
    try {
      const shell = SessionManager.getInstance().shell(entry.sessionId)
      const command = `printf '${PID_MARKER}%s\\n' $$; exec tail -n ${historyLines} -F -- ${shellEscape(entry.remotePath)}`
      const exitCode = await shell.execLines(command, {
        signal: entry.controller.signal,
        timeoutMs: null,
        onLine: (line) => {
          if (entry.ended || entry.controller.signal.aborted || this.tails.get(tailId) !== entry) {
            return
          }
          if (!pidConsumed) {
            pidConsumed = true
            if (line.startsWith(PID_MARKER)) {
              const pid = parseInt(line.slice(PID_MARKER.length).trim(), 10)
              if (!Number.isNaN(pid) && pid > 0) {
                entry.remotePid = pid
              }
              markHealthy()
              return
            }
          }
          sawLogLine = true
          markHealthy()
          this.broadcastLine(tailId, line)
        },
        onStderr: (chunk) => {
          if (entry.ended || entry.controller.signal.aborted || this.tails.get(tailId) !== entry) {
            return
          }
          stderrBuf += chunk
          flushStderr(false)
        }
      })
      if (entry.ended || entry.controller.signal.aborted || this.tails.get(tailId) !== entry) {
        return
      }
      flushStderr(true)
      if (exitCode !== null && exitCode !== 0) {
        this.finishEntry(tailId, entry, entry.lastStderr || `tail exited with code ${exitCode}`)
        return
      }
      entry.remotePid = null
      const nextAttempt = !sawLogLine && Date.now() - attemptStartMs < 5_000 ? attempt : currentAttempt
      await this.reconnect(tailId, historyLines, nextAttempt)
    } catch (e) {
      if (entry.ended || entry.controller.signal.aborted || this.tails.get(tailId) !== entry) {
        return
      }
      flushStderr(true)
      if (!isTransient(e)) {
        const msg = e instanceof Error ? e.message : String(e)
        this.finishEntry(tailId, entry, msg)
        return
      }
      entry.remotePid = null
      const nextAttempt = !sawLogLine && Date.now() - attemptStartMs < 5_000 ? attempt : currentAttempt
      await this.reconnect(tailId, historyLines, nextAttempt, e)
    }
  }

  private async reconnect(
    tailId: string,
    historyLines: number,
    attempt: number,
    lastError?: unknown
  ): Promise<void> {
    const entry = this.tails.get(tailId)
    if (!entry || entry.ended || entry.controller.signal.aborted) {
      return
    }
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      const msg =
        lastError instanceof Error
          ? lastError.message
          : lastError
            ? String(lastError)
            : entry.lastStderr || 'stream ended'
      this.finishEntry(tailId, entry, msg)
      return
    }
    const backoff = Math.min(2000 * Math.pow(2, attempt), 15_000)
    // Capture the entry reference (not just the tailId string) so the timer can detect
    // if it's stale by the time it fires. If `start(tailId, ...)` is called again on this
    // same tailId before the timer runs (e.g. the user closes and reopens the same tail
    // panel during a transient-drop retry), `start()` calls `stop(tailId)` then installs a
    // brand-new entry under the same key — without this check, `follow()` would re-fetch
    // the NEW entry (whose controller isn't aborted), pass the abort-check guard, and start
    // a second concurrent remote tail that `stop()` never learns about.
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null
      if (this.tails.get(tailId) !== entry || entry.ended || entry.controller.signal.aborted) {
        return
      }
      // Re-tail with 0 history lines so we don't replay the whole buffer.
      void this.follow(tailId, 0, attempt + 1)
    }, backoff)
  }

  /**
   * Stops a stream, kills its remote `tail`, and notifies the renderer.
   *
   * `entry.remotePid` may still be `null` here if `stop()` races ahead of the first
   * `PID_MARKER` output line (see {@link follow}) — in that case `killRemoteTail` is a
   * no-op. This is acceptable: `entry.controller.abort()` above triggers `execLines`'s
   * abort handling in RemoteShell, which destroys the underlying SSH exec channel/stream
   * immediately. Closing that channel ends the remote shell session sshd allocated for the
   * command, which sends SIGHUP to (and normally kills) the `tail` process descending from
   * it — so the remote process does not get orphaned even without an explicit `kill by PID`.
   */
  stop(tailId: string): void {
    const entry = this.tails.get(tailId)
    if (!entry) {
      return
    }
    entry.controller.abort()
    this.finishEntry(tailId, entry)
    this.killRemoteTail(entry)
  }

  /** Stops every tail bound to a session — called when that session closes. */
  stopAllForSession(sessionId: string): void {
    for (const [tailId, entry] of [...this.tails.entries()]) {
      if (entry.sessionId === sessionId) {
        this.stop(tailId)
      }
    }
  }

  /** Stops all active tail streams (e.g. on sidecar shutdown). */
  stopAll(): void {
    for (const tailId of [...this.tails.keys()]) {
      this.stop(tailId)
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

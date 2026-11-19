import { randomUUID } from 'crypto'
import { host } from '../host/host'
import { SshError } from '../ssh/errors'
import { EVENT_CHANNELS, type OperationEvent, type OperationKind } from '../../shared/contract'

/** Minimum gap between progress broadcasts for a single operation (matches TransferQueue's). */
const PROGRESS_THROTTLE_MS = 200

/** Metadata the caller supplies when registering an operation. */
export interface OperationMeta {
  kind: OperationKind
  /** Human label shown in the Activity dock, e.g. "Extracting report.zip". */
  label: string
  sessionId?: string
  cancellable: boolean
  requestId?: string
}

/** What `run()` hands the wrapped function. */
export interface OperationContext {
  signal: AbortSignal
  /** Throttled determinate-progress reporter; omit calls entirely for indeterminate ops. */
  reportProgress: (current: number, total?: number, unit?: 'bytes' | 'items') => void
}

interface OperationEntry {
  controller: AbortController
  meta: OperationMeta
  siteName?: string
  startedAt: number
  lastProgressEmit: number
}

/**
 * Registry of in-flight long-running operations (remote extract/compress,
 * local compress, recursive deletes, ...) — the generic counterpart of
 * TransferQueue's per-transfer events, feeding the renderer's Activity dock
 * tab via `operation:event`.
 *
 * Unlike TailManager there is no idle reaper: every operation wrapped by
 * `run()` has a bounded lifetime (the underlying execs all carry timeouts),
 * so entries always reach a terminal state and are removed there.
 *
 * Cancellation caveat: for remote exec-backed operations, aborting destroys
 * the SSH channel and stops *waiting* — the remote `unzip`/`zip` process may
 * still run to completion server-side. That matches what users get from
 * comparable clients; a true remote kill would need the TailManager-style PID
 * capture and a switch to execLines, deliberately out of scope for now.
 */
export class OperationRegistry {
  private static instance: OperationRegistry | null = null

  static getInstance(): OperationRegistry {
    if (!OperationRegistry.instance) {
      OperationRegistry.instance = new OperationRegistry()
    }
    return OperationRegistry.instance
  }

  private readonly operations = new Map<string, OperationEntry>()
  /** Additive side-channel for terminal (done/error/cancelled) events — currently just HistoryRecorder. Never allowed to affect an operation's own outcome (see `notifyTerminal`). */
  private readonly terminalListeners: Array<(evt: OperationEvent, siteName?: string) => void> = []
  private siteNameResolver: ((sessionId: string) => string | undefined) | null = null

  setSiteNameResolver(resolver: (sessionId: string) => string | undefined): void {
    this.siteNameResolver = resolver
  }

  /** Subscribes to every operation's terminal event (done/error/cancelled) — additive to the existing `webContents.send` broadcast, not a replacement for it. */
  onTerminalEvent(listener: (evt: OperationEvent, siteName?: string) => void): void {
    this.terminalListeners.push(listener)
  }

  private notifyTerminal(evt: OperationEvent, siteName?: string): void {
    for (const listener of this.terminalListeners) {
      try {
        listener(evt, siteName)
      } catch {
        // A listener's own failure (e.g. HistoryStore disk write) must never
        // surface as an operation failure — this channel is purely additive.
      }
    }
  }

  /**
   * Wraps a whole operation: broadcasts `started`, runs `fn` with the op's
   * AbortSignal and a throttled progress reporter, broadcasts
   * `done`/`error`/`cancelled`, removes the entry — and returns/rethrows
   * `fn`'s result so callers' IPC envelopes are unchanged.
   */
  async run<T>(
    meta: OperationMeta,
    fn: (ctx: OperationContext) => Promise<T>,
    summarize?: (result: T) => string
  ): Promise<T> {
    const operationId = randomUUID()
    const siteName = meta.sessionId ? this.siteNameResolver?.(meta.sessionId) : undefined
    const entry: OperationEntry = {
      controller: new AbortController(),
      meta,
      siteName,
      startedAt: Date.now(),
      lastProgressEmit: 0
    }
    this.operations.set(operationId, entry)
    this.broadcast(operationId, entry, { state: 'started' })

    const reportProgress = (current: number, total?: number, unit?: 'bytes' | 'items'): void => {
      if (this.operations.get(operationId) !== entry) {
        return
      }
      const now = Date.now()
      const isFinal = total !== undefined && current >= total
      if (now - entry.lastProgressEmit < PROGRESS_THROTTLE_MS && !isFinal) {
        return
      }
      entry.lastProgressEmit = now
      this.broadcast(operationId, entry, {
        state: 'progress',
        progressCurrent: current,
        progressTotal: total,
        progressUnit: unit
      })
    }

    try {
      const result = await fn({ signal: entry.controller.signal, reportProgress })
      const done: Partial<OperationEvent> = { state: 'done' }
      if (summarize) done.summary = summarize(result)
      this.notifyTerminal(this.broadcast(operationId, entry, done), entry.siteName)
      return result
    } catch (e) {
      const cancelled = (e instanceof SshError && e.code === 'CANCELLED') || entry.controller.signal.aborted
      const message = e instanceof Error ? e.message : String(e)
      const evt = this.broadcast(operationId, entry, {
        state: cancelled ? 'cancelled' : 'error',
        ...(!cancelled || summarize ? { error: message } : {})
      })
      this.notifyTerminal(evt, entry.siteName)
      throw e
    } finally {
      this.operations.delete(operationId)
    }
  }

  /** Aborts a running operation; unknown ids are a no-op. */
  cancel(operationId: string): void {
    this.operations.get(operationId)?.controller.abort()
  }

  /** Aborts every running operation tied to a session — hooked into SessionManager.close(). */
  cancelAllForSession(sessionId: string): void {
    for (const entry of this.operations.values()) {
      if (entry.meta.sessionId === sessionId) {
        entry.controller.abort()
      }
    }
  }

  private broadcast(operationId: string, entry: OperationEntry, partial: Partial<OperationEvent>): OperationEvent {
    const evt: OperationEvent = {
      operationId,
      kind: entry.meta.kind,
      state: 'started',
      label: entry.meta.label,
      sessionId: entry.meta.sessionId,
      startedAt: entry.startedAt,
      cancellable: entry.meta.cancellable,
      ...(entry.meta.requestId ? { requestId: entry.meta.requestId } : {}),
      ...partial
    }
    host().broadcast(EVENT_CHANNELS.operationEvent, evt)
    return evt
  }
}

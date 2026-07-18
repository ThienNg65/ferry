import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
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

  /**
   * Wraps a whole operation: broadcasts `started`, runs `fn` with the op's
   * AbortSignal and a throttled progress reporter, broadcasts
   * `done`/`error`/`cancelled`, removes the entry — and returns/rethrows
   * `fn`'s result so callers' IPC envelopes are unchanged.
   */
  async run<T>(meta: OperationMeta, fn: (ctx: OperationContext) => Promise<T>): Promise<T> {
    const operationId = randomUUID()
    const entry: OperationEntry = {
      controller: new AbortController(),
      meta,
      startedAt: Date.now(),
      lastProgressEmit: 0
    }
    this.operations.set(operationId, entry)
    this.broadcast(operationId, entry, { state: 'started' })

    const reportProgress = (current: number, total?: number, unit?: 'bytes' | 'items'): void => {
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
      this.broadcast(operationId, entry, { state: 'done' })
      return result
    } catch (e) {
      const cancelled = (e instanceof SshError && e.code === 'CANCELLED') || entry.controller.signal.aborted
      if (cancelled) {
        this.broadcast(operationId, entry, { state: 'cancelled' })
      } else {
        this.broadcast(operationId, entry, { state: 'error', error: e instanceof Error ? e.message : String(e) })
      }
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

  private broadcast(operationId: string, entry: OperationEntry, partial: Partial<OperationEvent>): void {
    const evt: OperationEvent = {
      operationId,
      kind: entry.meta.kind,
      state: 'started',
      label: entry.meta.label,
      sessionId: entry.meta.sessionId,
      startedAt: entry.startedAt,
      cancellable: entry.meta.cancellable,
      ...partial
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.operationEvent, evt)
      }
    }
  }
}

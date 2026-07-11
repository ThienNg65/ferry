import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import {
  EVENT_CHANNELS,
  type ActivityEntry,
  type ActivityKind,
  type ActivityLevel
} from '../../shared/contract'

/** Entries beyond this count are dropped from the ring buffer, oldest first. */
const RING_BUFFER_SIZE = 2000

/**
 * ActivityLog — in-process, purely local event bus for the app's own
 * connect/transfer/tail/unzip lifecycle. Never gated on remote I/O: emitting
 * is a synchronous, instant broadcast, even when the operation it describes
 * is slow or still in flight. This is what replaces WinSCP's non-tailing log
 * panel — it must always feel immediate.
 */
export class ActivityLog {
  private static instance: ActivityLog | null = null
  private readonly entries: ActivityEntry[] = []

  static getInstance(): ActivityLog {
    if (ActivityLog.instance === null) {
      ActivityLog.instance = new ActivityLog()
    }
    return ActivityLog.instance
  }

  /**
   * Records and broadcasts one activity entry.
   *
   * @param kind    - the lifecycle event kind
   * @param message - human-readable description
   * @param opts    - optional session scoping and severity level (defaults to 'info')
   */
  emit(
    kind: ActivityKind,
    message: string,
    opts: { sessionId?: string; level?: ActivityLevel } = {}
  ): void {
    const entry: ActivityEntry = {
      id: randomUUID(),
      kind,
      level: opts.level ?? 'info',
      sessionId: opts.sessionId,
      message,
      at: new Date().toISOString()
    }
    this.entries.push(entry)
    if (this.entries.length > RING_BUFFER_SIZE) {
      this.entries.shift()
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.activityEvent, entry)
      }
    }
  }

  /** Returns a snapshot of the current ring buffer, oldest first. */
  history(): ActivityEntry[] {
    return this.entries.slice()
  }
}

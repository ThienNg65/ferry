import Store from 'electron-store'
import { randomUUID } from 'crypto'
import type { HistoryEntry, HistoryQuery } from '../../shared/contract'

/** Ring-buffer cap — oldest entries are dropped once exceeded, so this file never grows unbounded for a heavy user. */
const MAX_HISTORY_ENTRIES = 2000

/**
 * How long to wait after the last `record()` call before actually writing to
 * disk. `electron-store`/`conf` writes synchronously (`fs.writeFileSync`) on
 * every `.set()` — without this debounce, a bulk sync enqueueing hundreds or
 * thousands of individual file transfers would trigger that many blocking
 * full-file rewrites on the main process in quick succession. Batching them
 * into one write per burst trades a small, bounded risk (entries recorded in
 * the last `FLUSH_DEBOUNCE_MS` before an ungraceful crash/kill are lost —
 * `flush()` covers the graceful-quit path) for materially better
 * responsiveness during exactly the workload most likely to generate a lot
 * of history at once.
 */
const FLUSH_DEBOUNCE_MS = 1000

interface StoreSchema {
  entries: HistoryEntry[]
}

/**
 * Persists completed transfers/operations to `history.json` under the OS
 * userData directory — populated automatically by HistoryRecorder, not
 * written to directly by IPC handlers.
 */
export class HistoryStore {
  private static instance: HistoryStore | null = null
  private _store: Store<StoreSchema> | null = null
  /** In-memory mirror — record()/list()/clear() all read/write this directly so they never observe a stale pre-flush disk state; only the disk write itself is debounced. */
  private _entries: HistoryEntry[] | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  private get store(): Store<StoreSchema> {
    if (!this._store) {
      this._store = new Store<StoreSchema>({ name: 'history', defaults: { entries: [] } })
    }
    return this._store
  }

  private get entries(): HistoryEntry[] {
    if (!this._entries) {
      this._entries = this.store.get('entries')
    }
    return this._entries
  }

  private set entries(val: HistoryEntry[]) {
    this._entries = val
  }

  static getInstance(): HistoryStore {
    if (HistoryStore.instance === null) {
      HistoryStore.instance = new HistoryStore()
    }
    return HistoryStore.instance
  }

  record(entry: Omit<HistoryEntry, 'id'>): void {
    this.entries.push({ ...entry, id: randomUUID() })
    // Drop oldest first — entries are appended in chronological order.
    if (this.entries.length > MAX_HISTORY_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_HISTORY_ENTRIES)
    }
    this.scheduleFlush()
  }

  list(query?: HistoryQuery): HistoryEntry[] {
    let entries = this.entries
    if (query?.status) {
      entries = entries.filter((e) => e.status === query.status)
    }
    if (query?.search) {
      const needle = query.search.toLowerCase()
      entries = entries.filter(
        (e) => e.label.toLowerCase().includes(needle) || e.siteName?.toLowerCase().includes(needle)
      )
    }
    // Newest first.
    entries = [...entries].sort((a, b) => b.finishedAt - a.finishedAt)
    return query?.limit ? entries.slice(0, query.limit) : entries
  }

  clear(): void {
    this.entries = []
    // Immediate, not debounced — a deliberate, rare user action, not a burst.
    this.flush()
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      if (this._entries !== null) {
        this.store.set('entries', this._entries)
      }
    }, FLUSH_DEBOUNCE_MS)
  }

  /** Forces any pending debounced write to disk immediately — call before app quit so a just-recorded burst isn't silently lost. */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this._entries !== null) {
      this.store.set('entries', this._entries)
    }
  }
}

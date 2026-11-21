import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry } from '../../shared/contract'

/**
 * `conf` is mocked here with a minimal in-memory implementation mirroring the
 * two methods `HistoryStore.ts` actually uses (`get`/`set`), keyed by the
 * `configName` option so a fresh `new HistoryStore()` reads back whatever a
 * previous instance flushed without touching disk.
 */
const disks = new Map<string, Record<string, unknown>>()

vi.mock('conf', () => {
  class FakeConf {
    private readonly name: string
    constructor(opts: { configName: string; defaults: Record<string, unknown> }) {
      this.name = opts.configName
      if (!disks.has(this.name)) {
        disks.set(this.name, { ...opts.defaults })
      }
    }
    get(key: string): unknown {
      // Deep-clone on read, mirroring real conf's read-from-disk
      // semantics: a fresh instance's in-memory entries must not be the same
      // object reference as the shared "disk", or mutating them (as
      // HistoryStore.record() does, via its `entries` array) would silently
      // write through before the debounced `.set()` ever runs.
      return JSON.parse(JSON.stringify(disks.get(this.name)![key]))
    }
    set(key: string, value: unknown): void {
      disks.get(this.name)![key] = JSON.parse(JSON.stringify(value))
    }
  }
  return { default: FakeConf }
})

const { HistoryStore } = await import('./HistoryStore')

function entry(overrides: Partial<Omit<HistoryEntry, 'id'>> = {}): Omit<HistoryEntry, 'id'> {
  return {
    kind: 'transfer',
    label: 'Upload file.txt',
    direction: 'upload',
    sessionId: 's1',
    siteName: 'Test Site',
    bytes: 100,
    startedAt: 1000,
    finishedAt: 2000,
    status: 'done',
    ...overrides
  }
}

describe('HistoryStore', () => {
  beforeEach(() => {
    disks.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts empty', () => {
    expect(new HistoryStore().list()).toEqual([])
  })

  it('records an entry with a generated id, retrievable via list()', () => {
    const store = new HistoryStore()
    store.record(entry({ label: 'Upload a.txt' }))

    const list = store.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toEqual(expect.any(String))
    expect(list[0].label).toBe('Upload a.txt')
  })

  it('lists newest-first regardless of insertion order', () => {
    const store = new HistoryStore()
    store.record(entry({ label: 'older', finishedAt: 1000 }))
    store.record(entry({ label: 'newer', finishedAt: 5000 }))
    store.record(entry({ label: 'middle', finishedAt: 3000 }))

    expect(store.list().map((e) => e.label)).toEqual(['newer', 'middle', 'older'])
  })

  it('filters by status', () => {
    const store = new HistoryStore()
    store.record(entry({ label: 'ok', status: 'done' }))
    store.record(entry({ label: 'failed', status: 'error' }))

    expect(store.list({ status: 'error' }).map((e) => e.label)).toEqual(['failed'])
  })

  it('filters by case-insensitive search across label and siteName', () => {
    const store = new HistoryStore()
    store.record(entry({ label: 'Upload report.pdf', siteName: 'Prod' }))
    store.record(entry({ label: 'Download logs.txt', siteName: 'Staging' }))

    expect(store.list({ search: 'REPORT' }).map((e) => e.label)).toEqual(['Upload report.pdf'])
    expect(store.list({ search: 'staging' }).map((e) => e.label)).toEqual(['Download logs.txt'])
  })

  it('respects a limit after sorting newest-first', () => {
    const store = new HistoryStore()
    store.record(entry({ label: 'a', finishedAt: 1000 }))
    store.record(entry({ label: 'b', finishedAt: 2000 }))
    store.record(entry({ label: 'c', finishedAt: 3000 }))

    expect(store.list({ limit: 2 }).map((e) => e.label)).toEqual(['c', 'b'])
  })

  it('drops the oldest entries once the ring-buffer cap is exceeded', () => {
    const store = new HistoryStore()
    const MAX = 2000
    for (let i = 0; i < MAX + 5; i++) {
      store.record(entry({ label: `entry-${i}`, finishedAt: i }))
    }
    const all = store.list()
    expect(all).toHaveLength(MAX)
    // The 5 oldest (entry-0..entry-4) should have been dropped.
    expect(all.some((e) => e.label === 'entry-0')).toBe(false)
    expect(all.some((e) => e.label === `entry-${MAX + 4}`)).toBe(true)
  })

  it('clear() empties the store immediately, without needing the debounce timer to fire', () => {
    const store = new HistoryStore()
    store.record(entry())
    expect(store.list()).toHaveLength(1)

    store.clear()
    expect(store.list()).toHaveLength(0)

    // Confirms clear() flushed synchronously rather than relying on the debounce timer.
    const reloaded = new HistoryStore()
    expect(reloaded.list()).toHaveLength(0)
  })

  it('debounces disk writes: a fresh instance does not see a just-recorded entry until the flush timer fires', () => {
    const store = new HistoryStore()
    store.record(entry({ label: 'pending write' }))

    // Before the debounce timer fires, a brand-new instance reads directly from the
    // underlying store and should not observe the in-memory-only entry yet.
    expect(new HistoryStore().list()).toHaveLength(0)

    vi.runAllTimers()

    expect(new HistoryStore().list().map((e) => e.label)).toEqual(['pending write'])
  })

  it('flush() forces the pending debounced write to the underlying store immediately', () => {
    const store = new HistoryStore()
    store.record(entry({ label: 'urgent' }))
    store.flush()

    expect(new HistoryStore().list().map((e) => e.label)).toEqual(['urgent'])
  })

  it('pruneExpired() drops entries older than retentionDays and keeps unlimited when null', () => {
    const dayMs = 86_400_000
    const now = 100 * dayMs
    const store = new HistoryStore()
    store.record(entry({ label: 'old', finishedAt: now - 40 * dayMs }))
    store.record(entry({ label: 'recent', finishedAt: now - 5 * dayMs }))

    expect(store.pruneExpired(null, now)).toBe(0)
    expect(store.list()).toHaveLength(2)

    expect(store.pruneExpired(30, now)).toBe(1)
    expect(store.list().map((e) => e.label)).toEqual(['recent'])
  })
})

import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { DeleteManyResult, FileEntry, FileListResult } from '@shared/contract'
import { invoke } from '../api'
import { useSessionsStore } from './sessions.store'
import { compareEntries, type SortColumn, type SortDirection } from '../utils/fileSort'
import { selectAll, selectOnly, selectRange, toggleSelect } from '../utils/fileSelection'

const CACHE_TTL_MS = 60_000
const MAX_CACHE_ENTRIES = 100

/** In-flight prefetch deduplication tracker across sessions. */
const inFlightPrefetches = new Set<string>()

export interface DirCacheEntry {
  path: string
  entries: FileEntry[]
  timestamp: number
}

function setCache(
  bucket: PerSessionFs,
  canonicalPath: string,
  entries: FileEntry[],
  aliasPath?: string
): void {
  if (bucket.dirCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = bucket.dirCache.keys().next().value
    if (oldestKey) bucket.dirCache.delete(oldestKey)
  }
  const cacheEntry: DirCacheEntry = {
    path: canonicalPath,
    entries: [...entries],
    timestamp: Date.now()
  }
  const canonicalKey = normalizeDirPath(canonicalPath)
  bucket.dirCache.set(canonicalKey, cacheEntry)
  if (aliasPath) {
    const aliasKey = normalizeDirPath(aliasPath)
    if (aliasKey && aliasKey !== canonicalKey) {
      bucket.dirCache.set(aliasKey, cacheEntry)
    }
  }
}

/** Remote directory-browsing state for a single session. */
interface PerSessionFs {
  currentPath: string
  entries: FileEntry[]
  loading: boolean
  error: string | null
  selected: Set<string>
  selectAnchor: string | null
  sortColumn: SortColumn
  sortDirection: SortDirection
  dirCache: Map<string, DirCacheEntry>
}

function freshFsState(): PerSessionFs {
  return {
    currentPath: '',
    entries: [],
    loading: false,
    error: null,
    selected: new Set(),
    selectAnchor: null,
    sortColumn: 'name',
    sortDirection: 'asc',
    dirCache: new Map()
  }
}

/** Read-only fallback for "no session (yet)" — never written into `bySession`. */
const EMPTY_DEFAULT: PerSessionFs = Object.freeze(freshFsState())

interface RemoteFsState {
  bySession: Record<string, PerSessionFs>
  /** Per-session request-sequencing token — bumped on every `loadForSession` call so a slower, superseded response can detect it's stale and skip applying its result. */
  requestSeq: Record<string, number>
}

function normalizeDirPath(dirPath: string): string {
  if (!dirPath || dirPath === '.') return ''
  const trimmed = dirPath.replace(/\/+$/, '')
  return trimmed.length === 0 ? '/' : trimmed
}

/**
 * Remote directory-browsing state, keyed by sessionId so each open site tab
 * keeps its own independent path/listing/selection — but exposes the exact
 * same flat `currentPath`/`entries`/`loading`/`error`/`selected` surface as
 * before so `FilePane.vue` needs no template changes.
 */
export const useRemoteFsStore = defineStore('remoteFs', {
  state: (): RemoteFsState => ({ bySession: {}, requestSeq: {} }),

  getters: {
    current(state): PerSessionFs {
      const sessionId = useSessionsStore().activeSessionId
      return (sessionId && state.bySession[sessionId]) || EMPTY_DEFAULT
    },
    currentPath(): string {
      return this.current.currentPath
    },
    entries(): FileEntry[] {
      return this.current.entries
    },
    loading(): boolean {
      return this.current.loading
    },
    error(): string | null {
      return this.current.error
    },
    selected(): Set<string> {
      return this.current.selected
    },
    sortColumn(): SortColumn {
      return this.current.sortColumn
    },
    sortDirection(): SortDirection {
      return this.current.sortDirection
    },
    /** True when `sessionId` has never been listed yet (no cached bucket). */
    needsLoad(state): (sessionId: string) => boolean {
      return (sessionId: string) => !state.bySession[sessionId]
    }
  },

  actions: {
    activeSessionId(): string {
      const sessionId = useSessionsStore().activeSessionId
      if (!sessionId) {
        throw new Error('No active session')
      }
      return sessionId
    },

    ensureBucket(sessionId: string): PerSessionFs {
      if (!this.bySession[sessionId]) {
        this.bySession[sessionId] = freshFsState()
      }
      return this.bySession[sessionId]
    },

    async load(dirPath?: string, options?: { forceRefresh?: boolean }): Promise<void> {
      await this.loadForSession(this.activeSessionId(), dirPath, options)
    },

    /**
     * Loads `sessionId`'s directory listing, independent of whichever tab is
     * currently active. Uses SWR (Stale-While-Revalidate) in-memory caching to
     * render previously visited directories with 0ms perceptible delay.
     */
    async loadForSession(
      sessionId: string,
      dirPath?: string,
      options?: { forceRefresh?: boolean }
    ): Promise<void> {
      const entry = this.ensureBucket(sessionId)
      const normalized = dirPath ? normalizeDirPath(dirPath) : ''
      const cached = normalized ? entry.dirCache.get(normalized) : undefined
      const isCacheValid = cached && Date.now() - cached.timestamp < CACHE_TTL_MS && !options?.forceRefresh

      const seq = (this.requestSeq[sessionId] ?? 0) + 1
      this.requestSeq[sessionId] = seq

      if (isCacheValid) {
        // Fast-path: instantly display cached entries (0ms)
        entry.currentPath = cached.path
        entry.entries = [...cached.entries].sort(compareEntries(entry.sortColumn, entry.sortDirection))
        entry.selected = new Set()
        entry.selectAnchor = null
        entry.loading = false
        entry.error = null

        // Silently revalidate in background without blocking
        void (async () => {
          try {
            const result = await invoke<FileListResult>(INVOKE_CHANNELS.fsRemoteList, sessionId, dirPath, false)
            if (this.requestSeq[sessionId] === seq && this.bySession[sessionId] && result?.path) {
              setCache(entry, result.path, result.entries, dirPath)
              if (entry.currentPath === result.path) {
                entry.entries = result.entries.sort(compareEntries(entry.sortColumn, entry.sortDirection))
              }
            }
          } catch {
            // Background revalidation failure does not disturb current display
          }
        })()
        return
      }

      const previousPath = entry.currentPath
      const previousEntries = entry.entries
      const previousSelected = entry.selected
      const previousAnchor = entry.selectAnchor

      if (normalized) {
        // Optimistic navigation: update current path immediately for instant breadcrumb feedback
        entry.currentPath = normalized
        entry.entries = []
        entry.loading = true
        entry.error = null
        entry.selected = new Set()
        entry.selectAnchor = null
      } else {
        entry.loading = true
        entry.error = null
      }

      try {
        const result = await invoke<FileListResult>(INVOKE_CHANNELS.fsRemoteList, sessionId, dirPath, false)
        if (this.requestSeq[sessionId] !== seq || !this.bySession[sessionId]) {
          return
        }

        // Store into in-memory SWR cache (both canonical and requested paths)
        setCache(entry, result.path, result.entries, dirPath)

        entry.currentPath = result.path
        entry.entries = result.entries.sort(compareEntries(entry.sortColumn, entry.sortDirection))
        entry.selected = new Set()
        entry.selectAnchor = null
      } catch (e) {
        if (this.requestSeq[sessionId] !== seq || !this.bySession[sessionId]) {
          return
        }
        // Rollback optimistic navigation on failure
        entry.currentPath = previousPath
        entry.entries = previousEntries
        entry.selected = previousSelected
        entry.selectAnchor = previousAnchor
        entry.error = e instanceof Error ? e.message : String(e)
      } finally {
        if (this.requestSeq[sessionId] === seq && this.bySession[sessionId]) {
          entry.loading = false
        }
      }
    },

    /**
     * Prefetches a directory listing in the background quietly without changing current view or CWD.
     */
    async prefetchDir(dirPath: string): Promise<void> {
      const sessionId = useSessionsStore().activeSessionId
      if (!sessionId) return
      const entry = this.ensureBucket(sessionId)
      const normalized = normalizeDirPath(dirPath)
      const cached = entry.dirCache.get(normalized)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return
      }

      const prefetchKey = `${sessionId}:${normalized}`
      if (inFlightPrefetches.has(prefetchKey)) return
      inFlightPrefetches.add(prefetchKey)

      try {
        const result = await invoke<FileListResult>(INVOKE_CHANNELS.fsRemoteList, sessionId, dirPath, true)
        if (this.bySession[sessionId] && result?.path) {
          setCache(entry, result.path, result.entries, dirPath)
        }
      } catch {
        // Prefetch failures are non-critical
      } finally {
        inFlightPrefetches.delete(prefetchKey)
      }
    },

    /** Clicking the active column flips its direction; clicking a new column selects it ascending. */
    setSort(column: SortColumn): void {
      const sessionId = this.activeSessionId()
      const entry = this.ensureBucket(sessionId)
      if (entry.sortColumn === column) {
        entry.sortDirection = entry.sortDirection === 'asc' ? 'desc' : 'asc'
      } else {
        entry.sortColumn = column
        entry.sortDirection = 'asc'
      }
      entry.entries = [...entry.entries].sort(compareEntries(entry.sortColumn, entry.sortDirection))
    },

    async openDir(dirPath: string): Promise<void> {
      await this.load(dirPath)
    },

    async goUp(): Promise<void> {
      const parent = this.currentPath.replace(/\/[^/]+\/?$/, '') || '/'
      await this.load(parent)
    },

    async mkdir(name: string): Promise<void> {
      const sessionId = this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      const target = `${this.currentPath.replace(/\/$/, '')}/${name}`
      await invoke<void>(INVOKE_CHANNELS.fsRemoteMkdir, sessionId, target)
      bucket.dirCache.delete(normalizeDirPath(this.currentPath))
      await this.load(this.currentPath, { forceRefresh: true })
    },

    /** Deletes `entry` and drops it from the in-memory listing directly — no full directory reload. */
    async remove(entry: FileEntry): Promise<void> {
      const sessionId = this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      await invoke<void>(INVOKE_CHANNELS.fsRemoteDelete, sessionId, entry.path)
      bucket.entries = bucket.entries.filter((e) => e.path !== entry.path)
      bucket.selected.delete(entry.path)
      bucket.dirCache.delete(normalizeDirPath(this.currentPath))
    },

    /**
     * Deletes every entry in `entries` as ONE main-side batch operation (a
     * single Activity row with item-count progress), then patches the listing
     * once — entries that fail to delete stay in the listing.
     */
    async removeMany(entries: FileEntry[]): Promise<void> {
      const sessionId = this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      const result = await invoke<DeleteManyResult>(INVOKE_CHANNELS.fsRemoteDeleteMany, {
        sessionId,
        paths: entries.map((e) => e.path)
      })
      const removedPaths = new Set(result.deletedPaths)
      bucket.entries = bucket.entries.filter((e) => !removedPaths.has(e.path))
      for (const path of removedPaths) {
        bucket.selected.delete(path)
      }
      bucket.dirCache.delete(normalizeDirPath(this.currentPath))
      if (result.failures.length > 0) {
        const failedNames = result.failures.map(
          (f) => entries.find((e) => e.path === f.path)?.name ?? f.path
        )
        throw new Error(`Failed to delete: ${failedNames.join(', ')}`)
      }
    },

    /** Renames `entry` in place, within its current parent directory. */
    async rename(entry: FileEntry, newName: string): Promise<void> {
      const sessionId = this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      const parent = entry.path.slice(0, entry.path.length - entry.name.length)
      const newPath = `${parent}${newName}`
      await invoke<void>(INVOKE_CHANNELS.fsRemoteRename, sessionId, entry.path, newPath)
      bucket.dirCache.delete(normalizeDirPath(this.currentPath))
      const target = bucket.entries.find((e) => e.path === entry.path)
      if (target) {
        target.name = newName
        target.path = newPath
        bucket.entries = [...bucket.entries].sort(compareEntries(bucket.sortColumn, bucket.sortDirection))
      }
    },

    /** Sets `entry`'s permissions. `mode` is an octal string (e.g. "0755"). */
    async chmod(entry: FileEntry, mode: string): Promise<void> {
      const sessionId = this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      await invoke<void>(INVOKE_CHANNELS.fsRemoteChmod, sessionId, entry.path, mode)
      bucket.dirCache.delete(normalizeDirPath(this.currentPath))
      const target = bucket.entries.find((e) => e.path === entry.path)
      if (target) {
        target.permissions = mode.length === 3 ? `0${mode}` : mode
      }
    },

    /** Plain click — selects exactly one entry. */
    selectOnly(path: string): void {
      const bucket = this.ensureBucket(this.activeSessionId())
      const result = selectOnly(path)
      bucket.selected = result.selected
      bucket.selectAnchor = result.anchor
    },

    /** Ctrl/Cmd+click — adds or removes one entry from the existing selection. */
    toggleSelect(path: string): void {
      const bucket = this.ensureBucket(this.activeSessionId())
      const result = toggleSelect(bucket.selected, path)
      bucket.selected = result.selected
      bucket.selectAnchor = result.anchor
    },

    /** Shift+click — selects every entry between the last-clicked row and `path`. */
    selectRange(path: string): void {
      const bucket = this.ensureBucket(this.activeSessionId())
      const result = selectRange(bucket.entries, bucket.selectAnchor, path)
      bucket.selected = result.selected
      bucket.selectAnchor = result.anchor
    },

    /** Ctrl/Cmd+A — selects every entry in `entries` (defaults to the full unfiltered listing). */
    selectAll(entries?: FileEntry[]): void {
      const bucket = this.ensureBucket(this.activeSessionId())
      const result = selectAll(entries ?? bucket.entries)
      bucket.selected = result.selected
      bucket.selectAnchor = result.anchor
    },

    /** Sets the error for the active session's bucket — used by call sites that can't route through `load()`'s own catch (e.g. extract failures). */
    setError(message: string | null): void {
      const sessionId = this.activeSessionId()
      const entry = this.ensureBucket(sessionId)
      entry.error = message
    },

    /** Drops a session's bucket entirely — called when its tab closes/disconnects. */
    clearSession(sessionId: string): void {
      delete this.bySession[sessionId]
      delete this.requestSeq[sessionId]
    }
  }
})

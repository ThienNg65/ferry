import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { DeleteManyResult, FileEntry, FileListResult } from '@shared/contract'
import { invoke } from '../api'
import { useSessionsStore } from './sessions.store'
import { compareEntries, type SortColumn, type SortDirection } from '../utils/fileSort'
import { selectAll, selectOnly, selectRange, toggleSelect } from '../utils/fileSelection'
import { emptyHistory, recordVisit, stepBack, stepForward, type NavHistory } from '../utils/navHistory'

const CACHE_TTL_MS = 60_000
const MAX_CACHE_ENTRIES = 100
const MAX_CONCURRENT_PREFETCHES = 3

/** In-flight prefetch deduplication tracker across sessions. */
const inFlightPrefetches = new Set<string>()

/** Coalesces duplicate concurrent loads for the same active `(sessionId, path)`. */
const inFlightLoads = new Map<string, { seq: number; promise: Promise<void> }>()

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
  failedPath: string | null
  selected: Set<string>
  selectAnchor: string | null
  sortColumn: SortColumn
  sortDirection: SortDirection
  dirCache: Map<string, DirCacheEntry>
  history: NavHistory
  pendingRefreshPath: string | null
}

function freshFsState(): PerSessionFs {
  return {
    currentPath: '',
    entries: [],
    loading: false,
    error: null,
    failedPath: null,
    selected: new Set(),
    selectAnchor: null,
    sortColumn: 'name',
    sortDirection: 'asc',
    dirCache: new Map(),
    history: emptyHistory(),
    pendingRefreshPath: null
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
    failedPath(): string | null {
      return this.current.failedPath
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
    canGoBack(): boolean {
      return this.current.history.back.length > 0
    },
    canGoForward(): boolean {
      return this.current.history.fwd.length > 0
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

    async load(dirPath?: string, options?: { forceRefresh?: boolean; skipHistory?: boolean }): Promise<boolean> {
      return this.loadForSession(this.activeSessionId(), dirPath, options)
    },

    /**
     * Loads `sessionId`'s directory listing, independent of whichever tab is
     * currently active. Uses SWR (Stale-While-Revalidate) in-memory caching to
     * render previously visited directories with 0ms perceptible delay.
     */
    async loadForSession(
      sessionId: string,
      dirPath?: string,
      options?: { forceRefresh?: boolean; skipHistory?: boolean }
    ): Promise<boolean> {
      const entry = this.ensureBucket(sessionId)
      const fromPath = entry.currentPath
      const recordFrom = (newPath: string): void => {
        if (dirPath !== undefined && !options?.skipHistory && fromPath && newPath !== fromPath) {
          entry.history = recordVisit(entry.history, fromPath)
        }
      }
      const target = dirPath ?? (fromPath || undefined)
      const normalized = target ? normalizeDirPath(target) : ''
      const cached = normalized ? entry.dirCache.get(normalized) : undefined
      const isCacheValid = cached && Date.now() - cached.timestamp < CACHE_TTL_MS && !options?.forceRefresh

      const loadKey = `${sessionId}:${normalized || '.'}`
      const existingLoad = !isCacheValid && !options?.forceRefresh ? inFlightLoads.get(loadKey) : undefined
      if (existingLoad && existingLoad.seq === (this.requestSeq[sessionId] ?? 0)) {
        return existingLoad.promise.then(() => this.requestSeq[sessionId] === existingLoad.seq && !entry.error)
      }

      const seq = (this.requestSeq[sessionId] ?? 0) + 1
      this.requestSeq[sessionId] = seq
      entry.failedPath = null

      if (isCacheValid) {
        // Fast-path: instantly display cached entries (0ms)
        recordFrom(cached.path)
        entry.currentPath = cached.path
        entry.entries = [...cached.entries].sort(compareEntries(entry.sortColumn, entry.sortDirection))
        entry.selected = new Set()
        entry.selectAnchor = null
        entry.loading = false
        entry.error = null

        // Silently revalidate in background without blocking
        void (async () => {
          try {
            const result = await invoke<FileListResult>(INVOKE_CHANNELS.fsRemoteList, sessionId, target, false)
            if (this.requestSeq[sessionId] === seq && this.bySession[sessionId] === entry && result?.path) {
              setCache(entry, result.path, result.entries, dirPath)
              if (entry.currentPath === result.path) {
                entry.entries = result.entries.sort(compareEntries(entry.sortColumn, entry.sortDirection))
              }
            }
          } catch {
            // Background revalidation failure does not disturb current display
          }
        })()
        return true
      }

      // Keep the last successful listing and breadcrumb while the new path loads.
      entry.loading = true
      entry.error = null

      let committed = false
      const run = (async () => {
        try {
          const result = await invoke<FileListResult>(INVOKE_CHANNELS.fsRemoteList, sessionId, target, false)
          if (this.requestSeq[sessionId] !== seq || this.bySession[sessionId] !== entry) {
            return
          }

          // Store into in-memory SWR cache (both canonical and requested paths)
          setCache(entry, result.path, result.entries, dirPath)

          recordFrom(result.path)
          entry.currentPath = result.path
          entry.entries = result.entries.sort(compareEntries(entry.sortColumn, entry.sortDirection))
          entry.selected = new Set()
          entry.selectAnchor = null
          committed = true
        } catch (e) {
          if (this.requestSeq[sessionId] !== seq || this.bySession[sessionId] !== entry) {
            return
          }
          entry.failedPath = target ?? ''
          entry.error = e instanceof Error ? e.message : String(e)
        } finally {
          const currentInFlight = inFlightLoads.get(loadKey)
          if (currentInFlight?.seq === seq) {
            inFlightLoads.delete(loadKey)
          }
          if (this.requestSeq[sessionId] === seq && this.bySession[sessionId] === entry) {
            entry.loading = false
            const pendingRefreshPath = entry.pendingRefreshPath
            entry.pendingRefreshPath = null
            if (pendingRefreshPath && normalizeDirPath(entry.currentPath) === pendingRefreshPath) {
              await this.refreshSessionIfViewing(sessionId, pendingRefreshPath)
            }
          }
        }
      })()

      inFlightLoads.set(loadKey, { seq, promise: run })
      await run
      return committed
    },

    async retryDirectory(): Promise<void> {
      const sessionId = this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      await this.loadForSession(sessionId, bucket.failedPath ?? bucket.currentPath, { forceRefresh: true })
    },

    /** Invalidates SWR cache for `targetDir` and quietly refreshes the listing if `sessionId` is currently viewing it, preserving selection and scroll. */
    async refreshSessionIfViewing(sessionId: string, targetDir: string): Promise<void> {
      const entry = this.bySession[sessionId]
      if (!entry) return
      const normalizedTarget = normalizeDirPath(targetDir)
      if (!normalizedTarget) return

      entry.dirCache.delete(normalizedTarget)
      if (normalizeDirPath(entry.currentPath) !== normalizedTarget) {
        return
      }
      if (entry.loading) {
        entry.pendingRefreshPath = normalizedTarget
        return
      }

      const seqAtStart = this.requestSeq[sessionId] ?? 0
      const pathAtStart = entry.currentPath
      try {
        const result = await invoke<FileListResult>(INVOKE_CHANNELS.fsRemoteList, sessionId, pathAtStart, true)
        const currentBucket = this.bySession[sessionId]
        if (!currentBucket || (this.requestSeq[sessionId] ?? 0) !== seqAtStart || currentBucket.currentPath !== pathAtStart) {
          return
        }
        setCache(currentBucket, result.path, result.entries, pathAtStart)
        currentBucket.entries = result.entries.sort(compareEntries(currentBucket.sortColumn, currentBucket.sortDirection))
        const existingPaths = new Set(currentBucket.entries.map((e) => e.path))
        const nextSelected = new Set<string>()
        for (const p of currentBucket.selected) {
          if (existingPaths.has(p)) nextSelected.add(p)
        }
        currentBucket.selected = nextSelected
        if (currentBucket.selectAnchor && !existingPaths.has(currentBucket.selectAnchor)) {
          currentBucket.selectAnchor = null
        }
      } catch {
        // Ignore transient background refresh errors so active work is uninterrupted
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
      if (inFlightPrefetches.has(prefetchKey) || inFlightPrefetches.size >= MAX_CONCURRENT_PREFETCHES) return
      inFlightPrefetches.add(prefetchKey)

      try {
        const result = await invoke<FileListResult>(INVOKE_CHANNELS.fsRemoteList, sessionId, dirPath, true)
        if (this.bySession[sessionId] === entry && result?.path) {
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

    async goBack(): Promise<void> {
      const sessionId = this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      const step = stepBack(bucket.history, bucket.currentPath)
      if (!step) return
      const committed = await this.loadForSession(sessionId, step.target, { skipHistory: true })
      if (committed && this.bySession[sessionId] === bucket) bucket.history = step.next
    },

    async goForward(): Promise<void> {
      const sessionId = this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      const step = stepForward(bucket.history, bucket.currentPath)
      if (!step) return
      const committed = await this.loadForSession(sessionId, step.target, { skipHistory: true })
      if (committed && this.bySession[sessionId] === bucket) bucket.history = step.next
    },

    async goUp(): Promise<void> {
      const parent = this.currentPath.replace(/\/[^/]+\/?$/, '') || '/'
      await this.load(parent)
    },

    async mkdir(name: string): Promise<void> {
      const sessionId = this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      const dirPath = bucket.currentPath
      const target = `${dirPath.replace(/\/$/, '')}/${name}`
      await invoke<void>(INVOKE_CHANNELS.fsRemoteMkdir, sessionId, target)
      bucket.dirCache.delete(normalizeDirPath(dirPath))
      if (this.bySession[sessionId] === bucket && bucket.currentPath === dirPath) {
        await this.loadForSession(sessionId, dirPath, { forceRefresh: true })
      }
    },

    async touch(name: string): Promise<void> {
      const sessionId = this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      const dirPath = bucket.currentPath
      const target = `${dirPath.replace(/\/$/, '')}/${name}`
      await invoke<void>(INVOKE_CHANNELS.fsRemoteTouch, sessionId, target)
      bucket.dirCache.delete(normalizeDirPath(dirPath))
      if (this.bySession[sessionId] === bucket && bucket.currentPath === dirPath) {
        await this.loadForSession(sessionId, dirPath, { forceRefresh: true })
      }
    },

    /** Deletes `entry` and drops it from the in-memory listing directly — no full directory reload. */
    async remove(entry: FileEntry, confirmedSessionId?: string): Promise<void> {
      const sessionId = confirmedSessionId ?? this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      await invoke<void>(INVOKE_CHANNELS.fsRemoteDelete, sessionId, entry.path)
      bucket.entries = bucket.entries.filter((e) => e.path !== entry.path)
      bucket.selected.delete(entry.path)
      bucket.dirCache.clear()
    },

    /**
     * Deletes every entry in `entries` as ONE main-side batch operation (a
     * single Activity row with item-count progress), then patches the listing
     * once — entries that fail to delete stay in the listing.
     */
    async removeMany(entries: FileEntry[], confirmedSessionId?: string): Promise<void> {
      const sessionId = confirmedSessionId ?? this.activeSessionId()
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
      bucket.dirCache.clear()
      if (result.failures.length > 0) {
        const failedNames = result.failures.map(
          (f) => entries.find((e) => e.path === f.path)?.name ?? f.path
        )
        throw new Error(`Failed to delete: ${failedNames.join(', ')}`)
      }
    },

    /** Renames `entry` in place, within its current parent directory. */
    async rename(entry: FileEntry, newName: string, replace: boolean, sessionId: string): Promise<void> {
      const bucket = this.ensureBucket(sessionId)
      const parent = entry.path.slice(0, entry.path.length - entry.name.length)
      const newPath = `${parent}${newName}`
      await invoke<void>(INVOKE_CHANNELS.fsRemoteRename, sessionId, entry.path, newPath, replace)
      bucket.dirCache.clear()
      const target = bucket.entries.find((e) => e.path === entry.path)
      if (target) {
        bucket.entries = bucket.entries.filter((e) => e.path !== newPath && e.path !== entry.path)
        bucket.entries.push({ ...target, name: newName, path: newPath })
        if (bucket.selected.has(entry.path)) {
          bucket.selected.delete(entry.path)
          bucket.selected.add(newPath)
        }
        if (bucket.selectAnchor === entry.path) {
          bucket.selectAnchor = newPath
        }
        bucket.entries = [...bucket.entries].sort(compareEntries(bucket.sortColumn, bucket.sortDirection))
      }
    },

    /** Sets `entry`'s permissions. `mode` is an octal string (e.g. "0755"). */
    async chmod(entry: FileEntry, mode: string): Promise<void> {
      const sessionId = this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      const dirPath = bucket.currentPath
      await invoke<void>(INVOKE_CHANNELS.fsRemoteChmod, sessionId, entry.path, mode)
      bucket.dirCache.delete(normalizeDirPath(dirPath))
      const target = bucket.entries.find((e) => e.path === entry.path)
      if (target) {
        target.permissions = mode.length === 3 ? `0${mode}` : mode
      }
    },

    async admin(entry: FileEntry, options: { mode?: string; owner?: string; group?: string; recursive?: boolean }): Promise<void> {
      const sessionId = this.activeSessionId()
      const bucket = this.ensureBucket(sessionId)
      const dirPath = bucket.currentPath
      await invoke<void>(INVOKE_CHANNELS.fsRemoteAdmin, { sessionId, path: entry.path, ...options })
      bucket.dirCache.delete(normalizeDirPath(dirPath))
      if (this.bySession[sessionId] === bucket && bucket.currentPath === dirPath) {
        await this.loadForSession(sessionId, dirPath, { forceRefresh: true })
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
    selectRange(path: string, visibleEntries?: FileEntry[]): void {
      const bucket = this.ensureBucket(this.activeSessionId())
      const result = selectRange(visibleEntries ?? bucket.entries, bucket.selectAnchor, path)
      bucket.selected = result.selected
      bucket.selectAnchor = result.anchor
    },

    /** Ctrl/Cmd+A — selects every entry in `entries` (defaults to the full unfiltered listing). */
    selectPaths(paths: string[]): void {
      const bucket = this.ensureBucket(this.activeSessionId())
      bucket.selected = new Set(paths)
      bucket.selectAnchor = paths[0] ?? null
    },

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
      entry.failedPath = null
    },

    /** Drops a session's bucket entirely — called when its tab closes/disconnects. */
    clearSession(sessionId: string): void {
      delete this.bySession[sessionId]
      delete this.requestSeq[sessionId]
      const prefix = `${sessionId}:`
      for (const key of inFlightLoads.keys()) {
        if (key.startsWith(prefix)) {
          inFlightLoads.delete(key)
        }
      }
      for (const key of inFlightPrefetches) {
        if (key.startsWith(prefix)) {
          inFlightPrefetches.delete(key)
        }
      }
    }
  }
})

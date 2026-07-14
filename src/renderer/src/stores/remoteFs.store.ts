import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { FileEntry, FileListResult } from '@shared/contract'
import { invoke } from '../api'
import { useSessionsStore } from './sessions.store'
import { compareEntries, type SortColumn, type SortDirection } from '../utils/fileSort'
import { selectAll, selectOnly, selectRange, toggleSelect } from '../utils/fileSelection'

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
    sortDirection: 'asc'
  }
}

/** Read-only fallback for "no session (yet)" — never written into `bySession`. */
const EMPTY_DEFAULT: PerSessionFs = Object.freeze(freshFsState())

interface RemoteFsState {
  bySession: Record<string, PerSessionFs>
}

/**
 * Remote directory-browsing state, keyed by sessionId so each open site tab
 * keeps its own independent path/listing/selection — but exposes the exact
 * same flat `currentPath`/`entries`/`loading`/`error`/`selected` surface as
 * before so `FilePane.vue` needs no template changes.
 */
export const useRemoteFsStore = defineStore('remoteFs', {
  state: (): RemoteFsState => ({ bySession: {} }),

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

    async load(dirPath?: string): Promise<void> {
      const sessionId = this.activeSessionId()
      const entry = this.ensureBucket(sessionId)
      entry.loading = true
      entry.error = null
      try {
        const result = await invoke<FileListResult>(INVOKE_CHANNELS.fsRemoteList, sessionId, dirPath)
        entry.currentPath = result.path
        entry.entries = result.entries.sort(compareEntries(entry.sortColumn, entry.sortDirection))
        entry.selected = new Set()
        entry.selectAnchor = null
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e)
      } finally {
        entry.loading = false
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
      const target = `${this.currentPath.replace(/\/$/, '')}/${name}`
      await invoke<void>(INVOKE_CHANNELS.fsRemoteMkdir, sessionId, target)
      await this.load()
    },

    async remove(entry: FileEntry): Promise<void> {
      const sessionId = this.activeSessionId()
      await invoke<void>(INVOKE_CHANNELS.fsRemoteDelete, sessionId, entry.path)
      await this.load()
    },

    /** Renames `entry` in place, within its current parent directory. */
    async rename(entry: FileEntry, newName: string): Promise<void> {
      const sessionId = this.activeSessionId()
      const parent = entry.path.slice(0, entry.path.length - entry.name.length)
      await invoke<void>(INVOKE_CHANNELS.fsRemoteRename, sessionId, entry.path, `${parent}${newName}`)
      await this.load()
    },

    /** Sets `entry`'s permissions. `mode` is an octal string (e.g. "0755"). */
    async chmod(entry: FileEntry, mode: string): Promise<void> {
      const sessionId = this.activeSessionId()
      await invoke<void>(INVOKE_CHANNELS.fsRemoteChmod, sessionId, entry.path, mode)
      await this.load()
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

    /** Ctrl/Cmd+A — selects every entry in the current listing. */
    selectAll(): void {
      const bucket = this.ensureBucket(this.activeSessionId())
      const result = selectAll(bucket.entries)
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
    }
  }
})

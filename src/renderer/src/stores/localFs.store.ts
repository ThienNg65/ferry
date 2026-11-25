import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { FileEntry, FileListResult } from '@shared/contract'
import { invoke } from '../api'
import { compareEntries, type SortColumn, type SortDirection } from '../utils/fileSort'
import { selectAll, selectOnly, selectRange, toggleSelect } from '../utils/fileSelection'
import { emptyHistory, recordVisit, stepBack, stepForward, type NavHistory } from '../utils/navHistory'

function normalizeLocalDir(dirPath: string): string {
  if (!dirPath) return ''
  if (/^[A-Za-z]:/.test(dirPath)) {
    const windows = dirPath.replace(/\//g, '\\')
    const trimmed = windows.replace(/\\+$/, '')
    return (/^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed).toLowerCase()
  }
  const trimmed = dirPath.replace(/\/+$/, '')
  return trimmed.length === 0 ? '/' : trimmed
}

interface LocalFsState {
  currentPath: string
  entries: FileEntry[]
  loading: boolean
  error: string | null
  failedPath: string | null
  selected: Set<string>
  selectAnchor: string | null
  sortColumn: SortColumn
  sortDirection: SortDirection
  history: NavHistory
  requestSeq: number
  pendingRefreshPath: string | null
}

export const useLocalFsStore = defineStore('localFs', {
  state: (): LocalFsState => ({
    currentPath: '',
    entries: [],
    loading: false,
    error: null,
    failedPath: null,
    selected: new Set(),
    selectAnchor: null,
    sortColumn: 'name',
    sortDirection: 'asc',
    history: emptyHistory(),
    requestSeq: 0,
    pendingRefreshPath: null
  }),

  getters: {
    canGoBack: (state): boolean => state.history.back.length > 0,
    canGoForward: (state): boolean => state.history.fwd.length > 0
  },

  actions: {
    async load(dirPath?: string, options?: { skipHistory?: boolean }): Promise<boolean> {
      const seq = ++this.requestSeq
      this.loading = true
      this.error = null
      this.failedPath = null
      const from = this.currentPath
      const target = dirPath ?? from
      try {
        const result = await invoke<FileListResult>(INVOKE_CHANNELS.fsLocalList, target)
        if (seq !== this.requestSeq) {
          return false
        }
        if (dirPath !== undefined && !options?.skipHistory && from && result.path !== from) {
          this.history = recordVisit(this.history, from)
        }
        this.currentPath = result.path
        this.entries = result.entries.sort(compareEntries(this.sortColumn, this.sortDirection))
        this.selected = new Set()
        this.selectAnchor = null
        return true
      } catch (e) {
        if (seq !== this.requestSeq) {
          return false
        }
        this.failedPath = target
        this.error = e instanceof Error ? e.message : String(e)
        return false
      } finally {
        if (seq === this.requestSeq) {
          this.loading = false
          const pendingRefreshPath = this.pendingRefreshPath
          this.pendingRefreshPath = null
          if (pendingRefreshPath && normalizeLocalDir(this.currentPath) === pendingRefreshPath) {
            await this.refreshIfViewing(pendingRefreshPath)
          }
        }
      }
    },

    async retryDirectory(): Promise<void> {
      await this.load(this.failedPath ?? this.currentPath)
    },

    /** Silently refreshes the current local directory if it matches `targetDir`, preserving selection and scroll. */
    async refreshIfViewing(targetDir: string): Promise<void> {
      const normalizedTarget = normalizeLocalDir(targetDir)
      if (!normalizedTarget || normalizeLocalDir(this.currentPath) !== normalizedTarget) {
        return
      }
      if (this.loading) {
        this.pendingRefreshPath = normalizedTarget
        return
      }

      const pathAtStart = this.currentPath
      const requestSeqAtStart = this.requestSeq
      try {
        const result = await invoke<FileListResult>(INVOKE_CHANNELS.fsLocalList, pathAtStart)
        if (this.requestSeq !== requestSeqAtStart || normalizeLocalDir(this.currentPath) !== normalizedTarget) {
          return
        }
        this.entries = result.entries.sort(compareEntries(this.sortColumn, this.sortDirection))
        const existingPaths = new Set(this.entries.map((e) => e.path))
        const nextSelected = new Set<string>()
        for (const p of this.selected) {
          if (existingPaths.has(p)) nextSelected.add(p)
        }
        this.selected = nextSelected
        if (this.selectAnchor && !existingPaths.has(this.selectAnchor)) {
          this.selectAnchor = null
        }
      } catch {
        // Ignore transient background refresh errors so active work is uninterrupted
      }
    },

    /** Clicking the active column flips its direction; clicking a new column selects it ascending. */
    setSort(column: SortColumn): void {
      if (this.sortColumn === column) {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc'
      } else {
        this.sortColumn = column
        this.sortDirection = 'asc'
      }
      this.entries = [...this.entries].sort(compareEntries(this.sortColumn, this.sortDirection))
    },

    async goBack(): Promise<void> {
      const step = stepBack(this.history, this.currentPath)
      if (!step) return
      const committed = await this.load(step.target, { skipHistory: true })
      if (committed) this.history = step.next
    },

    async goForward(): Promise<void> {
      const step = stepForward(this.history, this.currentPath)
      if (!step) return
      const committed = await this.load(step.target, { skipHistory: true })
      if (committed) this.history = step.next
    },

    async openDir(dirPath: string): Promise<void> {
      await this.load(dirPath)
    },

    async goUp(): Promise<void> {
      const cur = this.currentPath
      if (!cur) return
      const stripped = cur.replace(/[\\/][^\\/]+[\\/]?$/, '')
      let parent = stripped
      if (!parent) {
        parent = cur.startsWith('/') ? '/' : cur
      } else if (/^[A-Za-z]:$/.test(parent)) {
        parent = `${parent}\\`
      }
      await this.load(parent)
    },

    async mkdir(name: string): Promise<void> {
      const sep = this.currentPath.includes('\\') ? '\\' : '/'
      await invoke<void>(INVOKE_CHANNELS.fsLocalMkdir, `${this.currentPath}${sep}${name}`)
      await this.load()
    },

    async touch(name: string): Promise<void> {
      const sep = this.currentPath.includes('\\') ? '\\' : '/'
      await invoke<void>(INVOKE_CHANNELS.fsLocalTouch, `${this.currentPath}${sep}${name}`)
      await this.load()
    },

    /** Deletes `entry` and drops it from the in-memory listing directly — no full directory reload. */
    async remove(entry: FileEntry): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.fsLocalDelete, entry.path, entry.isDir)
      this.entries = this.entries.filter((e) => e.path !== entry.path)
      this.selected.delete(entry.path)
    },

    /** Deletes every entry in `entries` concurrently, then patches the listing once — entries that fail to delete stay in the listing. */
    async removeMany(entries: FileEntry[]): Promise<void> {
      const results = await Promise.allSettled(
        entries.map((entry) => invoke<void>(INVOKE_CHANNELS.fsLocalDelete, entry.path, entry.isDir))
      )
      const removedPaths = new Set<string>()
      const failures: string[] = []
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          removedPaths.add(entries[i].path)
        } else {
          failures.push(entries[i].name)
        }
      })
      this.entries = this.entries.filter((e) => !removedPaths.has(e.path))
      for (const path of removedPaths) {
        this.selected.delete(path)
      }
      if (failures.length > 0) {
        throw new Error(`Failed to delete: ${failures.join(', ')}`)
      }
    },

    /** Renames `entry` in place, within its current parent directory. */
    async rename(entry: FileEntry, newName: string, replace: boolean): Promise<void> {
      const parent = entry.path.slice(0, entry.path.length - entry.name.length)
      const newPath = `${parent}${newName}`
      await invoke<void>(INVOKE_CHANNELS.fsLocalRename, entry.path, newPath, replace)
      const target = this.entries.find((e) => e.path === entry.path)
      if (target) {
        this.entries = this.entries.filter((e) => e.path !== newPath && e.path !== entry.path)
        this.entries.push({ ...target, name: newName, path: newPath })
        if (this.selected.has(entry.path)) {
          this.selected.delete(entry.path)
          this.selected.add(newPath)
        }
        if (this.selectAnchor === entry.path) {
          this.selectAnchor = newPath
        }
        this.entries = [...this.entries].sort(compareEntries(this.sortColumn, this.sortDirection))
      }
    },

    /** Plain click — selects exactly one entry. */
    selectOnly(path: string): void {
      const result = selectOnly(path)
      this.selected = result.selected
      this.selectAnchor = result.anchor
    },

    /** Ctrl/Cmd+click — adds or removes one entry from the existing selection. */
    toggleSelect(path: string): void {
      const result = toggleSelect(this.selected, path)
      this.selected = result.selected
      this.selectAnchor = result.anchor
    },

    /** Shift+click — selects every entry between the last-clicked row and `path`. */
    selectRange(path: string, visibleEntries?: FileEntry[]): void {
      const result = selectRange(visibleEntries ?? this.entries, this.selectAnchor, path)
      this.selected = result.selected
      this.selectAnchor = result.anchor
    },

    selectPaths(paths: string[]): void {
      this.selected = new Set(paths)
      this.selectAnchor = paths[0] ?? null
    },

    /** Ctrl/Cmd+A — selects every entry in `entries` (defaults to the full unfiltered listing). */
    selectAll(entries?: FileEntry[]): void {
      const result = selectAll(entries ?? this.entries)
      this.selected = result.selected
      this.selectAnchor = result.anchor
    },

    setError(message: string | null): void {
      this.error = message
      this.failedPath = null
    }
  }
})

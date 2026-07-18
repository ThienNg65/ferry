import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { FileEntry, FileListResult } from '@shared/contract'
import { invoke } from '../api'
import { compareEntries, type SortColumn, type SortDirection } from '../utils/fileSort'
import { selectAll, selectOnly, selectRange, toggleSelect } from '../utils/fileSelection'

interface LocalFsState {
  currentPath: string
  entries: FileEntry[]
  loading: boolean
  error: string | null
  selected: Set<string>
  selectAnchor: string | null
  sortColumn: SortColumn
  sortDirection: SortDirection
}

export const useLocalFsStore = defineStore('localFs', {
  state: (): LocalFsState => ({
    currentPath: '',
    entries: [],
    loading: false,
    error: null,
    selected: new Set(),
    selectAnchor: null,
    sortColumn: 'name',
    sortDirection: 'asc'
  }),

  actions: {
    async load(dirPath?: string): Promise<void> {
      this.loading = true
      this.error = null
      try {
        const result = await invoke<FileListResult>(INVOKE_CHANNELS.fsLocalList, dirPath ?? this.currentPath)
        this.currentPath = result.path
        this.entries = result.entries.sort(compareEntries(this.sortColumn, this.sortDirection))
        this.selected = new Set()
        this.selectAnchor = null
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.loading = false
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

    async openDir(dirPath: string): Promise<void> {
      await this.load(dirPath)
    },

    async goUp(): Promise<void> {
      const parent = this.currentPath.replace(/[\\/][^\\/]+[\\/]?$/, '') || this.currentPath
      await this.load(parent)
    },

    async mkdir(name: string): Promise<void> {
      const sep = this.currentPath.includes('\\') ? '\\' : '/'
      await invoke<void>(INVOKE_CHANNELS.fsLocalMkdir, `${this.currentPath}${sep}${name}`)
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
    async rename(entry: FileEntry, newName: string): Promise<void> {
      const parent = entry.path.slice(0, entry.path.length - entry.name.length)
      const newPath = `${parent}${newName}`
      await invoke<void>(INVOKE_CHANNELS.fsLocalRename, entry.path, newPath)
      const target = this.entries.find((e) => e.path === entry.path)
      if (target) {
        target.name = newName
        target.path = newPath
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
    selectRange(path: string): void {
      const result = selectRange(this.entries, this.selectAnchor, path)
      this.selected = result.selected
      this.selectAnchor = result.anchor
    },

    /** Ctrl/Cmd+A — selects every entry in the current listing. */
    selectAll(): void {
      const result = selectAll(this.entries)
      this.selected = result.selected
      this.selectAnchor = result.anchor
    }
  }
})

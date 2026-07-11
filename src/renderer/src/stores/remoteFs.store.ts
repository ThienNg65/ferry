import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { FileEntry, FileListResult } from '@shared/contract'
import { invoke } from '../api'
import { useSessionsStore } from './sessions.store'

function sortEntries(a: FileEntry, b: FileEntry): number {
  if (a.isDir !== b.isDir) {
    return a.isDir ? -1 : 1
  }
  return a.name.localeCompare(b.name)
}

interface RemoteFsState {
  currentPath: string
  entries: FileEntry[]
  loading: boolean
  error: string | null
  selected: Set<string>
}

export const useRemoteFsStore = defineStore('remoteFs', {
  state: (): RemoteFsState => ({
    currentPath: '',
    entries: [],
    loading: false,
    error: null,
    selected: new Set()
  }),

  actions: {
    activeSessionId(): string {
      const sessionId = useSessionsStore().activeSessionId
      if (!sessionId) {
        throw new Error('No active session')
      }
      return sessionId
    },

    async load(dirPath?: string): Promise<void> {
      this.loading = true
      this.error = null
      try {
        const result = await invoke<FileListResult>(
          INVOKE_CHANNELS.fsRemoteList,
          this.activeSessionId(),
          dirPath
        )
        this.currentPath = result.path
        this.entries = result.entries.sort(sortEntries)
        this.selected = new Set()
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.loading = false
      }
    },

    async openDir(dirPath: string): Promise<void> {
      await this.load(dirPath)
    },

    async goUp(): Promise<void> {
      const parent = this.currentPath.replace(/\/[^/]+\/?$/, '') || '/'
      await this.load(parent)
    },

    async mkdir(name: string): Promise<void> {
      const target = `${this.currentPath.replace(/\/$/, '')}/${name}`
      await invoke<void>(INVOKE_CHANNELS.fsRemoteMkdir, this.activeSessionId(), target)
      await this.load()
    },

    async remove(entry: FileEntry): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.fsRemoteDelete, this.activeSessionId(), entry.path)
      await this.load()
    },

    toggleSelect(path: string): void {
      const next = new Set(this.selected)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      this.selected = next
    }
  }
})

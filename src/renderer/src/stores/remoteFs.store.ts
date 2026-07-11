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

/** Remote directory-browsing state for a single session. */
interface PerSessionFs {
  currentPath: string
  entries: FileEntry[]
  loading: boolean
  error: string | null
  selected: Set<string>
}

function freshFsState(): PerSessionFs {
  return { currentPath: '', entries: [], loading: false, error: null, selected: new Set() }
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
        entry.entries = result.entries.sort(sortEntries)
        entry.selected = new Set()
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e)
      } finally {
        entry.loading = false
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

    toggleSelect(path: string): void {
      const sessionId = this.activeSessionId()
      const bucket = this.bySession[sessionId]
      if (!bucket) {
        return
      }
      const next = new Set(bucket.selected)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      bucket.selected = next
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

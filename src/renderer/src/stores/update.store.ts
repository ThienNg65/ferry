import { defineStore } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type {
  CheckUpdateResult,
  UpdateProgress,
  UpdateState,
  UpdateStatus
} from '@shared/contract'
import { invoke, IpcError, onEvent } from '../api'
import { useConfirm } from '../composables/useConfirm'
import { useNotify } from '../composables/useNotify'
import { useEditSessionsStore } from './editSessions.store'
import { useOperationsStore } from './operations.store'
import { useSessionsStore } from './sessions.store'
import { useTransferQueueStore } from './transferQueue.store'

interface UpdateStoreState {
  status: UpdateStatus
  currentVersion: string
  availableVersion: string | null
  progress: UpdateProgress | null
  error: string | null
  lastCheckedAt: string | null
  initialized: boolean
  installing: boolean
  unsubscribe: (() => void) | null
  initPromise: Promise<void> | null
}

function isExpectedExitDisconnect(err: unknown): boolean {
  if (err instanceof IpcError) {
    return false
  }
  const msg = err instanceof Error ? err.message : String(err)
  return msg === 'Sidecar disconnected before replying' || msg === 'Neutralino server went offline'
}

export const useUpdateStore = defineStore('update', {
  state: (): UpdateStoreState => ({
    status: 'idle',
    currentVersion: '',
    availableVersion: null,
    progress: null,
    error: null,
    lastCheckedAt: null,
    initialized: false,
    installing: false,
    unsubscribe: null,
    initPromise: null
  }),

  getters: {
    isChecking: (state) => state.status === 'checking',
    isAvailable: (state) => state.status === 'available',
    isDownloading: (state) => state.status === 'downloading',
    isDownloaded: (state) => state.status === 'downloaded',
    canCheck: (state) =>
      !state.installing &&
      state.status !== 'checking' &&
      state.status !== 'available' &&
      state.status !== 'downloading' &&
      state.status !== 'downloaded'
  },

  actions: {
    applyState(s: UpdateState): void {
      this.status = s.status
      this.currentVersion = s.currentVersion || this.currentVersion
      this.availableVersion = s.availableVersion ?? null
      this.progress = s.progress ?? null
      this.error = s.error ?? null
      this.lastCheckedAt = s.lastCheckedAt ?? this.lastCheckedAt
    },

    async init(): Promise<void> {
      if (!this.unsubscribe) {
        this.unsubscribe = onEvent<UpdateState>(EVENT_CHANNELS.updateStatus, (state) => {
          this.applyState(state)
        })
      }
      if (this.initialized) {
        return
      }
      if (this.initPromise) {
        return this.initPromise
      }

      this.initPromise = (async () => {
        try {
          const state = await invoke<UpdateState>(INVOKE_CHANNELS.updateGetStatus)
          this.applyState(state)
          this.initialized = true
        } catch (err) {
          console.error('Failed to get update status', err)
        } finally {
          this.initPromise = null
        }
      })()
      return this.initPromise
    },

    dispose(): void {
      this.unsubscribe?.()
      this.unsubscribe = null
      this.initialized = false
    },

    async checkNow(): Promise<CheckUpdateResult> {
      if (!this.canCheck) {
        return {
          status: this.status,
          version: this.availableVersion ?? undefined,
          error: this.error ?? undefined
        }
      }

      this.status = 'checking'
      this.error = null
      this.progress = null
      this.availableVersion = null

      try {
        const result = await invoke<CheckUpdateResult>(INVOKE_CHANNELS.updateCheck)
        if (result.status === 'available') {
          if (this.status === 'checking' || this.status === 'idle') {
            this.status = 'available'
            this.availableVersion = result.version ?? null
            this.error = null
          }
          this.lastCheckedAt = new Date().toISOString()
        } else {
          this.status = result.status
          this.availableVersion = result.status === 'not-available' ? null : (result.version ?? null)
          this.error = result.error ?? null
          this.progress = null
          if (result.status === 'not-available' || result.status === 'downloaded') {
            this.lastCheckedAt = new Date().toISOString()
          }
        }
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.status = 'error'
        this.availableVersion = null
        this.progress = null
        this.error = msg
        return { status: 'error', error: msg }
      }
    },

    async installNow(): Promise<void> {
      if (this.installing || this.status !== 'downloaded') {
        return
      }
      this.installing = true

      const activeWorkItems: string[] = []
      const transfers = useTransferQueueStore()
      const activeTransfers = transfers.list.filter(
        (t) => t.state === 'queued' || t.state === 'started' || t.state === 'progress' || t.state === 'paused'
      ).length
      if (activeTransfers > 0) {
        activeWorkItems.push(`${activeTransfers} active transfer${activeTransfers === 1 ? '' : 's'} will be interrupted`)
      }

      const operations = useOperationsStore()
      if (operations.runningCount > 0) {
        activeWorkItems.push(
          `${operations.runningCount} running operation${operations.runningCount === 1 ? '' : 's'} will be interrupted`
        )
      }

      const editSessions = useEditSessionsStore()
      const dirtyEdits = editSessions.edits.filter((e) => e.dirty).length
      if (dirtyEdits > 0) {
        activeWorkItems.push(`${dirtyEdits} open file edit${dirtyEdits === 1 ? ' has' : 's have'} unsaved changes`)
      }

      const sessions = useSessionsStore()
      const activeSessions = sessions.tabs.filter((t) => t.status === 'connected' || t.connecting).length
      if (activeSessions > 0) {
        activeWorkItems.push(`${activeSessions} SSH/SFTP session${activeSessions === 1 ? '' : 's'} will be disconnected`)
      }

      if (activeWorkItems.length > 0) {
        const confirm = useConfirm()
        let ok = false
        try {
          ok = await confirm({
            title: this.availableVersion ? `Restart Ferry to install v${this.availableVersion}?` : 'Restart Ferry to install update?',
            body: 'Restarting now will close the application and launch the installer:',
            items: activeWorkItems,
            confirmLabel: 'Restart & Install',
            confirmColor: 'warning'
          })
        } catch {
          this.installing = false
          return
        }
        if (!ok) {
          this.installing = false
          return
        }
      }

      const notify = useNotify()
      try {
        await invoke<void>(INVOKE_CHANNELS.updateInstallNow)
      } catch (err) {
        if (!isExpectedExitDisconnect(err)) {
          this.installing = false
          notify.error('Could not install update', err instanceof Error ? err.message : String(err))
          return
        }
      }

      try {
        await invoke<void>(INVOKE_CHANNELS.windowClose)
      } catch (err) {
        this.installing = false
        notify.error('Could not close Ferry to finish update', err instanceof Error ? err.message : String(err))
      }
    }
  }
})

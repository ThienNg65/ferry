import { defineStore } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type {
  CheckUpdateResult,
  UpdateProgress,
  UpdateState,
  UpdateStatus
} from '@shared/contract'
import { invoke, onEvent } from '../api'

interface UpdateStoreState {
  status: UpdateStatus
  currentVersion: string
  availableVersion: string | null
  progress: UpdateProgress | null
  error: string | null
  lastCheckedAt: string | null
  initialized: boolean
}

export const useUpdateStore = defineStore('update', {
  state: (): UpdateStoreState => ({
    status: 'idle',
    currentVersion: '',
    availableVersion: null,
    progress: null,
    error: null,
    lastCheckedAt: null,
    initialized: false
  }),

  getters: {
    isChecking: (state) => state.status === 'checking',
    isDownloading: (state) => state.status === 'downloading',
    isDownloaded: (state) => state.status === 'downloaded',
    canCheck: (state) => state.status !== 'checking' && state.status !== 'downloading'
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
      if (this.initialized) {
        return
      }
      this.initialized = true

      try {
        const state = await invoke<UpdateState>(INVOKE_CHANNELS.updateGetStatus)
        this.applyState(state)
      } catch (err) {
        console.error('Failed to get update status', err)
      }

      onEvent<UpdateState>(EVENT_CHANNELS.updateStatus, (state) => {
        this.applyState(state)
      })
    },

    async checkNow(): Promise<CheckUpdateResult> {
      try {
        const result = await invoke<CheckUpdateResult>(INVOKE_CHANNELS.updateCheck)
        this.status = result.status
        if (result.version) {
          this.availableVersion = result.version
        }
        if (result.error) {
          this.error = result.error
        }
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.status = 'error'
        this.error = msg
        return { status: 'error', error: msg }
      }
    },

    async installNow(): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.updateInstallNow)
    }
  }
})

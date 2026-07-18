import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { AppSettings } from '@shared/contract'
import { invoke } from '../api'

interface SettingsState {
  bandwidthLimitKBps: number | null
  loaded: boolean
}

/** Small app-wide settings persisted by the main process (`AppSettingsStore`) — currently just the transfer bandwidth cap. */
export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    bandwidthLimitKBps: null,
    loaded: false
  }),

  actions: {
    async fetch(): Promise<void> {
      const settings = await invoke<AppSettings>(INVOKE_CHANNELS.settingsGet)
      this.bandwidthLimitKBps = settings.bandwidthLimitKBps
      this.loaded = true
    },

    async setBandwidthLimitKBps(limit: number | null): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.settingsSetBandwidthLimit, limit)
      this.bandwidthLimitKBps = limit
    }
  }
})

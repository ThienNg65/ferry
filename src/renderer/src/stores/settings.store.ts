import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { AppSettings, ProxyConfig, ProxyInfo } from '@shared/contract'
import { invoke } from '../api'

interface SettingsState {
  bandwidthLimitKBps: number | null
  defaultProxy: ProxyInfo | undefined
  loaded: boolean
  inFlightFetch: Promise<void> | null
}

/** Small app-wide settings persisted by the main process (`AppSettingsStore`) — the transfer bandwidth cap and the default proxy any site's `proxyMode: 'inherit'` falls back to. */
export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    bandwidthLimitKBps: null,
    defaultProxy: undefined,
    loaded: false,
    inFlightFetch: null
  }),

  actions: {
    async fetch(): Promise<void> {
      if (this.inFlightFetch) {
        return this.inFlightFetch
      }
      this.inFlightFetch = (async () => {
        try {
          const settings = await invoke<AppSettings>(INVOKE_CHANNELS.settingsGet)
          this.bandwidthLimitKBps = settings.bandwidthLimitKBps
          this.defaultProxy = settings.defaultProxy
          this.loaded = true
        } finally {
          this.inFlightFetch = null
        }
      })()
      return this.inFlightFetch
    },

    async setBandwidthLimitKBps(limit: number | null): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.settingsSetBandwidthLimit, limit)
      this.bandwidthLimitKBps = limit
    },

    /** `null` clears the default proxy. */
    async setDefaultProxy(proxy: ProxyConfig | null): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.settingsSetDefaultProxy, proxy)
      await this.fetch()
    }
  }
})

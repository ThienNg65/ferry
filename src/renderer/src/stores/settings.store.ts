import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { AppSettings, KnownHostEntry, ProxyConfig, ProxyInfo, TermsAcceptance } from '@shared/contract'
import { invoke } from '../api'
import { useUiStore } from './ui.store'

interface SettingsState {
  bandwidthLimitKBps: number | null
  defaultProxy: ProxyInfo | undefined
  autoCheckUpdates: boolean
  historyRetentionDays: number | null
  termsAcceptance: TermsAcceptance | null
  loaded: boolean
  inFlightFetch: Promise<void> | null
}

/** Small app-wide settings persisted by the main process (`AppSettingsStore`) — the transfer bandwidth cap, the default proxy, update, retention, and legal settings. */
export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    bandwidthLimitKBps: null,
    defaultProxy: undefined,
    autoCheckUpdates: true,
    historyRetentionDays: 90,
    termsAcceptance: null,
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
          this.autoCheckUpdates = settings.autoCheckUpdates ?? true
          this.historyRetentionDays = settings.historyRetentionDays === undefined ? 90 : settings.historyRetentionDays
          this.termsAcceptance = settings.termsAcceptance ?? null
          if (!this.loaded) {
            useUiStore().hydrateFromPrefs(settings.uiPrefs ?? {})
          }
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
    },

    async setAutoCheckUpdates(enabled: boolean): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.settingsSetAutoCheckUpdates, enabled)
      this.autoCheckUpdates = enabled
    },

    async setHistoryRetentionDays(days: number | null): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.settingsSetHistoryRetention, days)
      this.historyRetentionDays = days
    },

    async acceptTerms(version: string): Promise<TermsAcceptance> {
      const record = await invoke<TermsAcceptance>(INVOKE_CHANNELS.settingsAcceptTerms, version)
      this.termsAcceptance = record
      return record
    },

    async listKnownHosts(): Promise<KnownHostEntry[]> {
      return invoke<KnownHostEntry[]>(INVOKE_CHANNELS.knownHostsList)
    },

    async forgetKnownHost(hostPort: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.knownHostsForget, hostPort)
    },

    async clearKnownHosts(): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.knownHostsClear)
    },

    async exportUserData(): Promise<string> {
      return invoke<string>(INVOKE_CHANNELS.privacyExportData)
    },

    async deleteAllLocalData(): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.privacyDeleteAllData)
      localStorage.clear()
      useUiStore().resetGlassUi()
      await this.fetch()
    }
  }
})

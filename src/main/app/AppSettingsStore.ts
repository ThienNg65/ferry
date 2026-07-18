import Store from 'electron-store'
import type { AppSettings } from '../../shared/contract'

interface StoreSchema {
  openTabSiteIds: string[]
  bandwidthLimitKBps: number | null
}

/**
 * Persists small app-wide settings to `app-settings.json` under the OS
 * userData directory — mirrors {@link SiteStore}'s persistence pattern, but
 * for state that isn't a saved site (which tabs were open; the global
 * transfer bandwidth cap).
 */
export class AppSettingsStore {
  private static instance: AppSettingsStore | null = null
  private readonly store = new Store<StoreSchema>({
    name: 'app-settings',
    defaults: { openTabSiteIds: [], bandwidthLimitKBps: null }
  })

  static getInstance(): AppSettingsStore {
    if (AppSettingsStore.instance === null) {
      AppSettingsStore.instance = new AppSettingsStore()
    }
    return AppSettingsStore.instance
  }

  get(): AppSettings {
    return {
      openTabSiteIds: this.store.get('openTabSiteIds'),
      bandwidthLimitKBps: this.store.get('bandwidthLimitKBps')
    }
  }

  setOpenTabSiteIds(siteIds: string[]): void {
    this.store.set('openTabSiteIds', siteIds)
  }

  setBandwidthLimitKBps(limit: number | null): void {
    this.store.set('bandwidthLimitKBps', limit)
  }
}

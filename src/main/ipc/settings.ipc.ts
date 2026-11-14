import { handle } from './envelope'
import { validateProxyConfig } from './validation'
import {
  INVOKE_CHANNELS,
  type AppSettings,
  type KnownHostEntry,
  type ProxyConfig,
  type TermsAcceptance
} from '../../shared/contract'
import { AppSettingsStore } from '../app/AppSettingsStore'
import { BookmarkStore } from '../bookmarks/BookmarkStore'
import { HistoryStore } from '../history/HistoryStore'
import { SiteStore } from '../sites/SiteStore'
import { KnownHostsStore } from '../ssh/KnownHostsStore'
import { TransferQueue } from '../transfer/TransferQueue'
import { SshError } from '../ssh/errors'
import { host } from '../host/host'
import { initAutoUpdater } from '../update/AutoUpdater'

/** Registers handlers for small persisted app-wide settings and privacy/data controls. */
export function registerSettingsHandlers(): void {
  handle<AppSettings>(INVOKE_CHANNELS.settingsGet, () => {
    const settings = AppSettingsStore.getInstance().get()
    const retention = settings.historyRetentionDays === undefined ? 90 : settings.historyRetentionDays
    HistoryStore.getInstance().pruneExpired(retention)
    return settings
  })

  handle<void>(INVOKE_CHANNELS.settingsSetOpenTabs, (siteIds) => {
    if (!Array.isArray(siteIds) || siteIds.some((id) => typeof id !== 'string')) {
      throw new SshError('VALIDATION', 'settings:setOpenTabs requires an array of string siteIds')
    }
    AppSettingsStore.getInstance().setOpenTabSiteIds(siteIds)
  })

  handle<void>(INVOKE_CHANNELS.settingsSetBandwidthLimit, (limitKBps) => {
    const limit = limitKBps as number | null
    // `null` means "unlimited" (see AppSettingsStore/SettingsDialog.vue) — only reject
    // non-null values that can't possibly represent a real cap.
    if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
      throw new SshError('VALIDATION', 'settings:setBandwidthLimit requires a positive number or null')
    }
    AppSettingsStore.getInstance().setBandwidthLimitKBps(limit)
    TransferQueue.getInstance().setBandwidthLimitKBps(limit)
  })

  handle<void>(INVOKE_CHANNELS.settingsSetAutoCheckUpdates, (enabled) => {
    AppSettingsStore.getInstance().setAutoCheckUpdates(Boolean(enabled))
  })

  handle<void>(INVOKE_CHANNELS.settingsSetDefaultProxy, (proxy) => {
    const validated = proxy === null || proxy === undefined ? null : validateProxyConfig(proxy, INVOKE_CHANNELS.settingsSetDefaultProxy)
    AppSettingsStore.getInstance().setDefaultProxy(validated)
  })

  handle<void>(INVOKE_CHANNELS.settingsSetHistoryRetention, (days) => {
    const value = days as number | null
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 3650)) {
      throw new SshError('VALIDATION', 'settings:setHistoryRetention requires null or an integer between 1 and 3650')
    }
    AppSettingsStore.getInstance().setHistoryRetentionDays(value)
    HistoryStore.getInstance().pruneExpired(value)
  })

  handle<TermsAcceptance>(INVOKE_CHANNELS.settingsAcceptTerms, (version) => {
    const trimmed = typeof version === 'string' ? version.trim() : ''
    if (!trimmed) {
      throw new SshError('VALIDATION', 'settings:acceptTerms requires a non-empty policy version')
    }
    const acceptance = AppSettingsStore.getInstance().acceptTerms(trimmed)
    try {
      if (host().isPackaged) {
        void initAutoUpdater()
      }
    } catch {
      // Host is not initialized in isolated IPC unit tests.
    }
    return acceptance
  })

  handle<KnownHostEntry[]>(INVOKE_CHANNELS.knownHostsList, () => {
    return KnownHostsStore.getInstance().list()
  })

  handle<void>(INVOKE_CHANNELS.knownHostsForget, (hostPort) => {
    if (typeof hostPort !== 'string' || !hostPort.trim()) {
      throw new SshError('VALIDATION', 'knownHosts:forget requires a host:port key')
    }
    KnownHostsStore.getInstance().forgetKey(hostPort)
  })

  handle<void>(INVOKE_CHANNELS.knownHostsClear, () => {
    KnownHostsStore.getInstance().clear()
  })

  handle<string>(INVOKE_CHANNELS.privacyExportData, () => {
    // Secrets (passwords/passphrases) are never returned by SiteStore.list() or AppSettingsStore.get().
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: AppSettingsStore.getInstance().get(),
      sites: SiteStore.getInstance().list(),
      bookmarks: BookmarkStore.getInstance().list(),
      knownHosts: KnownHostsStore.getInstance().list(),
      history: HistoryStore.getInstance().list()
    }
    return JSON.stringify(payload, null, 2)
  })

  handle<void>(INVOKE_CHANNELS.privacyDeleteAllData, () => {
    SiteStore.getInstance().clear()
    BookmarkStore.getInstance().clear()
    HistoryStore.getInstance().clear()
    KnownHostsStore.getInstance().clear()
    AppSettingsStore.getInstance().reset()
    TransferQueue.getInstance().setBandwidthLimitKBps(null)
  })
}

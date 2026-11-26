import { readdirSync, rmSync } from 'fs'
import * as path from 'path'
import { handle } from './envelope'
import { failValidation, requireBoolean, requireNonEmptyString, requireStringArray, validateProxyConfig } from './validation'
import {
  INVOKE_CHANNELS,
  type AppSettings,
  type KnownHostEntry,
  type ProxyConfig,
  type TermsAcceptance,
  type UiPrefUpdate
} from '../../shared/contract'
import { AppSettingsStore } from '../app/AppSettingsStore'
import { BookmarkStore } from '../bookmarks/BookmarkStore'
import { HistoryStore } from '../history/HistoryStore'
import { SiteStore } from '../sites/SiteStore'
import { KnownHostsStore } from '../ssh/KnownHostsStore'
import { TransferQueue } from '../transfer/TransferQueue'
import { host } from '../host/host'
import { initAutoUpdater } from '../update/AutoUpdater'

const MIGRATION_BACKUP_RE = /^.+\.v.+\.bak\.json$/

/** Best-effort removal of pre-upgrade snapshots and pre-migration `.bak.json` files from `dataDir`. */
function removeLocalBackupFiles(): void {
  let dataDir: string
try {
dataDir = host().dataDir
} catch {
// Host is not initialized in isolated IPC unit tests.
return
}
if (!dataDir) return

try {
rmSync(path.join(dataDir, 'upgrade-backups'), { recursive: true, force: true })
} catch {
// Best-effort cleanup; ignore missing or locked backup directory.
}

try {
for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
if (!entry.isFile() || !MIGRATION_BACKUP_RE.test(entry.name)) continue
try {
rmSync(path.join(dataDir, entry.name), { force: true })
} catch {
// Best-effort cleanup; continue removing remaining backup files.
}
}
} catch {
// Ignore when dataDir does not exist or cannot be read.
}
}

/** Registers handlers for small persisted app-wide settings and privacy/data controls. */
export function registerSettingsHandlers(): void {
  handle<AppSettings>(INVOKE_CHANNELS.settingsGet, () => {
    const settings = AppSettingsStore.getInstance().get()
    const retention = settings.historyRetentionDays === undefined ? 90 : settings.historyRetentionDays
    HistoryStore.getInstance().pruneExpired(retention)
    return settings
  })

  handle<void>(INVOKE_CHANNELS.settingsSetOpenTabs, (siteIds) => {
    AppSettingsStore.getInstance().setOpenTabSiteIds(
      requireStringArray(siteIds, 'siteIds', INVOKE_CHANNELS.settingsSetOpenTabs)
    )
  })

  handle<void>(INVOKE_CHANNELS.settingsSetBandwidthLimit, (limitKBps) => {
    const limit = limitKBps as number | null
    // `null` means "unlimited" (see AppSettingsStore/SettingsDialog.vue) — only reject
    // non-null values that can't possibly represent a real cap.
    if (limit !== null && (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0)) {
      failValidation(INVOKE_CHANNELS.settingsSetBandwidthLimit, 'settings:setBandwidthLimit requires a positive number or null')
    }
    AppSettingsStore.getInstance().setBandwidthLimitKBps(limit)
    TransferQueue.getInstance().setBandwidthLimitKBps(limit)
  })

  handle<void>(INVOKE_CHANNELS.settingsSetAutoCheckUpdates, (enabled) => {
    AppSettingsStore.getInstance().setAutoCheckUpdates(
      requireBoolean(enabled, 'enabled', INVOKE_CHANNELS.settingsSetAutoCheckUpdates)
    )
  })

  handle<void>(INVOKE_CHANNELS.settingsSetDefaultProxy, (proxy) => {
    const validated = proxy === null || proxy === undefined ? null : validateProxyConfig(proxy, INVOKE_CHANNELS.settingsSetDefaultProxy)
    AppSettingsStore.getInstance().setDefaultProxy(validated)
  })

  handle<void>(INVOKE_CHANNELS.settingsSetHistoryRetention, (days) => {
    const value = days as number | null
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 3650)) {
      failValidation(INVOKE_CHANNELS.settingsSetHistoryRetention, 'settings:setHistoryRetention requires null or an integer between 1 and 3650')
    }
    AppSettingsStore.getInstance().setHistoryRetentionDays(value)
    HistoryStore.getInstance().pruneExpired(value)
  })

  handle<TermsAcceptance>(INVOKE_CHANNELS.settingsAcceptTerms, (version) => {
    const trimmed = requireNonEmptyString(version, 'version', INVOKE_CHANNELS.settingsAcceptTerms).trim()
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

  handle<void>(INVOKE_CHANNELS.settingsSetUiPref, (payload) => {
    const update = payload as Partial<UiPrefUpdate> | null | undefined
    const key = typeof update?.key === 'string' ? update.key : ''
    if (!key.startsWith('ferry:ui:') || key.length > 64) {
      failValidation(INVOKE_CHANNELS.settingsSetUiPref, 'settings:setUiPref requires a valid ferry:ui:* key')
    }
    const value = update?.value
    if (value !== null && (typeof value !== 'string' || value.length > 4096)) {
      failValidation(INVOKE_CHANNELS.settingsSetUiPref, 'settings:setUiPref requires a string value (<= 4096 chars) or null')
    }
    AppSettingsStore.getInstance().setUiPref(key, value)
  })

  handle<KnownHostEntry[]>(INVOKE_CHANNELS.knownHostsList, () => {
    return KnownHostsStore.getInstance().list()
  })

  handle<void>(INVOKE_CHANNELS.knownHostsForget, (hostPort) => {
    KnownHostsStore.getInstance().forgetKey(
      requireNonEmptyString(hostPort, 'hostPort', INVOKE_CHANNELS.knownHostsForget)
    )
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
    removeLocalBackupFiles()
  })
}

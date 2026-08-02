import { handle } from './envelope'
import { INVOKE_CHANNELS, type AppSettings, type ProxyConfig } from '../../shared/contract'
import { AppSettingsStore } from '../app/AppSettingsStore'
import { TransferQueue } from '../transfer/TransferQueue'
import { SshError } from '../ssh/errors'

/** Registers handlers for small persisted app-wide settings. */
export function registerSettingsHandlers(): void {
  handle<AppSettings>(INVOKE_CHANNELS.settingsGet, () => {
    return AppSettingsStore.getInstance().get()
  })

  handle<void>(INVOKE_CHANNELS.settingsSetOpenTabs, (siteIds) => {
    AppSettingsStore.getInstance().setOpenTabSiteIds(siteIds as string[])
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

  handle<void>(INVOKE_CHANNELS.settingsSetDefaultProxy, (proxy) => {
    AppSettingsStore.getInstance().setDefaultProxy(proxy as ProxyConfig | null)
  })
}

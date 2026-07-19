import { handle } from './envelope'
import { INVOKE_CHANNELS, type AppSettings, type ProxyConfig } from '../../shared/contract'
import { AppSettingsStore } from '../app/AppSettingsStore'
import { TransferQueue } from '../transfer/TransferQueue'

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
    AppSettingsStore.getInstance().setBandwidthLimitKBps(limit)
    TransferQueue.getInstance().setBandwidthLimitKBps(limit)
  })

  handle<void>(INVOKE_CHANNELS.settingsSetDefaultProxy, (proxy) => {
    AppSettingsStore.getInstance().setDefaultProxy(proxy as ProxyConfig | null)
  })
}

import Store from 'electron-store'
import { safeStorage } from 'electron'
import { SshError } from '../ssh/errors'
import type { AppSettings, ProxyConfig } from '../../shared/contract'

/** On-disk shape of the app-wide default proxy — secret encrypted-at-rest, same discipline as SiteStore. */
interface StoredProxy {
  type: 'socks5' | 'http'
  host: string
  port: number
  username?: string
  secretPassword?: string
}

interface StoreSchema {
  openTabSiteIds: string[]
  bandwidthLimitKBps: number | null
  defaultProxy: StoredProxy | null
}

function encrypt(plaintext: string | undefined): string | undefined {
  if (!plaintext) {
    return undefined
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SshError('AUTH', 'OS credential encryption is unavailable on this machine')
  }
  return safeStorage.encryptString(plaintext).toString('base64')
}

function decrypt(ciphertext: string | undefined): string | undefined {
  if (!ciphertext) {
    return undefined
  }
  return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
}

/**
 * Persists small app-wide settings to `app-settings.json` under the OS
 * userData directory — mirrors {@link SiteStore}'s persistence pattern, but
 * for state that isn't a saved site (which tabs were open; the global
 * transfer bandwidth cap; the default proxy any site's `proxyMode: 'inherit'`
 * falls back to).
 */
export class AppSettingsStore {
  private static instance: AppSettingsStore | null = null
  private readonly store = new Store<StoreSchema>({
    name: 'app-settings',
    defaults: { openTabSiteIds: [], bandwidthLimitKBps: null, defaultProxy: null }
  })

  static getInstance(): AppSettingsStore {
    if (AppSettingsStore.instance === null) {
      AppSettingsStore.instance = new AppSettingsStore()
    }
    return AppSettingsStore.instance
  }

  get(): AppSettings {
    const proxy = this.store.get('defaultProxy')
    return {
      openTabSiteIds: this.store.get('openTabSiteIds'),
      bandwidthLimitKBps: this.store.get('bandwidthLimitKBps'),
      defaultProxy: proxy
        ? { type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username, hasPassword: Boolean(proxy.secretPassword) }
        : undefined
    }
  }

  setOpenTabSiteIds(siteIds: string[]): void {
    this.store.set('openTabSiteIds', siteIds)
  }

  setBandwidthLimitKBps(limit: number | null): void {
    this.store.set('bandwidthLimitKBps', limit)
  }

  /** `null` clears the default proxy entirely. Omitting `password` (vs. an explicit empty string) preserves whatever password is already stored, mirroring `SiteStore.pickSecret`'s convention. */
  setDefaultProxy(proxy: ProxyConfig | null): void {
    if (!proxy) {
      this.store.set('defaultProxy', null)
      return
    }
    const existing = this.store.get('defaultProxy')
    this.store.set('defaultProxy', {
      type: proxy.type,
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      secretPassword: proxy.password !== undefined ? encrypt(proxy.password) : existing?.secretPassword
    })
  }

  /** Fully hydrated with its decrypted password. Never returned to the renderer — main-process only, at connect-time. */
  getDecryptedDefaultProxy(): ProxyConfig | undefined {
    const proxy = this.store.get('defaultProxy')
    if (!proxy) {
      return undefined
    }
    return { type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username, password: decrypt(proxy.secretPassword) }
  }
}

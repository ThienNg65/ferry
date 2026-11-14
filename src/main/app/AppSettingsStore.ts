import Conf from 'conf'
import { host } from '../host/host'
import { decrypt, encrypt } from '../host/secrets'
import type { AppSettings, ProxyConfig, TermsAcceptance } from '../../shared/contract'

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
  autoCheckUpdates: boolean
  historyRetentionDays: number | null
  termsAcceptance: TermsAcceptance | null
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
  private _store: Conf<StoreSchema> | null = null

  private get store(): Conf<StoreSchema> {
    if (!this._store) {
      this._store = new Conf<StoreSchema>({
        cwd: host().dataDir,
        configName: 'app-settings',
        defaults: {
          openTabSiteIds: [],
          bandwidthLimitKBps: null,
          defaultProxy: null,
          autoCheckUpdates: true,
          historyRetentionDays: 90,
          termsAcceptance: null
        }
      })
    }
    return this._store
  }

  static getInstance(): AppSettingsStore {
    if (AppSettingsStore.instance === null) {
      AppSettingsStore.instance = new AppSettingsStore()
    }
    return AppSettingsStore.instance
  }

  get(): AppSettings {
    const proxy = this.store.get('defaultProxy')
    const rawRetention = this.store.get('historyRetentionDays')
    return {
      openTabSiteIds: this.store.get('openTabSiteIds'),
      bandwidthLimitKBps: this.store.get('bandwidthLimitKBps'),
      defaultProxy: proxy
        ? { type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username, hasPassword: Boolean(proxy.secretPassword) }
        : undefined,
      autoCheckUpdates: this.store.get('autoCheckUpdates') ?? true,
      historyRetentionDays: rawRetention === undefined ? 90 : rawRetention,
      termsAcceptance: this.store.get('termsAcceptance') ?? null
    }
  }

  setOpenTabSiteIds(siteIds: string[]): void {
    this.store.set('openTabSiteIds', siteIds)
  }

  setAutoCheckUpdates(enabled: boolean): void {
    this.store.set('autoCheckUpdates', enabled)
  }

  setHistoryRetentionDays(days: number | null): void {
    this.store.set('historyRetentionDays', days)
  }

  acceptTerms(version: string): TermsAcceptance {
    const record: TermsAcceptance = { version, acceptedAt: new Date().toISOString() }
    this.store.set('termsAcceptance', record)
    return record
  }

  reset(): void {
    this.store.set('openTabSiteIds', [])
    this.store.set('bandwidthLimitKBps', null)
    this.store.set('defaultProxy', null)
    this.store.set('autoCheckUpdates', true)
    this.store.set('historyRetentionDays', 90)
    this.store.set('termsAcceptance', null)
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

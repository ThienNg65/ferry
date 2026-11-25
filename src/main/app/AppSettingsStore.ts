import type Conf from 'conf'
import { host } from '../host/host'
import { decrypt, encrypt } from '../host/secrets'
import { openSafeConf } from '../host/storeHelpers'
import {
  DEFAULT_GEMINI_ENDPOINT,
  normalizeGeminiModel,
  type AppSettings,
  type CompanionAiConfigInfo,
  type CompanionAiConfigInput,
  type CompanionAiProvider,
  type ProxyConfig,
  type TermsAcceptance
} from '../../shared/contract'

function normalizeProvider(raw: unknown): CompanionAiProvider {
  return raw === 'gemini' || raw === 'ferry-pro' ? raw : 'none'
}

/** On-disk shape of the app-wide default proxy — secret encrypted-at-rest, same discipline as SiteStore. */
interface StoredProxy {
  type: 'socks5' | 'http'
  host: string
  port: number
  username?: string
  secretPassword?: string
}

interface StoredCompanionAi {
  provider: CompanionAiProvider
  endpoint: string
  model: string
  secretApiKey?: string
}

type StoreSchema = {
  schemaVersion?: number
  openTabSiteIds: string[]
  bandwidthLimitKBps: number | null
  defaultProxy: StoredProxy | null
  autoCheckUpdates: boolean
  historyRetentionDays: number | null
  termsAcceptance: TermsAcceptance | null
  uiPrefs: Record<string, string>
  companionAi: StoredCompanionAi | null
}

function sanitizeUiPrefs(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('ferry:ui:') && typeof value === 'string') {
      clean[key] = value
    }
  }
  return clean
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
      this._store = openSafeConf<StoreSchema>({
        cwd: host().dataDir,
        configName: 'app-settings',
        schemaVersion: 1,
        defaults: {
          schemaVersion: 1,
          openTabSiteIds: [],
          bandwidthLimitKBps: null,
          defaultProxy: null,
          autoCheckUpdates: true,
          historyRetentionDays: 90,
          termsAcceptance: null,
          uiPrefs: {},
          companionAi: null
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
      termsAcceptance: this.store.get('termsAcceptance') ?? null,
      uiPrefs: sanitizeUiPrefs(this.store.get('uiPrefs'))
    }
  }

  setOpenTabSiteIds(siteIds: string[]): void {
    this.store.set('openTabSiteIds', siteIds)
  }

  removeOpenTabSiteId(siteId: string): void {
    const current = this.store.get('openTabSiteIds')
    if (!Array.isArray(current) || !current.includes(siteId)) return
    this.store.set('openTabSiteIds', current.filter((id) => id !== siteId))
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

  setUiPref(key: string, value: string | null): void {
    const next = sanitizeUiPrefs(this.store.get('uiPrefs'))
    if (value === null) {
      delete next[key]
    } else {
      next[key] = value
    }
    this.store.set('uiPrefs', next)
  }

  reset(): void {
    this.store.set('openTabSiteIds', [])
    this.store.set('bandwidthLimitKBps', null)
    this.store.set('defaultProxy', null)
    this.store.set('autoCheckUpdates', true)
    this.store.set('historyRetentionDays', 90)
    this.store.set('termsAcceptance', null)
    this.store.set('uiPrefs', {})
    this.store.set('companionAi', null)
  }

  getCompanionAiConfig(): CompanionAiConfigInfo {
    const stored = this.store.get('companionAi')
    const provider = normalizeProvider(stored?.provider)
    if (!stored || provider === 'none') {
      return { provider: 'none', endpoint: '', model: '', hasApiKey: false }
    }
    return {
      provider,
      endpoint: stored.endpoint || (provider === 'gemini' ? DEFAULT_GEMINI_ENDPOINT : ''),
      model: normalizeGeminiModel(stored.model),
      hasApiKey: Boolean(stored.secretApiKey)
    }
  }

  setCompanionAiConfig(input: CompanionAiConfigInput): CompanionAiConfigInfo {
    const provider = normalizeProvider(input.provider)
    if (provider === 'none') {
      this.store.set('companionAi', null)
      return { provider: 'none', endpoint: '', model: '', hasApiKey: false }
    }
    const existing = this.store.get('companionAi')
    const secretApiKey =
      input.apiKey !== undefined
        ? input.apiKey.trim()
          ? encrypt(input.apiKey.trim())
          : undefined
        : existing?.secretApiKey

    const rawEndpoint = input.endpoint.trim()
    const next: StoredCompanionAi = {
      provider,
      endpoint: rawEndpoint || (provider === 'gemini' ? DEFAULT_GEMINI_ENDPOINT : ''),
      model: normalizeGeminiModel(input.model),
      secretApiKey
    }
    this.store.set('companionAi', next)
    return {
      provider: next.provider,
      endpoint: next.endpoint,
      model: next.model,
      hasApiKey: Boolean(next.secretApiKey)
    }
  }

  getDecryptedCompanionAiConfig(): (CompanionAiConfigInfo & { apiKey?: string }) | null {
    const stored = this.store.get('companionAi')
    const provider = normalizeProvider(stored?.provider)
    if (!stored || provider === 'none') return null
    return {
      provider,
      endpoint: stored.endpoint || (provider === 'gemini' ? DEFAULT_GEMINI_ENDPOINT : ''),
      model: normalizeGeminiModel(stored.model),
      hasApiKey: Boolean(stored.secretApiKey),
      apiKey: stored.secretApiKey ? decrypt(stored.secretApiKey) : undefined
    }
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

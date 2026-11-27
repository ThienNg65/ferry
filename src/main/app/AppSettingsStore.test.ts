import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `conf` is mocked here with a minimal in-memory implementation mirroring the
 * two methods `AppSettingsStore.ts` actually uses (`get`/`set`), keyed by the
 * `configName` option so a fresh `new AppSettingsStore()` reads back whatever a
 * previous instance wrote without touching disk. Encryption uses `testHost`.
 */
const disks = new Map<string, Record<string, unknown>>()

vi.mock('conf', () => {
  class FakeConf {
    private readonly name: string
    constructor(opts: { configName: string; defaults: Record<string, unknown> }) {
      this.name = opts.configName
      if (!disks.has(this.name)) {
        disks.set(this.name, { ...opts.defaults })
      }
    }
    get(key: string): unknown {
      return JSON.parse(JSON.stringify(disks.get(this.name)![key]))
    }
    set(key: string, value: unknown): void {
      disks.get(this.name)![key] = JSON.parse(JSON.stringify(value))
    }
  }
  return { default: FakeConf }
})

const { testHost } = await import('../host/testHost.setup')
const { AppSettingsStore } = await import('./AppSettingsStore')

describe('AppSettingsStore', () => {
  beforeEach(() => {
    disks.clear()
  })

  it('defaults to empty tabs, unlimited bandwidth, and no default proxy', () => {
    const store = new AppSettingsStore()
    expect(store.get()).toEqual({
      openTabSiteIds: [],
      bandwidthLimitKBps: null,
      defaultProxy: undefined,
      autoCheckUpdates: true,
      historyRetentionDays: 90,
      termsAcceptance: null,
      uiPrefs: {}
    })
  })

  it('round-trips open tab site ids through a fresh instance (same underlying store)', () => {
    const store = new AppSettingsStore()
    store.setOpenTabSiteIds(['site-a', 'site-b'])

    const reloaded = new AppSettingsStore()
    expect(reloaded.get().openTabSiteIds).toEqual(['site-a', 'site-b'])
  })

  it('round-trips the bandwidth limit, including clearing it back to null', () => {
    const store = new AppSettingsStore()
    store.setBandwidthLimitKBps(512)
    expect(new AppSettingsStore().get().bandwidthLimitKBps).toBe(512)

    store.setBandwidthLimitKBps(null)
    expect(new AppSettingsStore().get().bandwidthLimitKBps).toBeNull()
  })

  it('round-trips the autoCheckUpdates setting', () => {
    const store = new AppSettingsStore()
    expect(store.get().autoCheckUpdates).toBe(true)
    store.setAutoCheckUpdates(false)
    expect(new AppSettingsStore().get().autoCheckUpdates).toBe(false)
    store.setAutoCheckUpdates(true)
    expect(new AppSettingsStore().get().autoCheckUpdates).toBe(true)
  })

  it('round-trips a default proxy, exposing hasPassword instead of the plaintext password', () => {
    const store = new AppSettingsStore()
    store.setDefaultProxy({ type: 'socks5', host: 'proxy.example.com', port: 1080, username: 'alice', password: 'hunter2' })

    const reloaded = new AppSettingsStore().get()
    expect(reloaded.defaultProxy).toEqual({
      type: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
      username: 'alice',
      hasPassword: true
    })
  })

  it('clears the default proxy entirely when set to null', () => {
    const store = new AppSettingsStore()
    store.setDefaultProxy({ type: 'http', host: 'proxy.example.com', port: 8080, password: 'secret' })
    store.setDefaultProxy(null)
    expect(new AppSettingsStore().get().defaultProxy).toBeUndefined()
  })

  it('preserves the existing encrypted password when updating a proxy without providing a new one', () => {
    const store = new AppSettingsStore()
    store.setDefaultProxy({ type: 'http', host: 'proxy.example.com', port: 8080, username: 'bob', password: 'hunter2' })
    // Update host only, omitting `password` entirely (not an empty string) — should preserve the old secret.
    store.setDefaultProxy({ type: 'http', host: 'proxy2.example.com', port: 8080, username: 'bob' })

    const decrypted = store.getDecryptedDefaultProxy()
    expect(decrypted?.host).toBe('proxy2.example.com')
    expect(decrypted?.password).toBe('hunter2')
  })

  it('decrypts a saved default proxy password via getDecryptedDefaultProxy', () => {
    const store = new AppSettingsStore()
    store.setDefaultProxy({ type: 'socks5', host: 'h', port: 1, password: 'p4ss' })
    expect(store.getDecryptedDefaultProxy()?.password).toBe('p4ss')
  })

  it('returns undefined from getDecryptedDefaultProxy when no default proxy is set', () => {
    const store = new AppSettingsStore()
    expect(store.getDecryptedDefaultProxy()).toBeUndefined()
  })

  it('throws a wrapped SshError (not the raw native error) when decrypting a corrupted secret fails', () => {
    const store = new AppSettingsStore()
    store.setDefaultProxy({ type: 'socks5', host: 'h', port: 1, password: 'p4ss' })

    // Corrupt the on-disk ciphertext so decryptString's mock throws.
    const savedProxy = disks.get('app-settings')!.defaultProxy as { secretPassword: string }
    disks.get('app-settings')!.defaultProxy = { ...savedProxy, secretPassword: Buffer.from('not-encrypted').toString('base64') }

    expect(() => store.getDecryptedDefaultProxy()).toThrow(/Could not decrypt a saved secret/)
  })

  it('throws when encryption is unavailable and a proxy password is set', () => {
    const store = new AppSettingsStore()
    const spy = vi.spyOn(testHost, 'isEncryptionAvailable').mockReturnValueOnce(false)
    try {
      expect(() => store.setDefaultProxy({ type: 'http', host: 'h', port: 1, password: 'p' })).toThrow(
        /OS credential encryption is unavailable/
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('throws when encryption is unavailable and a saved proxy password needs decrypting', () => {
    const store = new AppSettingsStore()
    store.setDefaultProxy({ type: 'http', host: 'h', port: 1, password: 'p' })
    const spy = vi.spyOn(testHost, 'isEncryptionAvailable').mockReturnValueOnce(false)
    try {
      expect(() => store.getDecryptedDefaultProxy()).toThrow(/saved secrets cannot be decrypted/)
    } finally {
      spy.mockRestore()
    }
  })

  it('persists historyRetentionDays (including null for unlimited), termsAcceptance, and resets cleanly', () => {
    const store = new AppSettingsStore()
    store.setHistoryRetentionDays(30)
    const acceptance = store.acceptTerms('1.0')
    expect(acceptance.version).toBe('1.0')
    expect(new AppSettingsStore().get().historyRetentionDays).toBe(30)
    expect(new AppSettingsStore().get().termsAcceptance?.version).toBe('1.0')

    store.setHistoryRetentionDays(null)
    expect(new AppSettingsStore().get().historyRetentionDays).toBeNull()

    store.reset()
    expect(new AppSettingsStore().get().historyRetentionDays).toBe(90)
    expect(new AppSettingsStore().get().termsAcceptance).toBeNull()
  })

  it('persists uiPrefs across fresh instances, deletes null entries, and clears on reset', () => {
    const store = new AppSettingsStore()
    store.setUiPref('ferry:ui:glassUi', 'true')
    store.setUiPref('ferry:ui:glassUiPromoDismissed', 'true')
    expect(new AppSettingsStore().get().uiPrefs).toEqual({
      'ferry:ui:glassUi': 'true',
      'ferry:ui:glassUiPromoDismissed': 'true'
    })

    store.setUiPref('ferry:ui:glassUi', null)
    expect(new AppSettingsStore().get().uiPrefs).toEqual({
      'ferry:ui:glassUiPromoDismissed': 'true'
    })

    store.reset()
    expect(new AppSettingsStore().get().uiPrefs).toEqual({})
  })

  it('encrypts companion AI API keys at rest, preserves on omit, normalizes legacy providers, and wipes when disabled', () => {
    const store = new AppSettingsStore()
    const saved = store.setCompanionAiConfig({
      provider: 'gemini',
      endpoint: '',
      model: 'gemini-2.5-flash',
      apiKey: 'AIza-live-secret'
    })
    expect(saved).toEqual({
      provider: 'gemini',
      endpoint: 'https://generativelanguage.googleapis.com',
      model: 'gemini-4-hydrogen',
      hasApiKey: true
    })
    expect(JSON.stringify(disks.get('app-settings'))).not.toContain('AIza-live-secret')
    expect(store.getDecryptedCompanionAiConfig()?.apiKey).toBe('AIza-live-secret')

    // Omitting apiKey preserves the encrypted secret
    store.setCompanionAiConfig({
      provider: 'gemini',
      endpoint: 'https://generativelanguage.googleapis.com',
      model: 'gemini-4-argon'
    })
    expect(store.getDecryptedCompanionAiConfig()?.apiKey).toBe('AIza-live-secret')
    expect(store.getCompanionAiConfig().model).toBe('gemini-4-argon')

    // Switching provider with the key left blank must not carry the old provider's secret over
    const switched = store.setCompanionAiConfig({
      provider: 'ferry-pro',
      endpoint: 'https://proxy.ferry.example',
      model: 'gemini-4-hydrogen'
    })
    expect(switched.hasApiKey).toBe(false)
    expect(store.getDecryptedCompanionAiConfig()?.apiKey).toBeUndefined()

    // Legacy stored providers normalize safely to 'none'
    disks.get('app-settings')!.companionAi = {
      provider: 'ollama',
      endpoint: 'http://localhost:11434',
      model: 'llama3.2'
    }
    expect(store.getCompanionAiConfig()).toEqual({ provider: 'none', endpoint: '', model: '', hasApiKey: false })
    expect(store.getDecryptedCompanionAiConfig()).toBeNull()

    // Disabling AI wipes the stored secret completely
    store.setCompanionAiConfig({
      provider: 'ferry-pro',
      endpoint: 'https://proxy.ferry.example',
      model: 'gemini-4-hydrogen',
      apiKey: 'ferry-pro-secret'
    })
    const disabled = store.setCompanionAiConfig({ provider: 'none', endpoint: '', model: '' })
    expect(disabled).toEqual({ provider: 'none', endpoint: '', model: '', hasApiKey: false })
    expect(store.getDecryptedCompanionAiConfig()).toBeNull()
  })
})

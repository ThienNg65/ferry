import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `electron-store` is a real npm CJS package, externalized by vitest — its
 * own internal `require('electron')` call is NOT intercepted by
 * `vi.mock('electron', ...)` (confirmed empirically: it silently fell
 * through to `env-paths` and wrote real, ever-growing JSON files under
 * `%APPDATA%\electron-store-nodejs\Config\`). So instead of mocking
 * `electron` and letting the real `electron-store`/`conf` machinery run,
 * `electron-store` itself is mocked here with a minimal in-memory
 * implementation that mirrors the two methods `AppSettingsStore.ts` actually
 * uses (`get`/`set`), keyed by the `name` option so a fresh
 * `new AppSettingsStore()` reads back whatever a previous instance wrote —
 * exercising the same persistence-round-trip behavior without touching disk.
 * `safeStorage` is still mocked the same way as SiteStore.test.ts, since
 * AppSettingsStore imports it directly.
 */
const disks = new Map<string, Record<string, unknown>>()

vi.mock('electron-store', () => {
  class FakeStore {
    private readonly name: string
    constructor(opts: { name: string; defaults: Record<string, unknown> }) {
      this.name = opts.name
      if (!disks.has(this.name)) {
        disks.set(this.name, { ...opts.defaults })
      }
    }
    get(key: string): unknown {
      // Deep-clone on read/write, mirroring real electron-store/conf's
      // read-from-disk semantics — nothing here currently depends on it (unlike
      // HistoryStore's in-place array mutation), but it keeps this fake honest.
      return JSON.parse(JSON.stringify(disks.get(this.name)![key]))
    }
    set(key: string, value: unknown): void {
      disks.get(this.name)![key] = JSON.parse(JSON.stringify(value))
    }
  }
  return { default: FakeStore }
})

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: (plaintext: string) => Buffer.from(`ENC:${plaintext}`),
    decryptString: (buf: Buffer) => {
      const text = buf.toString()
      if (!text.startsWith('ENC:')) {
        throw new Error('bad ciphertext')
      }
      return text.replace(/^ENC:/, '')
    }
  }
}))

const { AppSettingsStore } = await import('./AppSettingsStore')
const { safeStorage } = await import('electron')

describe('AppSettingsStore', () => {
  beforeEach(() => {
    disks.clear()
  })

  it('defaults to empty tabs, unlimited bandwidth, and no default proxy', () => {
    const store = new AppSettingsStore()
    expect(store.get()).toEqual({ openTabSiteIds: [], bandwidthLimitKBps: null, defaultProxy: undefined })
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
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false)
    expect(() => store.setDefaultProxy({ type: 'http', host: 'h', port: 1, password: 'p' })).toThrow(
      /OS credential encryption is unavailable/
    )
  })

  it('throws when encryption is unavailable and a saved proxy password needs decrypting', () => {
    const store = new AppSettingsStore()
    store.setDefaultProxy({ type: 'http', host: 'h', port: 1, password: 'p' })
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false)
    expect(() => store.getDecryptedDefaultProxy()).toThrow(/saved secrets cannot be decrypted/)
  })
})

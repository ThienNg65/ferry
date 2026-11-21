import { describe, expect, it, vi } from 'vitest'

/**
 * Only `pickSecret` is exercised here — it's the pure decision function behind
 * the fix for a real credential-leak: switching a site away from password/
 * privateKey auth must clear the now-irrelevant secret, otherwise a stale
 * password could keep getting replayed into keyboard-interactive prompts
 * regardless of the site's configured auth method (see SessionManager.ts's
 * `openFromSite`). `conf` is mocked and `testHost` provides in-memory
 * encryption; `SiteStore.getInstance()` is never called.
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

const { pickSecret, SiteStore } = await import('./SiteStore')


describe('pickSecret', () => {
  it('clears the secret when the current auth method does not use it, even if one is provided', () => {
    expect(pickSecret(false, 'hunter2', undefined)).toBeUndefined()
  })

  it('clears the secret when the current auth method does not use it, even if one already existed', () => {
    expect(pickSecret(false, undefined, 'ENC:old-secret')).toBeUndefined()
  })

  it('keeps the existing encrypted value when the method uses it but no new value was provided', () => {
    expect(pickSecret(true, undefined, 'ENC:old-secret')).toBe('ENC:old-secret')
  })

  it('encrypts a newly provided value when the method uses it', () => {
    expect(pickSecret(true, 'hunter2', 'ENC:old-secret')).toBe(Buffer.from('ENC:hunter2').toString('base64'))
  })
})

describe('exportSites', () => {
  it('exports formatted JSON with schemaVersion, exportedAt, and sites list', () => {
    const store = SiteStore.getInstance()
    store.create({
      name: 'Prod Server',
      host: 'prod.example.com',
      port: 22,
      username: 'deploy',
      authMethod: 'password',
      password: 'secret-password'
    })

    const exportedJson = store.exportSites()
    const parsed = JSON.parse(exportedJson)

    expect(parsed.schemaVersion).toBe(1)
    expect(typeof parsed.exportedAt).toBe('string')
    expect(Array.isArray(parsed.sites)).toBe(true)
    expect(parsed.sites.length).toBeGreaterThan(0)

    const site = parsed.sites.find((s: any) => s.name === 'Prod Server')
    expect(site).toBeDefined()
    expect(site.host).toBe('prod.example.com')
    // Secrets must NOT be present in export
    expect(site.password).toBeUndefined()
    expect(site.secretPassword).toBeUndefined()
    expect(site.hasPassword).toBe(true)
  })

  it('preserves each jump hop encrypted secret across UI reorders using sourceIndex', () => {
    const store = SiteStore.getInstance()
    const created = store.create({
      name: 'Jump Chain',
      host: 'target.example.com',
      port: 22,
      username: 'app',
      authMethod: 'agent',
      jumpHosts: [
        { host: 'hop0.example.com', port: 22, username: 'u0', authMethod: 'password', password: 'pw0' },
        { host: 'hop1.example.com', port: 22, username: 'u1', authMethod: 'password', password: 'pw1' }
      ]
    })

    // Swap hop 1 and hop 0 without re-entering passwords, passing sourceIndex
    store.update(created.id, {
      name: 'Jump Chain',
      host: 'target.example.com',
      port: 22,
      username: 'app',
      authMethod: 'agent',
      jumpHosts: [
        { host: 'hop1.example.com', port: 22, username: 'u1', authMethod: 'password', sourceIndex: 1 },
        { host: 'hop0.example.com', port: 22, username: 'u0', authMethod: 'password', sourceIndex: 0 }
      ]
    })

    const decrypted = store.getDecryptedJumpHosts(created.id)
    expect(decrypted.map((h) => [h.host, h.password])).toEqual([
      ['hop1.example.com', 'pw1'],
      ['hop0.example.com', 'pw0']
    ])

    // Deleting hop 1 and adding a new hop at index 1 with sourceIndex: -1 must NOT inherit old pw1
    store.update(created.id, {
      name: 'Jump Chain',
      host: 'target.example.com',
      port: 22,
      username: 'app',
      authMethod: 'agent',
      jumpHosts: [
        { host: 'hop1.example.com', port: 22, username: 'u1', authMethod: 'password', sourceIndex: 0 },
        { host: 'brand-new.example.com', port: 22, username: 'unew', authMethod: 'password', sourceIndex: -1 }
      ]
    })

    const afterReplace = store.getDecryptedJumpHosts(created.id)
    expect(afterReplace.map((h) => [h.host, h.password])).toEqual([
      ['hop1.example.com', 'pw1'],
      ['brand-new.example.com', undefined]
    ])
  })
})

import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { safeStorage } from 'electron'
import { SshError } from '../ssh/errors'
import type { AuthMethod, JumpHostConfig, JumpHostInfo, ProxyConfig, ProxyInfo, Site, SiteInput } from '../../shared/contract'

/** On-disk shape of a saved jump-host hop — secrets encrypted-at-rest like the top-level site. */
interface StoredJumpHost {
  host: string
  port: number
  username: string
  authMethod: 'password' | 'privateKey'
  privateKeyPath?: string
  secretPassword?: string
  secretPassphrase?: string
}

/** On-disk shape of a saved per-site proxy override — secret encrypted-at-rest like every other credential here. */
interface StoredProxy {
  type: 'socks5' | 'http'
  host: string
  port: number
  username?: string
  secretPassword?: string
}

/** On-disk shape of a saved site — secrets are encrypted-at-rest, never plaintext. */
interface StoredSite {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  privateKeyPath?: string
  agentPath?: string
  remoteInitialPath?: string
  localInitialPath?: string
  /** Base64 ciphertext from `safeStorage.encryptString`. */
  secretPassword?: string
  /** Base64 ciphertext from `safeStorage.encryptString`. */
  secretPassphrase?: string
  jumpHosts?: StoredJumpHost[]
  /** Legacy single-hop field from before multi-hop chaining — only ever read (see `storedJumpHosts` below), never written by current code. */
  jumpHost?: StoredJumpHost
  proxyMode?: 'inherit' | 'none' | 'custom'
  proxy?: StoredProxy
  group?: string
  createdAt: string
  updatedAt: string
}

/** Reads a site's jump-host chain, tolerating an old on-disk record that still only has the legacy singular `jumpHost` field (no migration script — just a defensive read fallback, matching this store's existing tolerant style). */
function storedJumpHosts(s: Pick<StoredSite, 'jumpHosts' | 'jumpHost'>): StoredJumpHost[] {
  return s.jumpHosts ?? (s.jumpHost ? [s.jumpHost] : [])
}

interface StoreSchema {
  sites: StoredSite[]
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
 * Retains a secret only when the current auth method actually uses it —
 * otherwise returns `undefined` (clearing it) even if an old encrypted value
 * exists. Without this, switching a site from password auth to privateKey/agent
 * would leave the stale password ciphertext in the store forever, and
 * `SessionManager`'s keyboard-interactive auto-answer would keep replaying it
 * into any prompt matching `/password/i` regardless of the site's configured
 * auth method.
 */
export function pickSecret(wants: boolean, provided: string | undefined, existing: string | undefined): string | undefined {
  if (!wants) {
    return undefined
  }
  return provided !== undefined ? encrypt(provided) : existing
}

function toPublicJumpHost(j: StoredJumpHost): JumpHostInfo {
  return {
    host: j.host,
    port: j.port,
    username: j.username,
    authMethod: j.authMethod,
    privateKeyPath: j.privateKeyPath,
    hasPassword: Boolean(j.secretPassword),
    hasPassphrase: Boolean(j.secretPassphrase)
  }
}

function toStoredJumpHost(j: JumpHostConfig, existing?: StoredJumpHost): StoredJumpHost {
  return {
    host: j.host,
    port: j.port,
    username: j.username,
    authMethod: j.authMethod,
    privateKeyPath: j.privateKeyPath,
    secretPassword: pickSecret(j.authMethod === 'password', j.password, existing?.secretPassword),
    secretPassphrase: pickSecret(j.authMethod === 'privateKey', j.passphrase, existing?.secretPassphrase)
  }
}

/**
 * Maps an incoming jump-host chain to its stored form, matching each hop to
 * the existing hop at the same array index so an unchanged password/
 * passphrase is preserved rather than cleared (`pickSecret`'s usual
 * behavior). Reordering hops in the UI can momentarily attach the wrong
 * stored secret to the wrong hop for one save round-trip — an accepted,
 * documented risk, not a correctness bug: the user re-enters the secret if a
 * save happens to land oddly, same as any other stale-secret edge case here.
 */
function toStoredJumpHosts(hops: JumpHostConfig[], existing: StoredJumpHost[]): StoredJumpHost[] {
  return hops.map((hop, i) => toStoredJumpHost(hop, existing[i]))
}

function toPublicProxy(p: StoredProxy): ProxyInfo {
  return {
    type: p.type,
    host: p.host,
    port: p.port,
    username: p.username,
    hasPassword: Boolean(p.secretPassword)
  }
}

function toStoredProxy(p: ProxyConfig, existing?: StoredProxy): StoredProxy {
  return {
    type: p.type,
    host: p.host,
    port: p.port,
    username: p.username,
    // A proxy always uses its password (no auth-method branch to gate on,
    // unlike sites/jump-hosts) — `wants` is unconditionally true.
    secretPassword: pickSecret(true, p.password, existing?.secretPassword)
  }
}

function toPublicSite(s: StoredSite): Site {
  return {
    id: s.id,
    name: s.name,
    host: s.host,
    port: s.port,
    username: s.username,
    authMethod: s.authMethod,
    privateKeyPath: s.privateKeyPath,
    agentPath: s.agentPath,
    remoteInitialPath: s.remoteInitialPath,
    localInitialPath: s.localInitialPath,
    hasPassword: Boolean(s.secretPassword),
    hasPassphrase: Boolean(s.secretPassphrase),
    jumpHosts: storedJumpHosts(s).length > 0 ? storedJumpHosts(s).map(toPublicJumpHost) : undefined,
    proxyMode: s.proxyMode,
    proxy: s.proxy ? toPublicProxy(s.proxy) : undefined,
    group: s.group,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt
  }
}

/**
 * Persists saved connection profiles to `sites.json` under the OS userData
 * directory. Secrets are encrypted with Electron's `safeStorage` (DPAPI-backed
 * on Windows) and only ever decrypted in-process at connect-time — the
 * renderer receives `hasPassword`/`hasPassphrase` booleans, never plaintext.
 */
export class SiteStore {
  private static instance: SiteStore | null = null
  private readonly store = new Store<StoreSchema>({ name: 'sites', defaults: { sites: [] } })

  static getInstance(): SiteStore {
    if (SiteStore.instance === null) {
      SiteStore.instance = new SiteStore()
    }
    return SiteStore.instance
  }

  list(): Site[] {
    return this.store.get('sites').map(toPublicSite)
  }

  create(input: SiteInput): Site {
    const now = new Date().toISOString()
    const stored: StoredSite = {
      id: randomUUID(),
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      authMethod: input.authMethod,
      privateKeyPath: input.privateKeyPath,
      agentPath: input.agentPath,
      remoteInitialPath: input.remoteInitialPath,
      localInitialPath: input.localInitialPath,
      secretPassword: pickSecret(input.authMethod === 'password', input.password, undefined),
      secretPassphrase: pickSecret(input.authMethod === 'privateKey', input.passphrase, undefined),
      jumpHosts: input.jumpHosts ? toStoredJumpHosts(input.jumpHosts, []) : undefined,
      proxyMode: input.proxyMode,
      proxy: input.proxyMode === 'custom' && input.proxy ? toStoredProxy(input.proxy) : undefined,
      group: input.group || undefined,
      createdAt: now,
      updatedAt: now
    }
    const sites = this.store.get('sites')
    sites.push(stored)
    this.store.set('sites', sites)
    return toPublicSite(stored)
  }

  update(id: string, input: SiteInput): Site {
    const sites = this.store.get('sites')
    const idx = sites.findIndex((s) => s.id === id)
    if (idx === -1) {
      throw new SshError('NOT_FOUND', `Site ${id} not found`)
    }
    const existing = sites[idx]
    const updated: StoredSite = {
      ...existing,
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      authMethod: input.authMethod,
      privateKeyPath: input.privateKeyPath,
      agentPath: input.agentPath,
      remoteInitialPath: input.remoteInitialPath,
      localInitialPath: input.localInitialPath,
      secretPassword: pickSecret(input.authMethod === 'password', input.password, existing.secretPassword),
      secretPassphrase: pickSecret(input.authMethod === 'privateKey', input.passphrase, existing.secretPassphrase),
      jumpHosts: input.jumpHosts ? toStoredJumpHosts(input.jumpHosts, storedJumpHosts(existing)) : undefined,
      // Clear the legacy singular field once the site is saved under the new
      // array shape, so `storedJumpHosts()`'s fallback never resurrects a
      // stale single hop alongside (or in place of) the current chain.
      jumpHost: undefined,
      proxyMode: input.proxyMode,
      proxy: input.proxyMode === 'custom' && input.proxy ? toStoredProxy(input.proxy, existing.proxy) : undefined,
      group: input.group || undefined,
      updatedAt: new Date().toISOString()
    }
    sites[idx] = updated
    this.store.set('sites', sites)
    return toPublicSite(updated)
  }

  delete(id: string): void {
    const sites = this.store.get('sites').filter((s) => s.id !== id)
    this.store.set('sites', sites)
  }

  /** Clones a saved site (new id/name/timestamps) — encrypted secrets are copied as-is, no re-encryption needed. */
  duplicate(id: string): Site {
    const sites = this.store.get('sites')
    const existing = sites.find((s) => s.id === id)
    if (!existing) {
      throw new SshError('NOT_FOUND', `Site ${id} not found`)
    }
    const now = new Date().toISOString()
    const copy: StoredSite = {
      ...existing,
      id: randomUUID(),
      name: `${existing.name} copy`,
      createdAt: now,
      updatedAt: now
    }
    sites.push(copy)
    this.store.set('sites', sites)
    return toPublicSite(copy)
  }

  /** Raw stored record (still has ciphertext, not decrypted) — main-process only. */
  getRaw(id: string): StoredSite | undefined {
    return this.store.get('sites').find((s) => s.id === id)
  }

  /** Decrypts a site's secrets for connecting. Never returned to the renderer. */
  getDecryptedSecrets(id: string): { password?: string; passphrase?: string } {
    const site = this.getRaw(id)
    if (!site) {
      throw new SshError('NOT_FOUND', `Site ${id} not found`)
    }
    return { password: decrypt(site.secretPassword), passphrase: decrypt(site.secretPassphrase) }
  }

  /**
   * A site's jump-host chain, fully hydrated with decrypted secrets and
   * ready to hand straight to `SessionManager.connect()`. Tolerates a
   * pre-multi-hop on-disk record that still only has the legacy singular
   * `jumpHost` field (via `storedJumpHosts`'s fallback). Never returned to
   * the renderer — main-process only, at connect-time.
   */
  getDecryptedJumpHosts(id: string): JumpHostConfig[] {
    const site = this.getRaw(id)
    if (!site) {
      return []
    }
    return storedJumpHosts(site).map((j) => ({
      host: j.host,
      port: j.port,
      username: j.username,
      authMethod: j.authMethod,
      privateKeyPath: j.privateKeyPath,
      password: j.authMethod === 'password' ? decrypt(j.secretPassword) : undefined,
      passphrase: j.authMethod === 'privateKey' ? decrypt(j.secretPassphrase) : undefined
    }))
  }

  /**
   * A site's own custom proxy override, fully hydrated with its decrypted
   * password — only present when `proxyMode === 'custom'`. Resolving
   * `'inherit'` against the app-wide default is the caller's job (see
   * `SessionManager.connect()`), not this store's. Never returned to the
   * renderer — main-process only, at connect-time.
   */
  getDecryptedProxy(id: string): ProxyConfig | undefined {
    const site = this.getRaw(id)
    if (!site?.proxy || site.proxyMode !== 'custom') {
      return undefined
    }
    return {
      type: site.proxy.type,
      host: site.proxy.host,
      port: site.proxy.port,
      username: site.proxy.username,
      password: decrypt(site.proxy.secretPassword)
    }
  }
}

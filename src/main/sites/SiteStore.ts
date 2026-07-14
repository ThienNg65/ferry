import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { safeStorage } from 'electron'
import { SshError } from '../ssh/errors'
import type { AuthMethod, JumpHostConfig, JumpHostInfo, Site, SiteInput } from '../../shared/contract'

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
  jumpHost?: StoredJumpHost
  group?: string
  createdAt: string
  updatedAt: string
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
    jumpHost: s.jumpHost ? toPublicJumpHost(s.jumpHost) : undefined,
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
      jumpHost: input.jumpHost ? toStoredJumpHost(input.jumpHost) : undefined,
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
      jumpHost: input.jumpHost ? toStoredJumpHost(input.jumpHost, existing.jumpHost) : undefined,
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

  /** Decrypts a site's jump-host secrets, if it has one configured. Never returned to the renderer. */
  getDecryptedJumpHostSecrets(id: string): { password?: string; passphrase?: string } | undefined {
    const site = this.getRaw(id)
    if (!site?.jumpHost) {
      return undefined
    }
    return { password: decrypt(site.jumpHost.secretPassword), passphrase: decrypt(site.jumpHost.secretPassphrase) }
  }
}

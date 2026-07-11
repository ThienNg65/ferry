import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { safeStorage } from 'electron'
import { SshError } from '../ssh/errors'
import type { AuthMethod, Site, SiteInput } from '../../shared/contract'

/** On-disk shape of a saved site — secrets are encrypted-at-rest, never plaintext. */
interface StoredSite {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  privateKeyPath?: string
  remoteInitialPath?: string
  localInitialPath?: string
  /** Base64 ciphertext from `safeStorage.encryptString`. */
  secretPassword?: string
  /** Base64 ciphertext from `safeStorage.encryptString`. */
  secretPassphrase?: string
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

function toPublicSite(s: StoredSite): Site {
  return {
    id: s.id,
    name: s.name,
    host: s.host,
    port: s.port,
    username: s.username,
    authMethod: s.authMethod,
    privateKeyPath: s.privateKeyPath,
    remoteInitialPath: s.remoteInitialPath,
    localInitialPath: s.localInitialPath,
    hasPassword: Boolean(s.secretPassword),
    hasPassphrase: Boolean(s.secretPassphrase),
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
      remoteInitialPath: input.remoteInitialPath,
      localInitialPath: input.localInitialPath,
      secretPassword: encrypt(input.password),
      secretPassphrase: encrypt(input.passphrase),
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
      remoteInitialPath: input.remoteInitialPath,
      localInitialPath: input.localInitialPath,
      secretPassword: input.password !== undefined ? encrypt(input.password) : existing.secretPassword,
      secretPassphrase:
        input.passphrase !== undefined ? encrypt(input.passphrase) : existing.secretPassphrase,
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
}

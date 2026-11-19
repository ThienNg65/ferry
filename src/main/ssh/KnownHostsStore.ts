import Conf from 'conf'
import { createHash } from 'crypto'
import { host } from '../host/host'
import type { KnownHostEntry } from '../../shared/contract'

interface StoreSchema {
  /** `"host:port"` -> the OpenSSH-style `SHA256:...` fingerprint last trusted for it. */
  hosts: Record<string, string>
}

/** OpenSSH-style fingerprint (`SHA256:<base64, no padding>`) of a raw host public key blob. */
export function fingerprintHostKey(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

/** What a host-key check against a stored fingerprint decided, before any I/O happens. */
export type HostKeyDecision = 'trust-new' | 'match' | 'mismatch'

/**
 * Pure decision function behind host-key verification (trust-on-first-use).
 *
 * - No fingerprint on file yet -> `trust-new` (first-ever connection to this host:port).
 * - Matches what's on file -> `match`.
 * - Differs, and the caller didn't explicitly ask to trust the change -> `mismatch`
 *   (a real MITM signal, or a legitimately reinstalled server — the caller decides which).
 * - Differs, but the caller explicitly opted in (`forceTrust`, e.g. a user clicking
 *   "trust new key" after being warned) -> `trust-new` (overwrite).
 */
export function evaluateHostKey(
  knownFingerprint: string | undefined,
  presentedFingerprint: string,
  forceTrust: boolean
): HostKeyDecision {
  if (!knownFingerprint) {
    return 'trust-new'
  }
  if (knownFingerprint === presentedFingerprint) {
    return 'match'
  }
  return forceTrust ? 'trust-new' : 'mismatch'
}

/**
 * Persists the fingerprint of every SSH host key Ferry has ever trusted, one
 * per `host:port`, to `known_hosts.json` under the OS userData directory —
 * Ferry's equivalent of OpenSSH's `~/.ssh/known_hosts`, minus the ability to
 * hold multiple key types per host (not needed: ssh2 always negotiates one).
 */
export class KnownHostsStore {
  private static instance: KnownHostsStore | null = null
  private _store: Conf<StoreSchema> | null = null

  private get store(): Conf<StoreSchema> {
    if (!this._store) {
      this._store = new Conf<StoreSchema>({ cwd: host().dataDir, configName: 'known_hosts', defaults: { hosts: {} } })
    }
    return this._store
  }

  static getInstance(): KnownHostsStore {
    if (KnownHostsStore.instance === null) {
      KnownHostsStore.instance = new KnownHostsStore()
    }
    return KnownHostsStore.instance
  }

  private key(host: string, port: number): string {
    return `${host.trim().toLowerCase()}:${port}`
  }

  get(host: string, port: number): string | undefined {
    const hosts = this.store.get('hosts')
    const normalized = this.key(host, port)
    if (hosts[normalized] !== undefined) {
      return hosts[normalized]
    }
    const legacy = Object.entries(hosts).find(([k]) => k.toLowerCase() === normalized)
    return legacy?.[1]
  }

  trust(host: string, port: number, fingerprint: string): void {
    const hosts = this.store.get('hosts')
    const normalized = this.key(host, port)
    for (const k of Object.keys(hosts)) {
      if (k !== normalized && k.toLowerCase() === normalized) {
        delete hosts[k]
      }
    }
    hosts[normalized] = fingerprint
    this.store.set('hosts', hosts)
  }

  /** Lists all stored host-key fingerprints sorted by `host:port`. */
  list(): KnownHostEntry[] {
    const hosts = this.store.get('hosts')
    return Object.entries(hosts)
      .map(([hostPort, fingerprint]) => ({ hostPort, fingerprint }))
      .sort((a, b) => a.hostPort.localeCompare(b.hostPort))
  }

  /** Removes a stored fingerprint by `host:port`. */
  forget(host: string, port: number): void {
    this.forgetKey(this.key(host, port))
  }

  forgetKey(hostPort: string): void {
    const hosts = this.store.get('hosts')
    delete hosts[hostPort]
    this.store.set('hosts', hosts)
  }

  clear(): void {
    this.store.set('hosts', {})
  }
}

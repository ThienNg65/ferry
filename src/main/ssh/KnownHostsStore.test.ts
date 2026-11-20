import { beforeEach, describe, expect, it, vi } from 'vitest'

const disks = new Map<string, string>()

vi.mock('conf', () => ({
  default: class FakeConf<T extends Record<string, unknown>> {
    private key: string
    constructor(opts: { configName?: string; defaults?: T }) {
      this.key = opts.configName ?? 'known_hosts'
      if (!disks.has(this.key)) disks.set(this.key, JSON.stringify(opts.defaults ?? {}))
    }
    get<K extends keyof T>(k: K): T[K] {
      return (JSON.parse(disks.get(this.key)!) as T)[k]
    }
    set<K extends keyof T>(k: K, v: T[K]): void {
      const d = JSON.parse(disks.get(this.key)!) as T
      d[k] = v
      disks.set(this.key, JSON.stringify(d))
    }
  }
}))

const { evaluateHostKey, fingerprintHostKey, KnownHostsStore } = await import('./KnownHostsStore')

describe('fingerprintHostKey', () => {
  it('produces a stable OpenSSH-style SHA256 fingerprint with no base64 padding', () => {
    const key = Buffer.from('some fake host key bytes')
    const fp = fingerprintHostKey(key)
    expect(fp.startsWith('SHA256:')).toBe(true)
    expect(fp).not.toContain('=')
    expect(fingerprintHostKey(key)).toBe(fp)
  })

  it('produces different fingerprints for different keys', () => {
    expect(fingerprintHostKey(Buffer.from('key-a'))).not.toBe(fingerprintHostKey(Buffer.from('key-b')))
  })
})

describe('evaluateHostKey', () => {
  it('trusts a never-seen host (TOFU)', () => {
    expect(evaluateHostKey(undefined, 'SHA256:new', false)).toBe('trust-new')
  })

  it('matches an identical fingerprint', () => {
    expect(evaluateHostKey('SHA256:abc', 'SHA256:abc', false)).toBe('match')
  })

  it('flags a changed fingerprint as a mismatch when not force-trusted', () => {
    expect(evaluateHostKey('SHA256:abc', 'SHA256:def', false)).toBe('mismatch')
  })

  it('treats a changed fingerprint as trust-new when the caller force-trusts it', () => {
    expect(evaluateHostKey('SHA256:abc', 'SHA256:def', true)).toBe('trust-new')
  })

  it('force-trust on an already-matching fingerprint is still just a match, not re-trust', () => {
    // Not load-bearing behavior either way, but documents that forceTrust only
    // matters when there's an actual mismatch to override.
    expect(evaluateHostKey('SHA256:abc', 'SHA256:abc', true)).toBe('match')
  })
})

describe('KnownHostsStore', () => {
  beforeEach(() => {
    disks.clear()
  })

  it('lists sorted entries, forgets by key, and clears all entries', () => {
    const store = new KnownHostsStore()
    store.trust('b.example.com', 22, 'SHA256:bbb')
    store.trust('a.example.com', 2222, 'SHA256:aaa')

    expect(store.list()).toEqual([
      { hostPort: 'a.example.com:2222', fingerprint: 'SHA256:aaa' },
      { hostPort: 'b.example.com:22', fingerprint: 'SHA256:bbb' }
    ])

    store.forgetKey('a.example.com:2222')
    expect(store.list()).toEqual([{ hostPort: 'b.example.com:22', fingerprint: 'SHA256:bbb' }])

    store.clear()
    expect(store.list()).toEqual([])
  })

  it('normalizes hostnames case-insensitively on get and trust', () => {
    const store = new KnownHostsStore()
    store.trust('Prod.Example.COM', 22, 'SHA256:prod')
    expect(store.get('prod.example.com', 22)).toBe('SHA256:prod')
    expect(store.list()).toEqual([{ hostPort: 'prod.example.com:22', fingerprint: 'SHA256:prod' }])
  })
})

import { describe, expect, it } from 'vitest'
import { evaluateHostKey, fingerprintHostKey } from './KnownHostsStore'

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

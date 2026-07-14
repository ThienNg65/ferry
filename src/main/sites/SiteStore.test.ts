import { describe, expect, it, vi } from 'vitest'

/**
 * Only `pickSecret` is exercised here — it's the pure decision function behind
 * the fix for a real credential-leak: switching a site away from password/
 * privateKey auth must clear the now-irrelevant secret, otherwise a stale
 * password could keep getting replayed into keyboard-interactive prompts
 * regardless of the site's configured auth method (see SessionManager.ts's
 * `openFromSite`). `safeStorage` is mocked so importing SiteStore.ts never
 * touches a real Electron runtime; `SiteStore.getInstance()` (which would
 * touch real on-disk config) is never called.
 */
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`ENC:${plaintext}`),
    decryptString: (buf: Buffer) => buf.toString().replace(/^ENC:/, '')
  }
}))

const { pickSecret } = await import('./SiteStore')


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

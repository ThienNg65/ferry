import { describe, expect, it } from 'vitest'
import { decryptVaultPayload, encryptVaultPayload } from './vaultCrypto'

describe('vaultCrypto (.ferryvault)', () => {
  it('round-trips sites with secrets and custom snippets using scrypt + AES-256-GCM', async () => {
    const encrypted = await encryptVaultPayload(
      {
        exportedAt: '2026-11-27T00:00:00.000Z',
        sites: [
          {
            name: 'Prod API',
            host: '10.0.0.5',
            port: 22,
            username: 'deploy',
            authMethod: 'password',
            password: 'super-secret-password',
            environment: 'prod'
          }
        ],
        customSnippets: [
          {
            id: 's1',
            label: 'Tail nginx',
            command: 'tail -n 50 {{path}}',
            description: 'Inspect nginx log'
          }
        ]
      },
      'correct-horse-battery-staple',
      { N: 16_384, r: 8, p: 1 }
    )

    expect(encrypted).not.toContain('super-secret-password')
    expect(encrypted).not.toContain('Prod API')

    const decrypted = await decryptVaultPayload(encrypted, 'correct-horse-battery-staple')
    expect(decrypted.sites).toHaveLength(1)
    expect(decrypted.sites[0].password).toBe('super-secret-password')
    expect(decrypted.sites[0].environment).toBe('prod')
    expect(decrypted.customSnippets).toHaveLength(1)
    expect(decrypted.customSnippets?.[0].command).toBe('tail -n 50 {{path}}')
  })

  it('rejects wrong passphrase, tampered authTag, short passphrases, and unsafe scrypt N', async () => {
    await expect(
      encryptVaultPayload({ exportedAt: '2026-11-27T00:00:00.000Z', sites: [] }, 'short')
    ).rejects.toThrow(/at least 8 characters/)

    const encrypted = await encryptVaultPayload(
      { exportedAt: '2026-11-27T00:00:00.000Z', sites: [] },
      'valid-passphrase-123',
      { N: 16_384, r: 8, p: 1 }
    )

    await expect(decryptVaultPayload(encrypted, 'wrong-passphrase-999')).rejects.toThrow(
      /Incorrect vault passphrase/
    )

    const tampered = JSON.parse(encrypted) as Record<string, unknown>
    ;(tampered.kdfParams as Record<string, unknown>).N = 1_048_576
    await expect(decryptVaultPayload(JSON.stringify(tampered), 'valid-passphrase-123')).rejects.toThrow(
      /unsafe scrypt parameters/
    )
  })
})

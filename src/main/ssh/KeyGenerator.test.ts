import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { execFileSync, spawnSync } from 'child_process'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateBuiltin, generateEd25519KeyPair } from './KeyGenerator'

/** Whether a real `ssh-keygen` is on PATH — several tests here cross-validate against it directly rather than just asserting on our own encoder's self-consistency. */
function hasSshKeygen(): boolean {
  return spawnSync('ssh-keygen', ['-y', '-f', '/dev/null']).error === undefined
}

let tmpDir: string | undefined

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('generateEd25519KeyPair', () => {
  it('rejects when the target path already exists, before attempting anything else', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ferry-keygen-${randomUUID()}-`))
    const keyPath = path.join(tmpDir, 'id_ed25519')
    await fs.writeFile(keyPath, 'not a real key')

    await expect(generateEd25519KeyPair({ keyPath })).rejects.toThrow(/already exists/i)
  })

  it.skipIf(!hasSshKeygen())('generates a real keypair via the system ssh-keygen', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ferry-keygen-${randomUUID()}-`))
    const keyPath = path.join(tmpDir, 'id_ed25519')

    const result = await generateEd25519KeyPair({ keyPath, comment: 'ferry-test' })

    expect(result.method).toBe('ssh-keygen')
    expect(result.publicKey).toMatch(/^ssh-ed25519 /)
    await expect(fs.access(result.privateKeyPath)).resolves.toBeUndefined()
    await expect(fs.access(result.publicKeyPath)).resolves.toBeUndefined()

    // Prove it's a genuinely usable key, not just two files that exist.
    const fingerprint = execFileSync('ssh-keygen', ['-l', '-f', result.privateKeyPath], { encoding: 'utf-8' })
    expect(fingerprint).toContain('ED25519')
  })
})

describe('generateBuiltin', () => {
  it('produces a private key file with the correct OpenSSH structure', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ferry-keygen-builtin-${randomUUID()}-`))
    const keyPath = path.join(tmpDir, 'id_ed25519')

    const result = await generateBuiltin({ keyPath, comment: 'ferry-builtin-test' })

    expect(result.method).toBe('builtin')
    const pem = await fs.readFile(result.privateKeyPath, 'utf-8')
    expect(pem).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n/)
    expect(pem.trim()).toMatch(/-----END OPENSSH PRIVATE KEY-----$/)
    expect(result.publicKey).toBe(`ssh-ed25519 ${result.publicKey.split(' ')[1]} ferry-builtin-test`)
  })

  it.skipIf(!hasSshKeygen())(
    'produces a key that real ssh-keygen can parse, deriving the identical public key and a valid fingerprint',
    async () => {
      // This is the load-bearing test for the hand-rolled openssh-key-v1 encoder
      // (PROTOCOL.key) in KeyGenerator.ts — it was cross-validated against a real
      // ssh-keygen during development; this test pins that behavior so a future
      // change to the byte layout can't silently produce an unusable key.
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ferry-keygen-builtin-${randomUUID()}-`))
      const keyPath = path.join(tmpDir, 'id_ed25519')

      const result = await generateBuiltin({ keyPath, comment: 'ferry-builtin-crossvalidate' })

      const derivedPublic = execFileSync('ssh-keygen', ['-y', '-f', result.privateKeyPath], { encoding: 'utf-8' }).trim()
      expect(derivedPublic).toBe(result.publicKey)

      const fingerprint = execFileSync('ssh-keygen', ['-l', '-f', result.privateKeyPath], { encoding: 'utf-8' })
      expect(fingerprint).toContain('256')
      expect(fingerprint).toContain('ED25519')
    }
  )

  it('rejects a requested passphrase rather than silently generating an unprotected key, when ssh-keygen is unavailable', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ferry-keygen-nopass-${randomUUID()}-`))
    const keyPath = path.join(tmpDir, 'id_ed25519')

    // Force the "ssh-keygen not found" path deterministically (regardless of
    // whether this machine actually has one on PATH) by pointing the spawn at
    // a command name that can't possibly exist.
    await expect(
      generateEd25519KeyPair({ keyPath, passphrase: 'hunter2' }, 'definitely-not-a-real-command-xyz')
    ).rejects.toThrow(/passphrase/i)
  })
})

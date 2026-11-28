import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'crypto'
import type { SiteInput } from '../../shared/contract'
import { SshError } from '../ssh/errors'
import { parseSitesBackup } from './sitesBackup'

export const FERRY_VAULT_FORMAT = 'ferry-vault'
export const FERRY_VAULT_VERSION = 1
const VAULT_AAD = Buffer.from('ferry-vault-v1', 'utf8')

/** OWASP Password Storage Cheat Sheet scrypt baseline: N=2^17 (131072), r=8, p=1 (~128 MiB). */
const DEFAULT_SCRYPT_N = 131_072
const DEFAULT_SCRYPT_R = 8
const DEFAULT_SCRYPT_P = 1
const KEY_LEN = 32
const MAX_SCRYPT_MEM_BYTES = 256 * 1024 * 1024
const MIN_PASSPHRASE_LENGTH = 8

export interface FerryVaultSnippet {
  id: string
  label: string
  command: string
  description: string
}

export interface FerryVaultPayload {
  exportedAt: string
  appVersion?: string
  sites: SiteInput[]
  customSnippets?: FerryVaultSnippet[]
}

export interface FerryVaultEnvelope {
  format: typeof FERRY_VAULT_FORMAT
  version: typeof FERRY_VAULT_VERSION
  kdf: 'scrypt'
  kdfParams: { N: number; r: number; p: number; keyLen: number }
  salt: string
  cipher: 'aes-256-gcm'
  iv: string
  authTag: string
  ciphertext: string
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0
}

function deriveKeyScrypt(
  passphrase: string,
  salt: Buffer,
  params: { N: number; r: number; p: number; keyLen: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      passphrase,
      salt,
      params.keyLen,
      { N: params.N, r: params.r, p: params.p, maxmem: MAX_SCRYPT_MEM_BYTES },
      (err, derived) => {
        if (err) reject(err)
        else resolve(derived)
      }
    )
  })
}

/**
 * Encrypts a Ferry vault payload (sites including secrets + custom snippets) into a portable
 * passphrase-protected `.ferryvault` JSON envelope using OWASP baseline `scrypt` + `AES-256-GCM`.
 */
export async function encryptVaultPayload(
  payload: FerryVaultPayload,
  passphrase: string,
  kdfOverride?: { N?: number; r?: number; p?: number }
): Promise<string> {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new SshError('VALIDATION', `Vault passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`)
  }
  const N = kdfOverride?.N ?? DEFAULT_SCRYPT_N
  const r = kdfOverride?.r ?? DEFAULT_SCRYPT_R
  const p = kdfOverride?.p ?? DEFAULT_SCRYPT_P
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveKeyScrypt(passphrase, salt, { N, r, p, keyLen: KEY_LEN })

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(VAULT_AAD)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  const envelope: FerryVaultEnvelope = {
    format: FERRY_VAULT_FORMAT,
    version: FERRY_VAULT_VERSION,
    kdf: 'scrypt',
    kdfParams: { N, r, p, keyLen: KEY_LEN },
    salt: salt.toString('base64'),
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
  return JSON.stringify(envelope, null, 2)
}

/**
 * Validates and decrypts a `.ferryvault` envelope, enforcing strict scrypt parameter bounds
 * to prevent DoS/OOM from tampered files and validating decrypted site schemas.
 */
export async function decryptVaultPayload(rawText: string, passphrase: string): Promise<FerryVaultPayload> {
  if (!passphrase) {
    throw new SshError('VALIDATION', 'Vault passphrase is required')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new SshError('VALIDATION', 'Vault file is not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SshError('VALIDATION', 'Invalid .ferryvault envelope')
  }
  const env = parsed as Record<string, unknown>
  if (env.format !== FERRY_VAULT_FORMAT || env.version !== FERRY_VAULT_VERSION) {
    throw new SshError('VALIDATION', 'Unsupported .ferryvault format or version')
  }
  if (env.kdf !== 'scrypt' || env.cipher !== 'aes-256-gcm') {
    throw new SshError('VALIDATION', 'Unsupported .ferryvault cipher or KDF')
  }
  const kdf = env.kdfParams as Record<string, unknown> | undefined
  const N = Number(kdf?.N)
  const r = Number(kdf?.r)
  const p = Number(kdf?.p)
  const keyLen = Number(kdf?.keyLen)
  if (
    !isPowerOfTwo(N) ||
    N < 16_384 ||
    N > 262_144 ||
    !Number.isInteger(r) ||
    r < 1 ||
    r > 16 ||
    !Number.isInteger(p) ||
    p < 1 ||
    p > 8 ||
    keyLen !== KEY_LEN ||
    128 * r * (N + p + 2) > MAX_SCRYPT_MEM_BYTES
  ) {
    throw new SshError('VALIDATION', 'Invalid or unsafe scrypt parameters in .ferryvault file')
  }

  const salt = Buffer.from(String(env.salt ?? ''), 'base64')
  const iv = Buffer.from(String(env.iv ?? ''), 'base64')
  const authTag = Buffer.from(String(env.authTag ?? ''), 'base64')
  const ciphertext = Buffer.from(String(env.ciphertext ?? ''), 'base64')
  if (salt.length < 16 || iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new SshError('VALIDATION', 'Corrupted .ferryvault cryptographic parameters')
  }

  const key = await deriveKeyScrypt(passphrase, salt, { N, r, p, keyLen })
  let plaintext: string
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(VAULT_AAD)
    decipher.setAuthTag(authTag)
    const buf = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    plaintext = buf.toString('utf8')
  } catch {
    throw new SshError('VALIDATION', 'Incorrect vault passphrase or corrupted .ferryvault file')
  }

  let data: unknown
  try {
    data = JSON.parse(plaintext)
  } catch {
    throw new SshError('VALIDATION', 'Decrypted vault payload is not valid JSON')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new SshError('VALIDATION', 'Decrypted vault payload has invalid structure')
  }
  const obj = data as Record<string, unknown>
  const rawSites = Array.isArray(obj.sites) ? obj.sites : []
  // Validate site metadata via parseSitesBackup, then re-attach optional secret fields safely.
  const baseSites = parseSitesBackup(JSON.stringify({ schemaVersion: 1, sites: rawSites }))
  const sites: SiteInput[] = baseSites.map((site, idx) => {
    const raw = rawSites[idx] as Record<string, unknown> | undefined
    const out: SiteInput = { ...site }
    if (typeof raw?.password === 'string' && raw.password) out.password = raw.password
    if (typeof raw?.passphrase === 'string' && raw.passphrase) out.passphrase = raw.passphrase
    if (out.proxy && raw?.proxy && typeof raw.proxy === 'object') {
      const rp = raw.proxy as Record<string, unknown>
      if (typeof rp.password === 'string' && rp.password) {
        out.proxy = { ...out.proxy, password: rp.password }
      }
    }
    if (out.jumpHosts && Array.isArray(raw?.jumpHosts)) {
      out.jumpHosts = out.jumpHosts.map((hop, hIdx) => {
        const rh = (raw.jumpHosts as Record<string, unknown>[])[hIdx]
        return {
          ...hop,
          ...(typeof rh?.password === 'string' && rh.password ? { password: rh.password } : {}),
          ...(typeof rh?.passphrase === 'string' && rh.passphrase ? { passphrase: rh.passphrase } : {})
        }
      })
    }
    return out
  })

  const customSnippets: FerryVaultSnippet[] = Array.isArray(obj.customSnippets)
    ? obj.customSnippets
        .filter(
          (s): s is FerryVaultSnippet =>
            Boolean(
              s &&
                typeof s === 'object' &&
                typeof (s as FerryVaultSnippet).label === 'string' &&
                typeof (s as FerryVaultSnippet).command === 'string'
            )
        )
        .map((s) => ({
          id: typeof s.id === 'string' && s.id ? s.id : `snip-${Date.now()}`,
          label: s.label.trim().slice(0, 80),
          command: s.command.trim().slice(0, 500),
          description: typeof s.description === 'string' ? s.description.trim().slice(0, 240) : ''
        }))
        .filter((s) => s.label && s.command)
        .slice(0, 100)
    : []

  return {
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : undefined,
    sites,
    customSnippets
  }
}

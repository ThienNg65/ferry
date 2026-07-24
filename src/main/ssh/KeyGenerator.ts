import { execFile, spawn } from 'child_process'
import { generateKeyPairSync, randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import { SshError } from './errors'
import type { KeyGenerateRequest, KeyGenerateResult } from '../../shared/contract'

const execFileAsync = promisify(execFile)

function isCommandNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT'
}

/**
 * Runs the system `ssh-keygen` to generate an ed25519 keypair at
 * `req.keyPath` (+ `.pub`). Rejects with an ENOENT-coded error if
 * `ssh-keygen` itself can't be found — callers use that to fall back, not to
 * treat as a hard failure. `command` is overridable only so
 * KeyGenerator.test.ts can force the not-found path deterministically
 * regardless of whether this machine happens to have a real `ssh-keygen` on
 * PATH.
 *
 * Known, accepted risk: `-N` is ssh-keygen's ONLY non-interactive way to set
 * a passphrase, and it only accepts one as a literal argv value — there is
 * no file-descriptor/stdin equivalent (confirmed against ssh-keygen's own
 * usage text), and OpenSSH's interactive passphrase prompt deliberately
 * reads from `/dev/tty` rather than stdin, specifically to prevent piping a
 * passphrase in. That means a requested passphrase is briefly visible in
 * this process's command line (e.g. via `ps`/Task Manager/EDR tooling) for
 * `ssh-keygen`'s short lifetime. Reimplementing OpenSSH's passphrase KDF
 * (bcrypt-pbkdf) ourselves to avoid shelling out was deliberately rejected
 * elsewhere in this file as unjustified risk for a fallback path — the same
 * tradeoff applies here. The common case (no passphrase) is unaffected: an
 * empty string is never sensitive.
 */
function runSshKeygen(req: KeyGenerateRequest, command = 'ssh-keygen'): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-t', 'ed25519', '-f', req.keyPath, '-N', req.passphrase ?? '']
    if (req.comment) {
      args.push('-C', req.comment)
    }
    const child = spawn(command, args, { windowsHide: true })
    // ssh-keygen prompts (on stdin) to confirm overwriting an existing file —
    // closing stdin immediately turns that into an EOF/failure instead of an
    // indefinite hang, as a defensive backstop alongside the existence check
    // in generateEd25519KeyPair below.
    child.stdin?.end()
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim() || `ssh-keygen exited with code ${code}`))
      }
    })
  })
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0, 0)
  return b
}

/** SSH wire-format "string" — a length-prefixed byte blob, used for both raw key bytes and name/comment text (RFC 4251 §5). */
function sshString(data: Buffer | string): Buffer {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data
  return Buffer.concat([u32(buf.length), buf])
}

/** The standard SSH wire-format public-key blob (RFC 4253 §6.6) — identical content whether it ends up in an `authorized_keys` line or embedded in a private-key file. */
function edPublicKeyBlob(pubKey: Buffer): Buffer {
  return Buffer.concat([sshString('ssh-ed25519'), sshString(pubKey)])
}

/**
 * Builds an unencrypted `openssh-key-v1` private key file (PROTOCOL.key),
 * for the fallback path when no system `ssh-keygen` is available. This
 * exact byte layout was cross-validated against a real `ssh-keygen -y`/`-l`
 * during development (round-tripping a generated key derived the identical
 * public key and a valid fingerprint) — see KeyGenerator.test.ts.
 */
function buildOpenSshPrivateKeyPem(pubKey: Buffer, privKey64: Buffer, comment: string): string {
  const magic = Buffer.concat([Buffer.from('openssh-key-v1', 'ascii'), Buffer.from([0])])
  const pubBlob = edPublicKeyBlob(pubKey)

  const checkint = randomBytes(4)
  const record = Buffer.concat([sshString('ssh-ed25519'), sshString(pubKey), sshString(privKey64), sshString(comment)])
  const body = Buffer.concat([checkint, checkint, record])
  const blockSize = 8
  const padLen = (blockSize - (body.length % blockSize)) % blockSize
  const padding = Buffer.from(Array.from({ length: padLen }, (_, i) => i + 1))
  const privateSection = Buffer.concat([body, padding])

  const container = Buffer.concat([
    magic,
    sshString('none'), // ciphername
    sshString('none'), // kdfname
    sshString(Buffer.alloc(0)), // kdfoptions (empty — no KDF for an unencrypted key)
    u32(1), // number of keys
    sshString(pubBlob),
    sshString(privateSection)
  ])

  const b64 = container.toString('base64')
  const lines = b64.match(/.{1,70}/g) ?? []
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`
}

/** Node's JWK export for an OKP (Ed25519) key gives raw curve bytes directly (RFC 8037) — no ASN.1 parsing needed. */
interface Ed25519Jwk {
  x: string
  d?: string
}

/** Exported (only) so KeyGenerator.test.ts can validate the fallback encoder's output directly against a real `ssh-keygen`, without needing to force an artificial "ssh-keygen not found" condition through the public entry point. */
export async function generateBuiltin(req: KeyGenerateRequest): Promise<KeyGenerateResult> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubJwk = publicKey.export({ format: 'jwk' }) as Ed25519Jwk
  const privJwk = privateKey.export({ format: 'jwk' }) as Ed25519Jwk
  const pubKeyBytes = Buffer.from(pubJwk.x, 'base64url')
  const seedBytes = Buffer.from(privJwk.d as string, 'base64url')
  // OpenSSH's on-disk ed25519 "private key" field is the libsodium secret-key
  // convention: the 32-byte seed followed by the 32-byte public key, 64 bytes total.
  const privKey64 = Buffer.concat([seedBytes, pubKeyBytes])
  const comment = req.comment ?? ''

  const pem = buildOpenSshPrivateKeyPem(pubKeyBytes, privKey64, comment)
  const publicLine = `${`ssh-ed25519 ${edPublicKeyBlob(pubKeyBytes).toString('base64')}${comment ? ` ${comment}` : ''}`}\n`

  await fs.writeFile(req.keyPath, pem, { mode: 0o600 })
  if (process.platform === 'win32') {
    await execFileAsync('icacls', [req.keyPath, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], { windowsHide: true })
  }
  await fs.writeFile(`${req.keyPath}.pub`, publicLine, { mode: 0o644 })

  return {
    privateKeyPath: req.keyPath,
    publicKeyPath: `${req.keyPath}.pub`,
    publicKey: publicLine.trim(),
    method: 'builtin'
  }
}

/**
 * Generates a new ed25519 SSH keypair at `req.keyPath` (+ `.pub`).
 *
 * Prefers shelling out to the system `ssh-keygen` (produces exactly what a
 * real OpenSSH install would, and supports a passphrase natively) —
 * availability is detected lazily by attempting the spawn and catching
 * ENOENT, since Windows ships OpenSSH's Client feature (which has
 * `ssh-keygen.exe`) separately from the OpenSSH Agent *service* the rest of
 * this app already depends on for agent auth, so it can't be assumed present
 * just because agent auth works.
 *
 * Falls back to a pure-JS builtin generator when `ssh-keygen` isn't found.
 * The builtin path deliberately does not support passphrase-encryption (the
 * bcrypt-pbkdf KDF wrapping real ssh-keygen uses is real implementation risk
 * not justified for a fallback path) — it errors clearly instead of
 * silently generating an unprotected key when one was requested.
 */
export async function generateEd25519KeyPair(
  req: KeyGenerateRequest,
  /** Overridable only for unit tests, to force the "not found" fallback path deterministically. */
  sshKeygenCommand = 'ssh-keygen'
): Promise<KeyGenerateResult> {
  const exists = await fs
    .access(req.keyPath)
    .then(() => true)
    .catch(() => false)
  if (exists) {
    throw new SshError('VALIDATION', `"${req.keyPath}" already exists — choose a different path.`)
  }
  await fs.mkdir(path.dirname(req.keyPath), { recursive: true })

  try {
    await runSshKeygen(req, sshKeygenCommand)
    const publicKey = (await fs.readFile(`${req.keyPath}.pub`, 'utf-8')).trim()
    return { privateKeyPath: req.keyPath, publicKeyPath: `${req.keyPath}.pub`, publicKey, method: 'ssh-keygen' }
  } catch (e) {
    if (!isCommandNotFound(e)) {
      throw new SshError('UNKNOWN', `ssh-keygen failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (req.passphrase) {
    throw new SshError(
      'VALIDATION',
      'Passphrase protection requires a system ssh-keygen, which was not found on this machine. Generate without a passphrase, or install OpenSSH.'
    )
  }
  return generateBuiltin(req)
}

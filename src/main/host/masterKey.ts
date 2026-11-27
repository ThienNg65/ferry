import { execFileSync } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import * as path from 'path'
import {
  clearMasterKeyCache as clearDpapiCache,
  unwrapOrCreateMasterKey as unwrapOrCreateDpapiKey
} from './dpapiKey'

const KEYCHAIN_SERVICE = 'dev.ferry.master-key'
const SECRET_TOOL_TIMEOUT_MS = 10_000
const keyCache = new Map<string, Buffer>()

export interface MasterKeyDeps {
  platform?: NodeJS.Platform
  execFileSyncImpl?: typeof execFileSync
  env?: NodeJS.ProcessEnv
}

function profileAccountId(resolvedDataDir: string): string {
  return createHash('sha256').update(resolvedDataDir).digest('hex').slice(0, 24)
}

function parseBase64Key(raw: string, backendName: string): Buffer {
  const key = Buffer.from(raw.trim(), 'base64')
  if (key.length !== 32) {
    throw new Error(`${backendName} master key must be 32 bytes, got ${key.length}`)
  }
  return key
}

function unwrapOrCreateMacOsKey(resolvedDataDir: string, execImpl: typeof execFileSync): Buffer {
  const account = profileAccountId(resolvedDataDir)
  try {
    const existing = execImpl(
      '/usr/bin/security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
      { encoding: 'utf8', timeout: SECRET_TOOL_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    if (existing && existing.trim()) {
      return parseBase64Key(existing, 'macOS Keychain')
    }
  } catch {
    // Not found yet — create a fresh 32-byte key below.
  }

  const fresh = randomBytes(32)
  const b64 = fresh.toString('base64')
  // Pipe command over stdin via `security -i` so the secret never appears in `ps` argv.
  const stdinScript = `add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}" -w "${b64}" -U\n`
  execImpl('/usr/bin/security', ['-i'], {
    input: stdinScript,
    encoding: 'utf8',
    timeout: SECRET_TOOL_TIMEOUT_MS,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  return fresh
}

function unwrapOrCreateLinuxKey(
  resolvedDataDir: string,
  execImpl: typeof execFileSync,
  env: NodeJS.ProcessEnv
): Buffer {
  const account = profileAccountId(resolvedDataDir)
  try {
    const existing = execImpl(
      'secret-tool',
      ['lookup', 'application', 'ferry', 'key', 'master-key', 'profile', account],
      { encoding: 'utf8', timeout: SECRET_TOOL_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    if (existing && existing.trim()) {
      return parseBase64Key(existing, 'Linux libsecret')
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      return handleMissingLinuxSecretService(resolvedDataDir, env, 'secret-tool is not installed')
    }
    // Non-zero exit from `secret-tool lookup` can mean key does not exist yet — try storing below.
  }

  const fresh = randomBytes(32)
  const b64 = fresh.toString('base64')
  try {
    execImpl(
      'secret-tool',
      ['store', '--label=Ferry Master Key', 'application', 'ferry', 'key', 'master-key', 'profile', account],
      {
        input: b64,
        encoding: 'utf8',
        timeout: SECRET_TOOL_TIMEOUT_MS,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    return fresh
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return handleMissingLinuxSecretService(resolvedDataDir, env, detail)
  }
}

function handleMissingLinuxSecretService(
  resolvedDataDir: string,
  env: NodeJS.ProcessEnv,
  reason: string
): Buffer {
  // Never silently downgrade to plaintext storage (mirrors Electron safeStorage guidance).
  // Only honor explicit CI/headless test opt-in.
  if (env.FERRY_ALLOW_INSECURE_KEYFILE === '1') {
    mkdirSync(resolvedDataDir, { recursive: true })
    const keyFile = path.join(resolvedDataDir, '.ferry-master-key')
    if (existsSync(keyFile)) {
      return parseBase64Key(readFileSync(keyFile, 'utf8'), 'Insecure fallback keyfile')
    }
    const fresh = randomBytes(32)
    writeFileSync(keyFile, fresh.toString('base64'), { encoding: 'utf8', mode: 0o600 })
    return fresh
  }

  throw new Error(
    `Linux Secret Service (libsecret) is unavailable (${reason}). Install libsecret-tools and ensure gnome-keyring or kwallet is unlocked, or set FERRY_ALLOW_INSECURE_KEYFILE=1 only for headless CI/testing.`
  )
}

/**
 * Unwraps or creates the 32-byte AES master key using the OS secret store:
 * - Windows: DPAPI via `dpapiKey.ts`
 * - macOS: Keychain via `/usr/bin/security -i` (stdin, never leaking secrets in `argv`)
 * - Linux: Freedesktop Secret Service (`libsecret`) via `secret-tool` (fails closed when unavailable)
 */
export function unwrapOrCreateMasterKey(dataDir: string, deps: MasterKeyDeps = {}): Buffer {
  const platform = deps.platform ?? process.platform
  if (platform === 'win32') {
    return unwrapOrCreateDpapiKey(dataDir)
  }

  const resolved = path.resolve(dataDir)
  const cached = keyCache.get(resolved)
  if (cached) {
    return cached
  }

  const execImpl = deps.execFileSyncImpl ?? execFileSync
  const env = deps.env ?? process.env
  const key =
    platform === 'darwin'
      ? unwrapOrCreateMacOsKey(resolved, execImpl)
      : unwrapOrCreateLinuxKey(resolved, execImpl, env)

  keyCache.set(resolved, key)
  return key
}

export function clearMasterKeyCache(): void {
  keyCache.clear()
  clearDpapiCache()
}

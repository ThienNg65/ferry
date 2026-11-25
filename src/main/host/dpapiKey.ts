import { execFileSync } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import * as path from 'path'

const DPAPI_PREFIX = Buffer.from('DPAPI')
const DPAPI_TIMEOUT_MS = 15_000
const keyCache = new Map<string, Buffer>()

interface StoredMasterKey {
  key: Buffer
  wrapped: string
}

function dpapiProtect(raw: Buffer): Buffer {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))"
    ],
    { input: raw.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: DPAPI_TIMEOUT_MS }
  ).trim()
  return Buffer.from(out, 'base64')
}

function dpapiUnprotect(blob: Buffer): Buffer {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))"
    ],
    { input: blob.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: DPAPI_TIMEOUT_MS }
  ).trim()
  return Buffer.from(out, 'base64')
}

function unwrapWrappedMasterKey(wrappedBase64: string): Buffer {
  const wrapped = Buffer.from(wrappedBase64, 'base64')
  if (!wrapped.subarray(0, DPAPI_PREFIX.length).equals(DPAPI_PREFIX)) {
    throw new Error('Local State os_crypt.encrypted_key lacks DPAPI prefix')
  }
  const key = dpapiUnprotect(wrapped.subarray(DPAPI_PREFIX.length))
  if (key.length !== 32) {
    throw new Error('Unwrapped DPAPI master key must be 32 bytes, got ' + key.length)
  }
  return key
}

function readMasterKey(localStatePath: string): {
  state: Record<string, unknown>
  stored?: StoredMasterKey
} {
  let state: Record<string, unknown> = {}
  if (existsSync(localStatePath)) {
    const rawText = readFileSync(localStatePath, 'utf8').trim()
    if (rawText.length > 0) {
      let parsed: unknown
      try {
        parsed = JSON.parse(rawText)
      } catch (e) {
        throw new Error(`Corrupt Local State JSON at ${localStatePath}: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Invalid Local State root object at ${localStatePath}`)
      }
      state = parsed as Record<string, unknown>
    }
  }

  const osCrypt = state.os_crypt as { encrypted_key?: string } | undefined
  if (typeof osCrypt?.encrypted_key !== 'string' || osCrypt.encrypted_key.length === 0) {
    return { state }
  }

  return {
    state,
    stored: {
      key: unwrapWrappedMasterKey(osCrypt.encrypted_key),
      wrapped: osCrypt.encrypted_key
    }
  }
}

function readAtomicMasterKey(keyPath: string): StoredMasterKey | undefined {
  let entry: ReturnType<typeof lstatSync>
  try {
    entry = lstatSync(keyPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }

  if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
    throw new Error('The atomically selected DPAPI master-key entry has an invalid type')
  }

  const wrappedPath = entry.isDirectory() ? path.join(keyPath, 'key') : keyPath
  const wrappedEntry = lstatSync(wrappedPath)
  if (wrappedEntry.isSymbolicLink() || !wrappedEntry.isFile()) {
    throw new Error('The atomically selected DPAPI master key must be a regular file')
  }

  const wrapped = readFileSync(wrappedPath, 'utf8').trim()
  if (!wrapped) {
    throw new Error('The atomically selected DPAPI master-key file is empty')
  }
  return { key: unwrapWrappedMasterKey(wrapped), wrapped }
}

function writeSyncedTemporaryFile(targetPath: string, content: string): string {
  const tmpPath = targetPath + '.tmp.' + process.pid + '.' + randomUUID()
  try {
    const fd = openSync(tmpPath, 'wx', 0o600)
    try {
      writeFileSync(fd, content, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    return tmpPath
  } catch (error) {
    try {
      unlinkSync(tmpPath)
    } catch {
      // Ignore cleanup errors when temporary-file creation fails.
    }
    throw error
  }
}

/**
 * Selects one wrapped key across processes by atomically renaming a complete,
 * same-volume directory. This avoids relying on hard-link support, which is
 * unavailable on some Windows filesystems. Published directories are non-empty,
 * so competing renames cannot replace the selected key.
 *
 * Flat key files from earlier draft builds remain readable for compatibility.
 */
function selectOrCreateAtomicMasterKey(keyPath: string): StoredMasterKey {
  const existing = readAtomicMasterKey(keyPath)
  if (existing) {
    return existing
  }

  const candidateKey = randomBytes(32)
  const candidateWrapped = Buffer.concat([DPAPI_PREFIX, dpapiProtect(candidateKey)]).toString('base64')
  const temporaryDirectory = keyPath + '.tmp.' + process.pid + '.' + randomUUID()
  mkdirSync(temporaryDirectory)

  try {
    const temporaryKeyPath = writeSyncedTemporaryFile(path.join(temporaryDirectory, 'key'), candidateWrapped)
    renameSync(temporaryKeyPath, path.join(temporaryDirectory, 'key'))

    try {
      renameSync(temporaryDirectory, keyPath)
      return { key: candidateKey, wrapped: candidateWrapped }
    } catch (error) {
      const winner = readAtomicMasterKey(keyPath)
      if (winner) {
        return winner
      }
      throw error
    }
  } finally {
    try {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    } catch {
      // Keep cleanup failures from hiding the key-publication result.
    }
  }
}

function persistLocalState(
  localStatePath: string,
  state: Record<string, unknown>,
  stored: StoredMasterKey
): Buffer {
  const nextState = {
    ...state,
    os_crypt: {
      ...(typeof state.os_crypt === 'object' && state.os_crypt !== null ? state.os_crypt : {}),
      encrypted_key: stored.wrapped
    }
  }
  const tmpPath = writeSyncedTemporaryFile(localStatePath, JSON.stringify(nextState))

  try {
    try {
      renameSync(tmpPath, localStatePath)
    } catch (error) {
      const current = readMasterKey(localStatePath).stored
      if (current?.key.equals(stored.key)) {
        return current.key
      }
      throw error
    }
  } finally {
    try {
      unlinkSync(tmpPath)
    } catch {
      // Ignore cleanup errors after a successful rename.
    }
  }

  const persisted = readMasterKey(localStatePath).stored
  if (!persisted?.key.equals(stored.key)) {
    throw new Error('Persisted DPAPI master key does not match the selected key')
  }
  return persisted.key
}

/**
 * Unwraps the DPAPI-protected 32-byte AES master key from
 * `<dataDir>/Local State` (`os_crypt.encrypted_key`), or creates a fresh
 * DPAPI-protected key if none exists yet. Cached in memory per `dataDir`.
 */
export function unwrapOrCreateMasterKey(dataDir: string): Buffer {
  const resolved = path.resolve(dataDir)
  const cached = keyCache.get(resolved)
  if (cached) {
    return cached
  }

  const localStatePath = path.join(resolved, 'Local State')
  const existing = readMasterKey(localStatePath)
  if (existing.stored) {
    keyCache.set(resolved, existing.stored.key)
    return existing.stored.key
  }

  mkdirSync(resolved, { recursive: true })
  const selected = selectOrCreateAtomicMasterKey(localStatePath + '.dpapi-key')
  const current = readMasterKey(localStatePath)
  if (current.stored) {
    keyCache.set(resolved, current.stored.key)
    return current.stored.key
  }

  const key = persistLocalState(localStatePath, current.state, selected)
  keyCache.set(resolved, key)
  return key
}

/** Clears the in-memory key cache (intended for tests). */
export function clearMasterKeyCache(): void {
  keyCache.clear()
}

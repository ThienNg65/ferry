import { execFileSync } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import * as path from 'path'

const DPAPI_PREFIX = Buffer.from('DPAPI')
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
    { input: raw.toString('base64'), encoding: 'utf8', windowsHide: true }
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
    { input: blob.toString('base64'), encoding: 'utf8', windowsHide: true }
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
    throw new Error(`Unwrapped DPAPI master key must be 32 bytes, got ${key.length}`)
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
      state = JSON.parse(rawText) as Record<string, unknown>
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
  if (!existsSync(keyPath)) {
    return undefined
  }
  const wrapped = readFileSync(keyPath, 'utf8').trim()
  if (!wrapped) {
    throw new Error('The atomically selected DPAPI master-key file is empty')
  }
  return { key: unwrapWrappedMasterKey(wrapped), wrapped }
}

function writeSyncedTemporaryFile(targetPath: string, content: string): string {
  const tmpPath = `${targetPath}.tmp.${process.pid}.${randomUUID()}`
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
 * Selects one wrapped key across processes using an atomic same-directory hard
 * link. Only the first process can publish the destination; all others read
 * that complete, already-flushed value instead of using their own candidate.
 */
function selectOrCreateAtomicMasterKey(keyPath: string): StoredMasterKey {
  const existing = readAtomicMasterKey(keyPath)
  if (existing) {
    return existing
  }

  const candidateKey = randomBytes(32)
  const candidateWrapped = Buffer.concat([DPAPI_PREFIX, dpapiProtect(candidateKey)]).toString('base64')
  const tmpPath = writeSyncedTemporaryFile(keyPath, candidateWrapped)

  try {
    try {
      linkSync(tmpPath, keyPath)
      return { key: candidateKey, wrapped: candidateWrapped }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      const winner = readAtomicMasterKey(keyPath)
      if (!winner) {
        throw new Error('The selected DPAPI master key disappeared during initialization')
      }
      return winner
    }
  } finally {
    try {
      unlinkSync(tmpPath)
    } catch {
      // The published hard link remains valid if temporary-link cleanup fails.
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
  const selected = selectOrCreateAtomicMasterKey(`${localStatePath}.dpapi-key`)
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

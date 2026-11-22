import { execFileSync } from 'child_process'
import { randomBytes, randomUUID } from 'crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import * as path from 'path'

const DPAPI_PREFIX = Buffer.from('DPAPI')
const keyCache = new Map<string, Buffer>()
const LOCK_RETRY_MS = 50
const LOCK_TIMEOUT_MS = 30_000
const LOCK_EMPTY_STALE_MS = 1_000
const LOCK_MAX_AGE_MS = 2 * 60_000
const lockWaitBuffer = new Int32Array(new SharedArrayBuffer(4))

interface MasterKeyLockOwner {
  pid: number
  createdAt: number
  token: string
}

interface MasterKeyLock {
  assertOwned(): void
  release(): void
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

function readMasterKey(localStatePath: string): { state: Record<string, unknown>; key?: Buffer } {
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

  const wrapped = Buffer.from(osCrypt.encrypted_key, 'base64')
  if (!wrapped.subarray(0, DPAPI_PREFIX.length).equals(DPAPI_PREFIX)) {
    throw new Error('Local State os_crypt.encrypted_key lacks DPAPI prefix')
  }
  const key = dpapiUnprotect(wrapped.subarray(DPAPI_PREFIX.length))
  if (key.length !== 32) {
    throw new Error(`Unwrapped DPAPI master key must be 32 bytes, got ${key.length}`)
  }
  return { state, key }
}

function readLockOwner(lockPath: string): MasterKeyLockOwner | undefined {
  try {
    const owner = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<MasterKeyLockOwner>
    if (
      !Number.isSafeInteger(owner.pid) ||
      (owner.pid ?? 0) <= 0 ||
      typeof owner.createdAt !== 'number' ||
      typeof owner.token !== 'string'
    ) {
      return undefined
    }
    return owner as MasterKeyLockOwner
  } catch {
    return undefined
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isStaleLock(lockPath: string): boolean {
  let age: number
  try {
    age = Date.now() - statSync(lockPath).mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }

  const owner = readLockOwner(lockPath)
  if (!owner) {
    return age >= LOCK_EMPTY_STALE_MS
  }
  if (!isProcessRunning(owner.pid)) {
    return true
  }
  return age >= LOCK_MAX_AGE_MS
}

function acquireMasterKeyLock(lockPath: string): MasterKeyLock {
  const startedAt = Date.now()

  while (true) {
    const token = randomUUID()
    let fd: number
    try {
      fd = openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }

      if (isStaleLock(lockPath)) {
        try {
          unlinkSync(lockPath)
        } catch (unlinkError) {
          if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw unlinkError
          }
        }
        continue
      }

      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error('Timed out waiting for DPAPI master-key initialization')
      }
      Atomics.wait(lockWaitBuffer, 0, 0, LOCK_RETRY_MS)
      continue
    }

    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now(), token }))
      fsyncSync(fd)
    } catch (error) {
      closeSync(fd)
      try {
        unlinkSync(lockPath)
      } catch {
        // The next initializer can recover an abandoned lock.
      }
      throw error
    }

    return {
      assertOwned() {
        if (readLockOwner(lockPath)?.token !== token) {
          throw new Error('DPAPI master-key initialization lock was lost')
        }
      },
      release() {
        const ownsLock = readLockOwner(lockPath)?.token === token
        closeSync(fd)
        if (ownsLock) {
          try {
            unlinkSync(lockPath)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw error
            }
          }
        }
      }
    }
  }
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
  if (existing.key) {
    keyCache.set(resolved, existing.key)
    return existing.key
  }

  mkdirSync(resolved, { recursive: true })
  const lock = acquireMasterKeyLock(`${localStatePath}.lock`)
  let tmpPath: string | undefined

  try {
    // Another process may have created the shared key while this process waited.
    const current = readMasterKey(localStatePath)
    if (current.key) {
      keyCache.set(resolved, current.key)
      return current.key
    }

    const freshKey = randomBytes(32)
    const wrapped = Buffer.concat([DPAPI_PREFIX, dpapiProtect(freshKey)]).toString('base64')
    const nextState = {
      ...current.state,
      os_crypt: {
        ...(typeof current.state.os_crypt === 'object' && current.state.os_crypt !== null
          ? current.state.os_crypt
          : {}),
        encrypted_key: wrapped
      }
    }

    tmpPath = `${localStatePath}.tmp.${process.pid}.${randomUUID()}`
    const tmpFd = openSync(tmpPath, 'wx', 0o600)
    try {
      writeFileSync(tmpFd, JSON.stringify(nextState), 'utf8')
      fsyncSync(tmpFd)
    } finally {
      closeSync(tmpFd)
    }

    lock.assertOwned()
    renameSync(tmpPath, localStatePath)
    tmpPath = undefined
    keyCache.set(resolved, freshKey)
    return freshKey
  } finally {
    if (tmpPath) {
      try {
        unlinkSync(tmpPath)
      } catch {
        // Ignore cleanup errors; the next startup can safely overwrite no key.
      }
    }
    lock.release()
  }
}

/** Clears the in-memory key cache (intended for tests). */
export function clearMasterKeyCache(): void {
  keyCache.clear()
}

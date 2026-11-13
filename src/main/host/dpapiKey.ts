import { execFileSync } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import * as path from 'path'

const DPAPI_PREFIX = Buffer.from('DPAPI')
const keyCache = new Map<string, Buffer>()

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

/**
 * Unwraps Chromium/Electron's DPAPI-protected 32-byte AES master key from
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
  let state: Record<string, unknown> = {}
  if (existsSync(localStatePath)) {
    const rawText = readFileSync(localStatePath, 'utf8').trim()
    if (rawText.length > 0) {
      state = JSON.parse(rawText) as Record<string, unknown>
    }
    const osCrypt = state.os_crypt as { encrypted_key?: string } | undefined
    if (typeof osCrypt?.encrypted_key === 'string' && osCrypt.encrypted_key.length > 0) {
      const wrapped = Buffer.from(osCrypt.encrypted_key, 'base64')
      if (!wrapped.subarray(0, DPAPI_PREFIX.length).equals(DPAPI_PREFIX)) {
        throw new Error('Local State os_crypt.encrypted_key lacks DPAPI prefix')
      }
      const key = dpapiUnprotect(wrapped.subarray(DPAPI_PREFIX.length))
      if (key.length !== 32) {
        throw new Error(`Unwrapped DPAPI master key must be 32 bytes, got ${key.length}`)
      }
      keyCache.set(resolved, key)
      return key
    }
  }

  const freshKey = randomBytes(32)
  const wrapped = Buffer.concat([DPAPI_PREFIX, dpapiProtect(freshKey)]).toString('base64')
  mkdirSync(resolved, { recursive: true })
  const nextState = {
    ...state,
    os_crypt: {
      ...(typeof state.os_crypt === 'object' && state.os_crypt !== null ? state.os_crypt : {}),
      encrypted_key: wrapped
    }
  }
  const tmpPath = `${localStatePath}.tmp.${process.pid}`
  writeFileSync(tmpPath, JSON.stringify(nextState), 'utf8')
  renameSync(tmpPath, localStatePath)
  keyCache.set(resolved, freshKey)
  return freshKey
}

/** Clears the in-memory key cache (intended for tests). */
export function clearMasterKeyCache(): void {
  keyCache.clear()
}

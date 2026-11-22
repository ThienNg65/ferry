import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearMasterKeyCache, unwrapOrCreateMasterKey } from './dpapiKey'
import { createSecretBox } from './secretBox'

const tempDirs: string[] = []

function runMasterKeyWorker(dataDir: string): Promise<Buffer> {
  const moduleUrl = new URL('./dpapiKey.ts', import.meta.url).href
  const script = `
    import { readdirSync, writeFileSync } from 'node:fs'
    import * as path from 'node:path'
    import { unwrapOrCreateMasterKey } from ${JSON.stringify(moduleUrl)}

    writeFileSync(path.join(${JSON.stringify(dataDir)}, '.dpapi-ready-' + process.pid), '')
    const waitBuffer = new Int32Array(new SharedArrayBuffer(4))
    const deadline = Date.now() + 15_000
    while (readdirSync(${JSON.stringify(dataDir)}).filter((name) => name.startsWith('.dpapi-ready-')).length < 2) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the second DPAPI worker')
      Atomics.wait(waitBuffer, 0, 0, 10)
    }

    const key = unwrapOrCreateMasterKey(${JSON.stringify(dataDir)})
    process.stdout.write(key.toString('base64'))
  `

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--experimental-default-type=module', '--experimental-strip-types', '--input-type=module', '-e', script],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    if (!child.stdout || !child.stderr) {
      child.kill()
      reject(new Error('DPAPI worker stdout/stderr streams were not created'))
      return
    }

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`DPAPI worker exited with code ${code}: ${stderr}`))
        return
      }
      resolve(Buffer.from(stdout.trim(), 'base64'))
    })
  })
}

afterEach(() => {
  clearMasterKeyCache()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform !== 'win32')('dpapiKey', () => {
  it('creates a DPAPI-protected 32-byte key in Local State and unwraps the exact same bytes across cache clears', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ferry-dpapi-test-'))
    tempDirs.push(dir)

    const key1 = unwrapOrCreateMasterKey(dir)
    expect(key1).toHaveLength(32)

    const localState = JSON.parse(readFileSync(path.join(dir, 'Local State'), 'utf8'))
    const rawWrapped = Buffer.from(localState.os_crypt.encrypted_key, 'base64')
    expect(rawWrapped.subarray(0, 5).toString('ascii')).toBe('DPAPI')
    expect(existsSync(path.join(dir, 'Local State.lock'))).toBe(false)

    clearMasterKeyCache()
    const key2 = unwrapOrCreateMasterKey(dir)
    expect(key2.equals(key1)).toBe(true)

    const box = createSecretBox(key2)
    const ct = box.encrypt('ferry-roundtrip-secret')
    expect(box.decrypt(ct)).toBe('ferry-roundtrip-secret')
  })

  it('returns the same persisted key when two app processes initialize an empty profile concurrently', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ferry-dpapi-concurrent-'))
    tempDirs.push(dir)

    const [key1, key2] = await Promise.all([
      runMasterKeyWorker(dir),
      runMasterKeyWorker(dir)
    ])
    expect(key1).toHaveLength(32)
    expect(key2.equals(key1)).toBe(true)

    clearMasterKeyCache()
    const persistedKey = unwrapOrCreateMasterKey(dir)
    expect(persistedKey.equals(key1)).toBe(true)

    const box = createSecretBox(persistedKey)
    const encrypted = box.encrypt('concurrent-first-run-secret')
    expect(box.decrypt(encrypted)).toBe('concurrent-first-run-secret')
  })

  it('recovers an abandoned initialization lock whose owner process no longer exists', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ferry-dpapi-stale-lock-'))
    tempDirs.push(dir)
    const lockPath = path.join(dir, 'Local State.lock')
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 2_147_483_647, createdAt: Date.now() - 5_000, token: 'abandoned' }),
      'utf8'
    )
    const staleTime = new Date(Date.now() - 5_000)
    utimesSync(lockPath, staleTime, staleTime)

    const key = unwrapOrCreateMasterKey(dir)
    expect(key).toHaveLength(32)
    expect(existsSync(lockPath)).toBe(false)
    clearMasterKeyCache()
    expect(unwrapOrCreateMasterKey(dir).equals(key)).toBe(true)
  })

  it('recovers when Local State is an empty truncated file from an interrupted first run', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ferry-dpapi-empty-'))
    tempDirs.push(dir)
    writeFileSync(path.join(dir, 'Local State'), '', 'utf8')

    const key = unwrapOrCreateMasterKey(dir)
    expect(key).toHaveLength(32)

    clearMasterKeyCache()
    expect(unwrapOrCreateMasterKey(dir).equals(key)).toBe(true)
  })

  it('can unwrap and decrypt real %APPDATA%\\Ferry secrets if present', () => {
    const appData = process.env.APPDATA
    if (!appData) return
    const ferryDir = path.join(appData, 'Ferry')
    const localStatePath = path.join(ferryDir, 'Local State')
    const sitesPath = path.join(ferryDir, 'sites.json')
    if (!existsSync(localStatePath) || !existsSync(sitesPath)) {
      return
    }
    const key = unwrapOrCreateMasterKey(ferryDir)
    expect(key).toHaveLength(32)
    const box = createSecretBox(key)
    const { sites } = JSON.parse(readFileSync(sitesPath, 'utf8')) as {
      sites: Array<{ secretPassword?: string; secretPassphrase?: string }>
    }
    for (const s of sites) {
      if (s.secretPassword) {
        expect(typeof box.decrypt(s.secretPassword)).toBe('string')
      }
      if (s.secretPassphrase) {
        expect(typeof box.decrypt(s.secretPassphrase)).toBe('string')
      }
    }
  })
})

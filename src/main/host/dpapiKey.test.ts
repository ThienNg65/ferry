import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearMasterKeyCache, unwrapOrCreateMasterKey } from './dpapiKey'
import { createSecretBox } from './secretBox'

const tempDirs: string[] = []

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

    clearMasterKeyCache()
    const key2 = unwrapOrCreateMasterKey(dir)
    expect(key2.equals(key1)).toBe(true)

    const box = createSecretBox(key2)
    const ct = box.encrypt('ferry-roundtrip-secret')
    expect(box.decrypt(ct)).toBe('ferry-roundtrip-secret')
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

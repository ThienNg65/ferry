import { mkdtempSync, rmSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearMasterKeyCache, unwrapOrCreateMasterKey } from './masterKey'

describe('masterKey cross-platform secret store', () => {
  const tempDirs: string[] = []
  afterEach(() => {
    clearMasterKeyCache()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses macOS security -i stdin piping so secrets never appear in argv', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ferry-mk-mac-'))
    tempDirs.push(dir)
    const calls: Array<{ file: string; args: readonly string[]; input?: unknown }> = []
    const execMock = vi.fn((file: string, args: readonly string[], opts?: { input?: unknown }) => {
      calls.push({ file, args, input: opts?.input })
      if (args[0] === 'find-generic-password') {
        throw new Error('not found')
      }
      return ''
    })

    const key = unwrapOrCreateMasterKey(dir, {
      platform: 'darwin',
      execFileSyncImpl: execMock as unknown as typeof import('child_process').execFileSync
    })

    expect(key.length).toBe(32)
    expect(calls[1].file).toBe('/usr/bin/security')
    expect(calls[1].args).toEqual(['-i'])
    expect(String(calls[1].input)).toContain('add-generic-password')
    expect(String(calls[1].input)).toContain(key.toString('base64'))
    // Confirm secret was NOT passed in argv
    expect(calls[1].args.join(' ')).not.toContain(key.toString('base64'))
  })

  it('fails closed on Linux when secret-tool is unavailable', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ferry-mk-linux-'))
    tempDirs.push(dir)
    const execMock = vi.fn(() => {
      const err = new Error('spawn ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    })

    expect(() =>
      unwrapOrCreateMasterKey(dir, {
        platform: 'linux',
        execFileSyncImpl: execMock as unknown as typeof import('child_process').execFileSync,
        env: {}
      })
    ).toThrow(/Linux Secret Service \(libsecret\) is unavailable/)
  })

  it('allows explicit FERRY_ALLOW_INSECURE_KEYFILE=1 override on headless Linux CI', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ferry-mk-linux-ci-'))
    tempDirs.push(dir)
    const execMock = vi.fn(() => {
      const err = new Error('spawn ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    })

    const key1 = unwrapOrCreateMasterKey(dir, {
      platform: 'linux',
      execFileSyncImpl: execMock as unknown as typeof import('child_process').execFileSync,
      env: { FERRY_ALLOW_INSECURE_KEYFILE: '1' }
    })
    clearMasterKeyCache()
    const key2 = unwrapOrCreateMasterKey(dir, {
      platform: 'linux',
      execFileSyncImpl: execMock as unknown as typeof import('child_process').execFileSync,
      env: { FERRY_ALLOW_INSECURE_KEYFILE: '1' }
    })
    expect(key1.length).toBe(32)
    expect(key1.equals(key2)).toBe(true)
  })
})

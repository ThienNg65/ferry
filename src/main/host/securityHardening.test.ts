import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setHost } from './host'
import { testHost } from './testHost.setup'
import { logSecurityEvent } from './securityLog'
import { sanitizeEditFilename } from '../edit/EditSessionManager'
import { MAX_STAGE_DROP_ENTRIES, stageDroppedEntries } from '../fs/LocalFsService'
import { connectViaProxy } from '../ssh/ProxyConnector'
import { SidecarUpdater } from '../update/SidecarUpdater'
import { validateProxyConfig, validateSiteInput } from '../ipc/validation'

describe('Security Hardening', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ferry-sec-test-'))
    setHost({ ...testHost, dataDir: tmpDir, isPackaged: false })
  })

  afterEach(() => {
    setHost(testHost)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('redacts sensitive fields in securityLog and rotates above 1 MB', () => {
    logSecurityEvent('test.auth', {
      host: 'example.com',
      password: 'super-secret-password',
      nested: { passphrase: 'my-passphrase', token: 'tok-123', safe: 'ok' }
    })
    const logPath = path.join(tmpDir, 'security.log')
    const line = JSON.parse(readFileSync(logPath, 'utf8').trim()) as Record<string, unknown>
    expect(line.event).toBe('test.auth')
    expect(line.host).toBe('example.com')
    expect(line.password).toBe('[REDACTED]')
    expect(line.nested).toEqual({ passphrase: '[REDACTED]', token: '[REDACTED]', safe: 'ok' })

    writeFileSync(logPath, 'x'.repeat(1_048_576), 'utf8')
    logSecurityEvent('test.rotated', { ok: true })
    const rotated = readFileSync(`${logPath}.1`, 'utf8')
    expect(rotated.length).toBe(1_048_576)
    const fresh = JSON.parse(readFileSync(logPath, 'utf8').trim()) as Record<string, unknown>
    expect(fresh.event).toBe('test.rotated')
  })

  it('sanitizes remote filenames for local edit temp paths against Windows/POSIX traversal', () => {
    expect(sanitizeEditFilename('/var/log/..\\..\\evil.exe')).toBe('evil.exe')
    expect(sanitizeEditFilename('/etc/..')).toBe('file')
    expect(sanitizeEditFilename('C:\\Windows\\System32\\cmd.exe')).toBe('cmd.exe')
    expect(sanitizeEditFilename('app:stream?.txt')).toBe('app_stream_.txt')
    expect(sanitizeEditFilename('/tmp/NUL.txt')).toBe('_NUL.txt')
    expect(sanitizeEditFilename('/tmp/CON')).toBe('_CON')
    expect(sanitizeEditFilename('/tmp/trailing. .')).toBe('trailing')
  })

  it('enforces MAX_STAGE_DROP_ENTRIES on dropped entries', async () => {
    const entries = Array.from({ length: MAX_STAGE_DROP_ENTRIES + 1 }, (_, i) => ({
      relativePath: `file-${i}.txt`,
      isDir: false
    }))
    await expect(stageDroppedEntries({ entries })).rejects.toThrow(/staging limit/i)
  })

  it('rejects CRLF/NUL injection in HTTP CONNECT proxy fields', async () => {
    await expect(
      connectViaProxy({ type: 'http', host: '127.0.0.1', port: 8080 }, 'evil.com\r\nX-Injected: 1', 22)
    ).rejects.toThrow(/control characters/i)
    await expect(
      connectViaProxy({ type: 'http', host: '127.0.0.1', port: 8080, username: 'u\nbar', password: 'p' }, 'example.com', 22)
    ).rejects.toThrow(/control characters/i)
  })

  it('enforces HTTPS and trusted origins in SidecarUpdater when packaged', async () => {
    setHost({ ...testHost, dataDir: tmpDir, isPackaged: true })
    const fetchSpy = vi.fn()
    const updater = new SidecarUpdater({
      feedUrl: 'http://evil.example.com/updates',
      fetchImpl: fetchSpy as unknown as typeof fetch
    })
    await expect(updater.checkForUpdates()).rejects.toThrow(/non-HTTPS/i)
    expect(fetchSpy).not.toHaveBeenCalled()

    const validSha512 = `${'A'.repeat(86)}==`
    const untrustedManifestFetch = vi.fn(async () =>
      new Response(
        `version: 9.9.9\npath: https://attacker.example.com/Ferry-Setup-9.9.9.exe\nsha512: ${validSha512}\n`,
        {
          status: 200
        }
      )
    )
    const updater2 = new SidecarUpdater({
      feedUrl: 'https://github.com/ThienNg65/ferry-release/releases/latest/download',
      fetchImpl: untrustedManifestFetch as unknown as typeof fetch
    })
    await expect(updater2.checkForUpdates()).rejects.toThrow(/untrusted installer origin/i)
  })

  it('ignores FERRY_UPDATE_FEED_URL override in packaged builds', async () => {
    setHost({ ...testHost, dataDir: tmpDir, isPackaged: true })
    const prevEnv = process.env['FERRY_UPDATE_FEED_URL']
    process.env['FERRY_UPDATE_FEED_URL'] = 'https://evil-override.example.com/updates'
    const requestedUrls: string[] = []
    try {
      const fetchSpy = vi.fn(async (input: string | URL | Request) => {
        requestedUrls.push(String(input))
        return new Response('version: 0.0.1\npath: Ferry-Setup-0.0.1.exe\nsha512: ' + 'A'.repeat(86) + '==\n', {
          status: 200
        })
      })
      const updater = new SidecarUpdater({ fetchImpl: fetchSpy as unknown as typeof fetch })
      await updater.checkForUpdates().catch(() => undefined)
      expect(requestedUrls[0]).toMatch(/^https:\/\/github\.com\/ThienNg65\/ferry-release\//)
    } finally {
      if (prevEnv === undefined) {
        delete process.env['FERRY_UPDATE_FEED_URL']
      } else {
        process.env['FERRY_UPDATE_FEED_URL'] = prevEnv
      }
    }
  })

  it('validates IPC site and proxy payloads at the sidecar boundary', () => {
    expect(() => validateProxyConfig({ type: 'ftp', host: 'p', port: 1080 }, 'test')).toThrow()
    expect(() => validateSiteInput({ host: 'h', port: 70000, username: 'u', authMethod: 'password' }, 'test')).toThrow()
    const valid = validateSiteInput({ host: 'h', port: 22, username: 'u', authMethod: 'agent' }, 'test')
    expect(valid.name).toBe('h')
    expect(valid.port).toBe(22)
  })
})

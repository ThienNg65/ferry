import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unwrapOrCreateMasterKey } from './dpapiKey'
import { createSecretBox } from './secretBox'
import { setHost } from './host'
import { createNodeHost } from '../../sidecar/nodeHost'

const isWindows = process.platform === 'win32'

describe.runIf(isWindows)('Electron -> Neutralino user data upgrade & rollback compatibility', () => {
  let userDataDir: string

  beforeEach(() => {
    vi.resetModules()
    userDataDir = mkdtempSync(path.join(os.tmpdir(), 'ferry-upgrade-mig-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('preserves sites, v10 DPAPI secrets, settings, bookmarks, history, and known_hosts across upgrade and rollback', async () => {
    // 1. Seed userDataDir as an existing Electron installation: Local State DPAPI key + 5 JSON stores.
    const masterKey = unwrapOrCreateMasterKey(userDataDir)
    const box = createSecretBox(masterKey)

    writeFileSync(
      path.join(userDataDir, 'sites.json'),
      JSON.stringify({
        sites: [
          {
            id: 'site-1',
            name: 'Prod Web',
            host: 'prod.example.com',
            port: 22,
            username: 'deploy',
            authMethod: 'password',
            secretPassword: box.encrypt('electron-secret-pw'),
            jumpHosts: [
              {
                host: 'bastion.example.com',
                port: 22,
                username: 'jump',
                authMethod: 'privateKey',
                privateKeyPath: 'C:\\keys\\jump',
                secretPassphrase: box.encrypt('jump-passphrase')
              }
            ],
            proxyMode: 'custom',
            proxy: {
              type: 'socks5',
              host: 'proxy.internal',
              port: 1080,
              username: 'puser',
              secretPassword: box.encrypt('proxy-secret')
            },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      }),
      'utf8'
    )

    writeFileSync(
      path.join(userDataDir, 'app-settings.json'),
      JSON.stringify({
        openTabSiteIds: ['site-1'],
        bandwidthLimitKBps: 2048,
        defaultProxy: {
          type: 'http',
          host: 'corp-proxy.local',
          port: 8080,
          username: 'corp',
          secretPassword: box.encrypt('corp-pw')
        },
        autoCheckUpdates: true
      }),
      'utf8'
    )

    writeFileSync(
      path.join(userDataDir, 'bookmarks.json'),
      JSON.stringify({
        bookmarks: [
          {
            id: 'bm-1',
            scope: 'remote',
            siteId: 'site-1',
            path: '/var/log/nginx',
            label: 'nginx logs',
            createdAt: '2026-01-02T00:00:00.000Z'
          }
        ]
      }),
      'utf8'
    )

    writeFileSync(
      path.join(userDataDir, 'history.json'),
      JSON.stringify({
        entries: [
          {
            id: 'hist-1',
            kind: 'transfer',
            direction: 'upload',
            label: 'release.tar.gz',
            sessionId: 'site-1',
            bytes: 4096,
            startedAt: 1000,
            finishedAt: 2000,
            status: 'done'
          }
        ]
      }),
      'utf8'
    )

    writeFileSync(
      path.join(userDataDir, 'known_hosts.json'),
      JSON.stringify({
        hosts: {
          'prod.example.com:22': 'SHA256:abcdef1234567890'
        }
      }),
      'utf8'
    )

    // 2. Boot Neutralino Node host against the existing Electron data directory.
    const unwrappedKey = unwrapOrCreateMasterKey(userDataDir)
    expect(unwrappedKey.equals(masterKey)).toBe(true)
    setHost(createNodeHost(unwrappedKey, userDataDir, () => {}))

    const { SiteStore } = await import('../sites/SiteStore')
    const { AppSettingsStore } = await import('../app/AppSettingsStore')
    const { BookmarkStore } = await import('../bookmarks/BookmarkStore')
    const { HistoryStore } = await import('../history/HistoryStore')
    const { KnownHostsStore } = await import('../ssh/KnownHostsStore')

    const siteStore = SiteStore.getInstance()
    expect(siteStore.list().map((s) => s.name)).toEqual(['Prod Web'])
    expect(siteStore.getDecryptedSecrets('site-1').password).toBe('electron-secret-pw')
    expect(siteStore.getDecryptedJumpHosts('site-1')[0].passphrase).toBe('jump-passphrase')
    expect(siteStore.getDecryptedProxy('site-1')?.password).toBe('proxy-secret')

    const settingsStore = AppSettingsStore.getInstance()
    expect(settingsStore.get().openTabSiteIds).toEqual(['site-1'])
    expect(settingsStore.get().bandwidthLimitKBps).toBe(2048)
    expect(settingsStore.getDecryptedDefaultProxy()).toEqual(
      expect.objectContaining({ host: 'corp-proxy.local', password: 'corp-pw' })
    )

    expect(BookmarkStore.getInstance().list()).toHaveLength(1)
    expect(HistoryStore.getInstance().list()).toHaveLength(1)
    expect(KnownHostsStore.getInstance().get('prod.example.com', 22)).toBe('SHA256:abcdef1234567890')

    // 3. Write a new site in Neutralino mode and confirm v10 ciphertext still decrypts under Electron/Chromium box.
    const created = siteStore.create({
      name: 'Added In Neutralino',
      host: 'staging.example.com',
      port: 22,
      username: 'ubuntu',
      authMethod: 'password',
      password: 'neutralino-new-password'
    })

    const rawSites = JSON.parse(readFileSync(path.join(userDataDir, 'sites.json'), 'utf8')) as {
      sites: Array<{ id: string; secretPassword?: string }>
    }
    const storedNew = rawSites.sites.find((s) => s.id === created.id)
    expect(storedNew?.secretPassword).toBeTruthy()
    const rawPrefix = Buffer.from(storedNew!.secretPassword!, 'base64').subarray(0, 3).toString('ascii')
    expect(rawPrefix).toBe('v10')
    expect(box.decrypt(storedNew!.secretPassword!)).toBe('neutralino-new-password')
  })
})

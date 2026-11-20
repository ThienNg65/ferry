import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { setHost } from '../host/host'
import { testHost } from '../host/testHost.setup'
import { EVENT_CHANNELS } from '../../shared/contract'
import { compareSemver, isValidSha512Base64, parseUpdateManifest, SidecarUpdater } from './SidecarUpdater'

const sendMock = vi.fn()
const hostState = { isPackaged: false, appVersion: '0.24.0' }

const appSettingsMock = {
  get: vi.fn(() => ({ autoCheckUpdates: true }))
}

vi.mock('../app/AppSettingsStore', () => ({
  AppSettingsStore: {
    getInstance: () => appSettingsMock
  }
}))

const autoUpdaterListeners = new Map<string, Array<(...args: unknown[]) => void>>()
const autoUpdaterMock = {
  autoDownload: true,
  autoInstallOnAppQuit: false,
  on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    const list = autoUpdaterListeners.get(event) ?? []
    list.push(cb)
    autoUpdaterListeners.set(event, list)
  }),
  emitMock(event: string, ...args: unknown[]) {
    for (const cb of autoUpdaterListeners.get(event) ?? []) {
      cb(...args)
    }
  },
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn(async (): Promise<void> => undefined),
  clearDownloaded: vi.fn(),
  getDownloadedInfo: vi.fn(() => ({
    version: '0.24.0' as string | null,
    installerPath: 'C:\\tmp\\Ferry-Setup-0.24.0.exe' as string | null
  }))
}

const resetSidecarUpdaterMock = vi.fn()
let realUpdaterOverride: SidecarUpdater | null = null

vi.mock('./SidecarUpdater', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./SidecarUpdater')>()
  return {
    ...actual,
    getSidecarUpdater: () => realUpdaterOverride ?? autoUpdaterMock,
    resetSidecarUpdaterForTests: () => {
      resetSidecarUpdaterMock()
      realUpdaterOverride?.dispose()
      realUpdaterOverride = null
    }
  }
})

function makeSpawnMock(outcome: 'spawn' | Error): {
  spawnMock: ReturnType<typeof vi.fn>
  unrefMock: ReturnType<typeof vi.fn>
} {
  const unrefMock = vi.fn()
  const spawnMock = vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> }
    child.unref = unrefMock
    queueMicrotask(() => {
      if (outcome === 'spawn') {
        child.emit('spawn')
      } else {
        child.emit('error', outcome)
      }
    })
    return child
  })
  return { spawnMock, unrefMock }
}

describe('AutoUpdater', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    autoUpdaterListeners.clear()
    appSettingsMock.get.mockReturnValue({ autoCheckUpdates: true })
    autoUpdaterMock.autoDownload = true
    autoUpdaterMock.autoInstallOnAppQuit = false
    autoUpdaterMock.quitAndInstall.mockResolvedValue(undefined)
    autoUpdaterMock.getDownloadedInfo.mockReturnValue({
      version: '0.24.0',
      installerPath: 'C:\\tmp\\Ferry-Setup-0.24.0.exe'
    })
    realUpdaterOverride = null
    hostState.isPackaged = false
    hostState.appVersion = '0.24.0'
    setHost({
      ...testHost,
      broadcast: sendMock,
      get isPackaged() {
        return hostState.isPackaged
      },
      get appVersion() {
        return hostState.appVersion
      }
    })
    const { resetAutoUpdaterForTests } = await import('./AutoUpdater')
    resetAutoUpdaterForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks state as disabled and does not call checkForUpdates in unpackaged dev mode', async () => {
    const { initAutoUpdater, getUpdateState, checkForUpdates } = await import('./AutoUpdater')
    await initAutoUpdater()
    expect(getUpdateState().status).toBe('disabled')
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()

    const checkResult = await checkForUpdates(true)
    expect(checkResult.status).toBe('disabled')
    expect(checkResult.error).toMatch(/development mode/)
  })

  it('calls checkForUpdates and handles not-available in packaged mode', async () => {
    hostState.isPackaged = true
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce({
      updateInfo: { version: '0.24.0' }
    })

    const { checkForUpdates, getUpdateState } = await import('./AutoUpdater')
    const result = await checkForUpdates(true)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledOnce()
    expect(result.status).toBe('not-available')
    expect(getUpdateState().status).toBe('not-available')
  })

  it('calls checkForUpdates and handles available version in packaged mode', async () => {
    hostState.isPackaged = true
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce({
      updateInfo: { version: '0.25.0' }
    })

    const { checkForUpdates } = await import('./AutoUpdater')
    const result = await checkForUpdates(true)
    expect(result.status).toBe('available')
    expect(result.version).toBe('0.25.0')
  })

  it('delegates installUpdateNow to updater quitAndInstall', async () => {
    const { installUpdateNow } = await import('./AutoUpdater')
    await installUpdateNow()
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('configures the updater before a manual check that runs ahead of startup init', async () => {
    hostState.isPackaged = true
    autoUpdaterMock.autoInstallOnAppQuit = true
    autoUpdaterMock.checkForUpdates.mockResolvedValue({ updateInfo: { version: '0.25.0' } })

    const { checkForUpdates } = await import('./AutoUpdater')
    const result = await checkForUpdates(true)

    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(autoUpdaterListeners.has('update-downloaded')).toBe(true)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledOnce()
    expect(result.status).toBe('available')
  })

  it('wires updater events, rounds progress, and clears stale fields across transitions', async () => {
    hostState.isPackaged = true
    const { initAutoUpdater, getUpdateState } = await import('./AutoUpdater')
    await initAutoUpdater(false)
    sendMock.mockClear()

    autoUpdaterMock.emitMock('update-available', { version: '0.25.0' })
    expect(getUpdateState()).toMatchObject({ status: 'downloading', availableVersion: '0.25.0', error: undefined })
    expect(sendMock).toHaveBeenCalledWith(EVENT_CHANNELS.updateAvailable, { version: '0.25.0' })

    autoUpdaterMock.emitMock('download-progress', {
      percent: 42.6,
      bytesPerSecond: 1024.4,
      transferred: 512,
      total: 1200
    })
    expect(getUpdateState().progress).toEqual({
      percent: 43,
      bytesPerSecond: 1024,
      transferred: 512,
      total: 1200
    })

    autoUpdaterMock.emitMock('error', new Error('download dropped'))
    expect(getUpdateState()).toMatchObject({
      status: 'error',
      availableVersion: undefined,
      progress: undefined,
      error: 'download dropped'
    })

    autoUpdaterMock.emitMock('update-downloaded', { version: '0.25.0' })
    expect(getUpdateState()).toMatchObject({
      status: 'downloaded',
      availableVersion: '0.25.0',
      progress: undefined,
      error: undefined
    })
    expect(sendMock).toHaveBeenCalledWith(EVENT_CHANNELS.updateDownloaded, { version: '0.25.0' })

    autoUpdaterMock.emitMock('update-not-available')
    expect(getUpdateState()).toMatchObject({
      status: 'not-available',
      availableVersion: undefined,
      progress: undefined,
      error: undefined
    })
  })

  it('guards concurrent checkForUpdates calls while checking or downloading', async () => {
    hostState.isPackaged = true
    let resolveCheck!: (val: { updateInfo: { version: string } }) => void
    autoUpdaterMock.checkForUpdates.mockImplementationOnce(
      () => new Promise((resolve) => { resolveCheck = resolve })
    )

    const { checkForUpdates } = await import('./AutoUpdater')
    const first = checkForUpdates(true)
    await vi.waitFor(() => expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledOnce())

    const second = await checkForUpdates(true)
    expect(second).toEqual({ status: 'checking', version: undefined })
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledOnce()

    resolveCheck({ updateInfo: { version: '0.25.0' } })
    await first

    autoUpdaterMock.emitMock('update-available', { version: '0.25.0' })
    const third = await checkForUpdates(true)
    expect(third).toEqual({ status: 'downloading', version: '0.25.0' })
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('broadcasts error once on check failure and recovers on retry', async () => {
    hostState.isPackaged = true
    autoUpdaterMock.checkForUpdates
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({ updateInfo: { version: '0.25.0' } })

    const { checkForUpdates, getUpdateState } = await import('./AutoUpdater')
    const failed = await checkForUpdates(true)
    expect(failed).toEqual({ status: 'error', error: 'network timeout' })
    expect(getUpdateState()).toMatchObject({ status: 'error', error: 'network timeout', availableVersion: undefined })

    const errorBroadcasts = sendMock.mock.calls.filter(
      ([ch, payload]) => ch === EVENT_CHANNELS.updateStatus && payload?.status === 'error'
    )
    expect(errorBroadcasts).toHaveLength(1)

    const retried = await checkForUpdates(true)
    expect(retried).toEqual({ status: 'available', version: '0.25.0' })
  })

  it('respects autoCheckUpdates setting and skips periodic check once downloaded', async () => {
    vi.useFakeTimers()
    hostState.isPackaged = true
    appSettingsMock.get.mockReturnValue({ autoCheckUpdates: false })

    const { initAutoUpdater, resetAutoUpdaterForTests } = await import('./AutoUpdater')
    await initAutoUpdater(true)
    await initAutoUpdater(true) // double init is a no-op
    expect(autoUpdaterListeners.get('checking-for-update')).toHaveLength(1)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()

    resetAutoUpdaterForTests()
    expect(resetSidecarUpdaterMock).toHaveBeenCalled()
    appSettingsMock.get.mockReturnValue({ autoCheckUpdates: true })
    autoUpdaterMock.checkForUpdates.mockResolvedValue({ updateInfo: { version: '0.25.0' } })

    await initAutoUpdater(false)
    autoUpdaterMock.emitMock('update-downloaded', { version: '0.25.0' })
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })

  it('guards installUpdateNow re-entrancy and distinguishes recoverable vs invalidated failures', async () => {
    hostState.isPackaged = true
    const { initAutoUpdater, installUpdateNow, getUpdateState } = await import('./AutoUpdater')
    await initAutoUpdater(false)
    autoUpdaterMock.emitMock('update-downloaded', { version: '0.25.0' })

    let resolveInstall!: () => void
    autoUpdaterMock.quitAndInstall.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveInstall = resolve })
    )
    const p1 = installUpdateNow()
    const p2 = installUpdateNow()
    await vi.waitFor(() => expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce())
    resolveInstall()
    await Promise.all([p1, p2])

    // Recoverable spawn failure (e.g. EACCES): installerPath still intact -> keeps downloaded status
    autoUpdaterMock.quitAndInstall.mockRejectedValueOnce(new Error('spawn EACCES'))
    await expect(installUpdateNow()).rejects.toThrow('spawn EACCES')
    expect(getUpdateState().status).toBe('downloaded')

    // Invalidated binary: installerPath cleared -> sets error status
    autoUpdaterMock.getDownloadedInfo.mockReturnValueOnce({ version: null, installerPath: null })
    autoUpdaterMock.quitAndInstall.mockRejectedValueOnce(new Error('SHA-512 verification failed'))
    await expect(installUpdateNow()).rejects.toThrow('SHA-512 verification failed')
    expect(getUpdateState()).toMatchObject({ status: 'error', error: 'SHA-512 verification failed' })
  })

  describe('AutoUpdater + SidecarUpdater integration', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ferry-autoupdater-int-'))
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('runs non-blocking check, streams download to downloaded state, and verifies before exit', async () => {
      hostState.isPackaged = true
      hostState.appVersion = '0.24.0'
      const payload = Buffer.from('MZ-integration-installer-bytes')
      const sha512 = createHash('sha512').update(payload).digest('base64')
      const yaml = `version: 0.25.0\npath: Ferry-Setup-0.25.0.exe\nsha512: ${sha512}\nsize: ${payload.length}\n`

      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/latest.yml')) return new Response(yaml, { status: 200 })
        if (url.endsWith('/Ferry-Setup-0.25.0.exe')) {
          return new Response(new Uint8Array(payload), {
            status: 200,
            headers: { 'content-length': String(payload.length) }
          })
        }
        return new Response('not found', { status: 404 })
      }) as unknown as typeof fetch

      const { spawnMock, unrefMock } = makeSpawnMock('spawn')
      const exitMock = vi.fn()

      realUpdaterOverride = new SidecarUpdater({
        feedUrl: 'https://example.invalid/releases',
        downloadDir: tmpDir,
        fetchImpl: fetchMock,
        spawnImpl: spawnMock as unknown as typeof import('child_process').spawn,
        exitImpl: exitMock,
        exitDelayMs: 25
      })

      const { checkForUpdates, getUpdateState, installUpdateNow } = await import('./AutoUpdater')
      const checkRes = await checkForUpdates(true)
      expect(checkRes).toEqual({ status: 'available', version: '0.25.0' })

      await vi.waitFor(() => expect(getUpdateState().status).toBe('downloaded'))
      expect(sendMock).toHaveBeenCalledWith(EVENT_CHANNELS.updateAvailable, { version: '0.25.0' })
      expect(sendMock).toHaveBeenCalledWith(EVENT_CHANNELS.updateDownloaded, { version: '0.25.0' })

      await installUpdateNow()
      expect(spawnMock).toHaveBeenCalledWith(
        path.join(tmpDir, 'Ferry-Setup-0.25.0.exe'),
        ['--updated', '/S', '--force-run'],
        { detached: true, stdio: 'ignore' }
      )
      expect(unrefMock).toHaveBeenCalledOnce()
      expect(exitMock).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(exitMock).toHaveBeenCalledWith(0))
    })
  })
})

describe('SidecarUpdater', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ferry-sidecar-updater-'))
    setHost({
      ...testHost,
      isPackaged: true,
      appVersion: '0.22.0'
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function fakeFetchFor(yamlBody: string, installerBytes: Buffer): typeof fetch {
    return vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/latest.yml')) {
        return new Response(yamlBody, { status: 200 })
      }
      if (url.endsWith('.exe')) {
        return new Response(new Uint8Array(installerBytes), {
          status: 200,
          headers: { 'content-length': String(installerBytes.length) }
        })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch
  }

  it('downloads non-blockingly, re-verifies SHA-512 before spawn, and schedules exit after reply', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const payload = Buffer.from('MZ-fake-neutralino-installer-binary')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\nsize: ${payload.length}\n`

    const { spawnMock, unrefMock } = makeSpawnMock('spawn')
    const exitMock = vi.fn()
    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fakeFetchFor(yaml, payload),
      spawnImpl: spawnMock as unknown as typeof import('child_process').spawn,
      exitImpl: exitMock,
      exitDelayMs: 1500
    })

    const downloaded: string[] = []
    const progressEvents: number[] = []
    updater.on('update-downloaded', (info) => downloaded.push(info.version))
    updater.on('download-progress', (p) => progressEvents.push(p.percent))

    const res = await updater.checkForUpdates()
    expect(res.updateInfo.version).toBe('0.24.0')
    expect(res.downloadPromise).toBeDefined()
    await res.downloadPromise
    expect(downloaded).toEqual(['0.24.0'])
    expect(progressEvents.at(-1)).toBe(100)

    await updater.quitAndInstall(true, true)
    expect(spawnMock).toHaveBeenCalledWith(
      path.join(tmpDir, 'Ferry-Setup-0.24.0.exe'),
      ['--updated', '/S', '--force-run'],
      { detached: true, stdio: 'ignore' }
    )
    expect(unrefMock).toHaveBeenCalledOnce()
    // Sidecar remains alive until fallback delay elapses so IPC reply can flush first.
    expect(exitMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    expect(exitMock).toHaveBeenCalledWith(0)
  })

  it('re-verifies SHA-512 before launch and aborts without exiting if tampered or deleted', async () => {
    const payload = Buffer.from('MZ-original-verified-installer')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\n`

    const spawnMock = vi.fn()
    const exitMock = vi.fn()
    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fakeFetchFor(yaml, payload),
      spawnImpl: spawnMock as unknown as typeof import('child_process').spawn,
      exitImpl: exitMock,
      exitDelayMs: 0
    })

    const res = await updater.checkForUpdates()
    await res.downloadPromise

    const downloadedPath = path.join(tmpDir, 'Ferry-Setup-0.24.0.exe')
    writeFileSync(downloadedPath, 'MZ-tampered-after-download')

    await expect(updater.quitAndInstall()).rejects.toThrow(/SHA-512 verification failed before launching/)
    expect(spawnMock).not.toHaveBeenCalled()
    expect(exitMock).not.toHaveBeenCalled()
    expect(updater.getDownloadedInfo()).toEqual({ version: null, installerPath: null })

    // Re-download then delete file on disk
    const res2 = await updater.checkForUpdates()
    await res2.downloadPromise
    rmSync(downloadedPath)
    await expect(updater.quitAndInstall()).rejects.toThrow(/No verified update installer/)
    expect(spawnMock).not.toHaveBeenCalled()
    expect(exitMock).not.toHaveBeenCalled()
  })

  it('handles installer spawn error (EACCES) cleanly without exiting or clearing downloaded state', async () => {
    const payload = Buffer.from('MZ-valid-installer')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\n`

    const { spawnMock } = makeSpawnMock(Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }))
    const exitMock = vi.fn()
    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fakeFetchFor(yaml, payload),
      spawnImpl: spawnMock as unknown as typeof import('child_process').spawn,
      exitImpl: exitMock,
      exitDelayMs: 0
    })

    const res = await updater.checkForUpdates()
    await res.downloadPromise

    await expect(updater.quitAndInstall()).rejects.toThrow(/EACCES/)
    expect(exitMock).not.toHaveBeenCalled()
    expect(updater.getDownloadedInfo().installerPath).toBe(path.join(tmpDir, 'Ferry-Setup-0.24.0.exe'))
  })

  it('rejects installers whose SHA-512 digest mismatches the manifest and emits error once', async () => {
    const payload = Buffer.from('tampered-binary')
    const wrongSha = createHash('sha512').update('expected-binary').digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${wrongSha}\n`

    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fakeFetchFor(yaml, payload)
    })

    const errors: Error[] = []
    updater.on('error', (err) => errors.push(err))

    const res = await updater.checkForUpdates()
    await expect(res.downloadPromise).rejects.toThrow(/SHA-512 verification failed/)
    expect(errors).toHaveLength(1)
    await expect(updater.quitAndInstall()).rejects.toThrow(/No verified update installer/)
  })

  it('fetches canonical latest.yml without falling back and does not emit error on manifest failure', async () => {
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch

    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fetchMock
    })

    const errorListener = vi.fn()
    updater.on('error', errorListener)

    await expect(updater.checkForUpdates()).rejects.toThrow(/No update manifest \(latest\.yml\)/)
    expect(errorListener).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toMatch(/\/latest\.yml$/)
  })

  it('rejects non-canonical installer filenames inside latest.yml', async () => {
    const payload = Buffer.from('legacy-installer')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Neutralino-Setup-0.24.0.exe\nsha512: ${sha512}\n`

    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fakeFetchFor(yaml, payload)
    })

    await expect(updater.checkForUpdates()).rejects.toThrow(/Refusing unexpected installer/)
  })

  it('validates redirect hops manually, allowing trusted GitHub hosts and blocking downgrades or untrusted origins', async () => {
    const payload = Buffer.from('MZ-redirected-installer')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\n`

    // 1. HTTPS -> trusted GitHub CDN succeeds
    const trustedFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://github.com/ThienNg65/ferry-release/releases/latest/download/latest.yml') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://objects.githubusercontent.com/assets/latest.yml' }
        })
      }
      if (url === 'https://objects.githubusercontent.com/assets/latest.yml') {
        return new Response(yaml, { status: 200 })
      }
      if (url === 'https://github.com/ThienNg65/ferry-release/releases/latest/download/Ferry-Setup-0.24.0.exe') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/Ferry-Setup-0.24.0.exe' }
        })
      }
      if (url === 'https://release-assets.githubusercontent.com/Ferry-Setup-0.24.0.exe') {
        return new Response(new Uint8Array(payload), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch

    const okUpdater = new SidecarUpdater({
      feedUrl: 'https://github.com/ThienNg65/ferry-release/releases/latest/download',
      downloadDir: tmpDir,
      fetchImpl: trustedFetch
    })
    const okRes = await okUpdater.checkForUpdates()
    await expect(okRes.downloadPromise).resolves.toBe(path.join(tmpDir, 'Ferry-Setup-0.24.0.exe'))

    // 2. HTTPS -> HTTP protocol downgrade blocked
    const downgradeFetch = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'http://github.com/insecure/latest.yml' } })
    ) as unknown as typeof fetch
    const downgradeUpdater = new SidecarUpdater({
      feedUrl: 'https://github.com/ThienNg65/ferry-release/releases/latest/download',
      downloadDir: tmpDir,
      fetchImpl: downgradeFetch
    })
    await expect(downgradeUpdater.checkForUpdates()).rejects.toThrow(/Refusing insecure non-HTTPS/)

    // 3. Untrusted redirect origin blocked
    const evilFetch = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://evil.example.net/latest.yml' } })
    ) as unknown as typeof fetch
    const evilUpdater = new SidecarUpdater({
      feedUrl: 'https://github.com/ThienNg65/ferry-release/releases/latest/download',
      downloadDir: tmpDir,
      fetchImpl: evilFetch
    })
    await expect(evilUpdater.checkForUpdates()).rejects.toThrow(/Refusing untrusted update origin/)

    // 4. Too many redirects blocked
    const loopFetch = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://github.com/loop' } })
    ) as unknown as typeof fetch
    const loopUpdater = new SidecarUpdater({
      feedUrl: 'https://github.com/ThienNg65/ferry-release/releases/latest/download',
      downloadDir: tmpDir,
      fetchImpl: loopFetch
    })
    await expect(loopUpdater.checkForUpdates()).rejects.toThrow(/Too many redirects/)
  })

  it('handles download file stream error without crashing or hanging', async () => {
    const payload = Buffer.from('MZ-stream-error-test')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\n`

    // Pre-create a directory at tmpPath so createWriteStream fails with EISDIR.
    mkdirSync(path.join(tmpDir, 'Ferry-Setup-0.24.0.exe.tmp'))

    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fakeFetchFor(yaml, payload)
    })
    const errors: Error[] = []
    updater.on('error', (e) => errors.push(e))

    const res = await updater.checkForUpdates()
    await expect(res.downloadPromise).rejects.toThrow()
    expect(errors).toHaveLength(1)
  })

  it('deduplicates concurrent checkForUpdates calls', async () => {
    const payload = Buffer.from('MZ-concurrent-check')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\n`
    const fetchMock = fakeFetchFor(yaml, payload)

    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fetchMock
    })

    const [r1, r2] = await Promise.all([updater.checkForUpdates(), updater.checkForUpdates()])
    expect(r1.updateInfo.version).toBe('0.24.0')
    expect(r2.updateInfo.version).toBe('0.24.0')
    await r1.downloadPromise

    const manifestCalls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) =>
      String(u).endsWith('/latest.yml')
    )
    expect(manifestCalls).toHaveLength(1)
  })

  it('parses multi-entry files blocks safely and validates SHA-512 format', () => {
    const validSha = createHash('sha512').update('setup').digest('base64')
    const otherSha = createHash('sha512').update('zip').digest('base64')
    expect(isValidSha512Base64(validSha)).toBe(true)
    expect(isValidSha512Base64('not-a-sha512')).toBe(false)

    const multiEntryYaml = [
      'version: 0.25.0',
      'files:',
      '  - url: Ferry-Portable-0.25.0-win-x64.zip',
      `    sha512: ${otherSha}`,
      '    size: 1111',
      '  - url: Ferry-Setup-0.25.0.exe',
      `    sha512: ${validSha}`,
      '    size: 2222',
      "releaseDate: '2026-11-18T00:00:00.000Z'"
    ].join('\n')

    expect(parseUpdateManifest(multiEntryYaml)).toEqual({
      version: '0.25.0',
      path: 'Ferry-Setup-0.25.0.exe',
      sha512: validSha,
      size: 2222
    })

    expect(
      parseUpdateManifest('version: 0.25.0\npath: Ferry-Setup-0.25.0.exe\nsha512: invalid-digest\n')
    ).toBeNull()
  })

  it('compares semver versions including prereleases and v prefixes', () => {
    expect(compareSemver('0.24.0', '0.24.0')).toBe(0)
    expect(compareSemver('v0.25.0', '0.24.9')).toBeGreaterThan(0)
    expect(compareSemver('0.24.0-rc.1', '0.24.0')).toBeLessThan(0)
    expect(compareSemver('0.24.0', '0.24.0-rc.1')).toBeGreaterThan(0)
    expect(compareSemver('0.21.0', '0.22.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-rc-2', '1.0.0-rc-1')).toBeGreaterThan(0)
  })

  it('orders large numeric prerelease identifiers precisely and ignores build metadata', () => {
    expect(compareSemver('1.0.0-rc.9007199254740993', '1.0.0-rc.9007199254740992')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-rc.9007199254740992', '1.0.0-rc.9007199254740993')).toBeLessThan(0)
    expect(compareSemver('1.0.0-rc.9999999999', '1.0.0-rc.alpha')).toBeLessThan(0)
    expect(compareSemver('1.0.0-rc.2+build.2', '1.0.0-rc.2+build.10')).toBe(0)
    expect(compareSemver('9007199254740993.0.0', '9007199254740992.0.0')).toBeGreaterThan(0)
  })

  it('aborts manifest fetch when the feed stalls past manifestTimeoutMs', async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new Error('Aborted'))
        })
      })
    }) as unknown as typeof fetch

    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fetchMock,
      manifestTimeoutMs: 25
    })

    await expect(updater.checkForUpdates()).rejects.toThrow(/timed out/i)
  })

  it('aborts stalled installer download and cleans up temporary file', async () => {
    const payload = Buffer.from('partial-installer')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\n`

    let call = 0
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      call++
      if (call === 1) {
        return new Response(yaml, { status: 200 })
      }
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new Error('Aborted'))
        })
      })
    }) as unknown as typeof fetch

    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fetchMock,
      downloadIdleTimeoutMs: 25
    })

    const res = await updater.checkForUpdates()
    await expect(res.downloadPromise).rejects.toThrow(/stalled/i)
    expect(existsSync(path.join(tmpDir, 'Ferry-Setup-0.24.0.exe.tmp'))).toBe(false)
  })

  it('aborts mid-stream stalled installer download after writing chunks and cleans up .tmp', async () => {
    const payload = Buffer.from('partial-installer-stream')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\n`

    let call = 0
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      call++
      if (call === 1) {
        return new Response(yaml, { status: 200 })
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(Buffer.from('MZ-chunk-1')))
          init?.signal?.addEventListener('abort', () => {
            controller.error(init.signal?.reason ?? new Error('Aborted'))
          })
        }
      })
      return new Response(stream, { status: 200 })
    }) as unknown as typeof fetch

    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fetchMock,
      downloadIdleTimeoutMs: 25
    })

    const res = await updater.checkForUpdates()
    await expect(res.downloadPromise).rejects.toThrow(/stalled/i)
    expect(existsSync(path.join(tmpDir, 'Ferry-Setup-0.24.0.exe.tmp'))).toBe(false)
  })

  it('skips downloading when autoDownload is false', async () => {
    const payload = Buffer.from('MZ-manual-download')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\n`
    const fetchMock = fakeFetchFor(yaml, payload)

    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fetchMock
    })
    updater.autoDownload = false

    const available: string[] = []
    const downloaded: string[] = []
    updater.on('update-available', (info) => available.push(info.version))
    updater.on('update-downloaded', (info) => downloaded.push(info.version))

    const res = await updater.checkForUpdates()
    expect(res).toEqual({ updateInfo: { version: '0.24.0' } })
    expect(res.downloadPromise).toBeUndefined()
    expect(available).toEqual(['0.24.0'])
    expect(downloaded).toEqual([])
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })

  it('surfaces HTTP 4xx/5xx errors on manifest fetch and installer download', async () => {
    const payload = Buffer.from('MZ-http-err')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\n`

    // 1. HTTP 503 on latest.yml -> rejects checkForUpdates without emitting 'error'
    const manifest503Updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: vi.fn(async () => new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' })) as unknown as typeof fetch
    })
    const manifestErrors: Error[] = []
    manifest503Updater.on('error', (err) => manifestErrors.push(err))
    await expect(manifest503Updater.checkForUpdates()).rejects.toThrow(/Update manifest fetch failed \(503/)
    expect(manifestErrors).toHaveLength(0)

    // 2. HTTP 403 on installer download -> background downloadPromise rejects and emits 'error' once
    const download403Fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/latest.yml')) {
        return new Response(yaml, { status: 200 })
      }
      return new Response('Forbidden', { status: 403, statusText: 'Forbidden' })
    }) as unknown as typeof fetch
    const download403Updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: download403Fetch
    })
    const downloadErrors: Error[] = []
    download403Updater.on('error', (err) => downloadErrors.push(err))
    const res = await download403Updater.checkForUpdates()
    await expect(res.downloadPromise).rejects.toThrow(/Installer download failed \(403/)
    expect(downloadErrors).toHaveLength(1)
  })

  it('emits monotonic download-progress events across streamed chunks', async () => {
    const chunk1 = Buffer.from('MZ-chunk-one-')
    const chunk2 = Buffer.from('MZ-chunk-two!')
    const payload = Buffer.concat([chunk1, chunk2])
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\nsize: ${payload.length}\n`

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/latest.yml')) {
        return new Response(yaml, { status: 200 })
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(chunk1))
          controller.enqueue(new Uint8Array(chunk2))
          controller.close()
        }
      })
      return new Response(stream, {
        status: 200,
        headers: { 'content-length': String(payload.length) }
      })
    }) as unknown as typeof fetch

    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fetchMock
    })

    const progressEvents: Array<{ percent: number; transferred: number; total: number }> = []
    updater.on('download-progress', (p) =>
      progressEvents.push({ percent: p.percent, transferred: p.transferred, total: p.total })
    )

    const res = await updater.checkForUpdates()
    await res.downloadPromise

    expect(progressEvents).toHaveLength(2)
    expect(progressEvents[0]).toEqual({
      percent: (chunk1.length / payload.length) * 100,
      transferred: chunk1.length,
      total: payload.length
    })
    expect(progressEvents[1]).toEqual({
      percent: 100,
      transferred: payload.length,
      total: payload.length
    })
  })

  it('disables update checks when FERRY_STORE_BUILD=1 even if packaged', async () => {
    const { checkForUpdates, getUpdateState, resetAutoUpdaterForTests } = await import('./AutoUpdater')
    const prev = process.env['FERRY_STORE_BUILD']
    process.env['FERRY_STORE_BUILD'] = '1'
    hostState.isPackaged = true
    resetAutoUpdaterForTests()
    try {
      const res = await checkForUpdates(true)
      expect(res.status).toBe('disabled')
      expect(getUpdateState().status).toBe('disabled')
    } finally {
      if (prev === undefined) {
        delete process.env['FERRY_STORE_BUILD']
      } else {
        process.env['FERRY_STORE_BUILD'] = prev
      }
      resetAutoUpdaterForTests()
    }
  })
})

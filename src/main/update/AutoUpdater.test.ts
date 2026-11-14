import { createHash } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { setHost } from '../host/host'
import { testHost } from '../host/testHost.setup'
import { SidecarUpdater } from './SidecarUpdater'

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

const autoUpdaterListeners = new Map<string, (...args: unknown[]) => void>()
const autoUpdaterMock = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    autoUpdaterListeners.set(event, cb)
  }),
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn()
}

vi.mock('./SidecarUpdater', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./SidecarUpdater')>()
  return {
    ...actual,
    getSidecarUpdater: () => autoUpdaterMock
  }
})

describe('AutoUpdater', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    autoUpdaterListeners.clear()
    hostState.isPackaged = false
    hostState.appVersion = '0.14.11'
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
      updateInfo: { version: '0.14.11' }
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
      updateInfo: { version: '0.15.0' }
    })

    const { checkForUpdates } = await import('./AutoUpdater')
    const result = await checkForUpdates(true)
    expect(result.status).toBe('available')
    expect(result.version).toBe('0.15.0')
  })

  it('delegates installUpdateNow to updater quitAndInstall', async () => {
    const { installUpdateNow } = await import('./AutoUpdater')
    await installUpdateNow()
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('configures the updater before a manual check that runs ahead of startup init', async () => {
    hostState.isPackaged = true
    autoUpdaterMock.autoInstallOnAppQuit = true
    autoUpdaterMock.checkForUpdates.mockResolvedValue({ updateInfo: { version: '0.15.0' } })

    const { checkForUpdates } = await import('./AutoUpdater')
    const result = await checkForUpdates(true)

    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(autoUpdaterListeners.has('update-downloaded')).toBe(true)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledOnce()
    expect(result.status).toBe('available')
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

  it('downloads, verifies SHA-512, and launches the canonical installer on quitAndInstall', async () => {
    const payload = Buffer.from('MZ-fake-neutralino-installer-binary')
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${sha512}\nsize: ${payload.length}\n`

    const unrefMock = vi.fn()
    const spawnMock = vi.fn(() => ({ unref: unrefMock }))
    const exitMock = vi.fn()
    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fakeFetchFor(yaml, payload),
      spawnImpl: spawnMock as unknown as typeof import('child_process').spawn,
      exitImpl: exitMock
    })

    const downloaded: string[] = []
    updater.on('update-downloaded', (info) => downloaded.push(info.version))

    const res = await updater.checkForUpdates()
    expect(res.updateInfo.version).toBe('0.24.0')
    expect(downloaded).toEqual(['0.24.0'])

    updater.quitAndInstall(true, true)
    expect(spawnMock).toHaveBeenCalledWith(
      path.join(tmpDir, 'Ferry-Setup-0.24.0.exe'),
      ['--updated', '/S', '--force-run'],
      { detached: true, stdio: 'ignore' }
    )
    expect(unrefMock).toHaveBeenCalledOnce()
    expect(exitMock).toHaveBeenCalledWith(0)
  })

  it('rejects installers whose SHA-512 digest mismatches the manifest', async () => {
    const payload = Buffer.from('tampered-binary')
    const wrongSha = createHash('sha512').update('expected-binary').digest('base64')
    const yaml = `version: 0.24.0\npath: Ferry-Setup-0.24.0.exe\nsha512: ${wrongSha}\n`

    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fakeFetchFor(yaml, payload)
    })

    await expect(updater.checkForUpdates()).rejects.toThrow(/SHA-512 verification failed/)
    expect(() => updater.quitAndInstall()).toThrow(/No verified update installer/)
  })

  it('fetches canonical latest.yml without falling back to latest-neutralino.yml', async () => {
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch

    const updater = new SidecarUpdater({
      feedUrl: 'https://example.invalid/releases',
      downloadDir: tmpDir,
      fetchImpl: fetchMock
    })

    await expect(updater.checkForUpdates()).rejects.toThrow(/No update manifest \(latest\.yml\)/)
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

    await expect(updater.checkForUpdates()).rejects.toThrow(/stalled/i)
    const { existsSync } = await import('fs')
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

    await expect(updater.checkForUpdates()).rejects.toThrow(/stalled/i)
    const { existsSync } = await import('fs')
    expect(existsSync(path.join(tmpDir, 'Ferry-Setup-0.24.0.exe.tmp'))).toBe(false)
  })
})

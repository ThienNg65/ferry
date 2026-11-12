import { describe, expect, it, vi, beforeEach } from 'vitest'

const appMock = {
  isPackaged: false,
  getVersion: vi.fn(() => '0.14.11')
}

const sendMock = vi.fn()
const getAllWindowsMock = vi.fn(() => [
  { isDestroyed: () => false, webContents: { send: sendMock } }
])

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: {
    getAllWindows: getAllWindowsMock
  }
}))

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

vi.mock('electron-updater', () => ({
  autoUpdater: autoUpdaterMock,
  default: {
    autoUpdater: autoUpdaterMock
  }
}))

describe('AutoUpdater', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    autoUpdaterListeners.clear()
    appMock.isPackaged = false
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
    appMock.isPackaged = true
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
    appMock.isPackaged = true
    autoUpdaterMock.checkForUpdates.mockResolvedValueOnce({
      updateInfo: { version: '0.15.0' }
    })

    const { checkForUpdates } = await import('./AutoUpdater')
    const result = await checkForUpdates(true)
    expect(result.status).toBe('available')
    expect(result.version).toBe('0.15.0')
  })

  it('delegates installUpdateNow to electron-updater quitAndInstall', async () => {
    const { installUpdateNow } = await import('./AutoUpdater')
    await installUpdateNow()
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledWith(true, true)
  })
})

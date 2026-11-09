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
  autoUpdater: autoUpdaterMock
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

  it('delegates installUpdateNow to electron-updater quitAndInstall', async () => {
    const { installUpdateNow } = await import('./AutoUpdater')
    await installUpdateNow()
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce()
  })
})

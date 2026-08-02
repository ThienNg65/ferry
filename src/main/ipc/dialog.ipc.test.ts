import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import type { IpcResult } from '../../shared/contract'

const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>()

const focusedWindow = { id: 'focused' }

const dialogMock = {
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn()
}

const browserWindowMock = {
  getFocusedWindow: vi.fn(() => focusedWindow as unknown),
  getAllWindows: vi.fn(() => [] as unknown[])
}

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, cb: (...args: unknown[]) => Promise<unknown>) => {
      registered.set(channel, cb)
    })
  },
  dialog: dialogMock,
  BrowserWindow: browserWindowMock
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('dialog.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    browserWindowMock.getFocusedWindow.mockReturnValue(focusedWindow as unknown)
    browserWindowMock.getAllWindows.mockReturnValue([])
    const { registerDialogHandlers } = await import('./dialog.ipc')
    registerDialogHandlers()
  })

  describe('dialog:pickFile', () => {
    it('returns the chosen path against the focused window', async () => {
      dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/a.txt'] })
      const result = await invoke('dialog:pickFile')
      expect(dialogMock.showOpenDialog).toHaveBeenCalledWith(focusedWindow, { properties: ['openFile'] })
      expect(result).toEqual({ ok: true, data: '/tmp/a.txt' })
    })

    it('falls back to the first available window when nothing is focused', async () => {
      browserWindowMock.getFocusedWindow.mockReturnValue(null)
      const fallback = { id: 'fallback' }
      browserWindowMock.getAllWindows.mockReturnValue([fallback])
      dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/b.txt'] })
      const result = await invoke('dialog:pickFile')
      expect(dialogMock.showOpenDialog).toHaveBeenCalledWith(fallback, { properties: ['openFile'] })
      expect(result).toEqual({ ok: true, data: '/tmp/b.txt' })
    })

    it('returns null when the dialog is cancelled', async () => {
      dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
      const result = await invoke('dialog:pickFile')
      expect(result).toEqual({ ok: true, data: null })
    })
  })

  describe('dialog:pickFolder', () => {
    it('returns the chosen directory path', async () => {
      dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/dir'] })
      const result = await invoke('dialog:pickFolder')
      expect(dialogMock.showOpenDialog).toHaveBeenCalledWith(focusedWindow, { properties: ['openDirectory'] })
      expect(result).toEqual({ ok: true, data: '/tmp/dir' })
    })

    it('returns null when cancelled', async () => {
      dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
      const result = await invoke('dialog:pickFolder')
      expect(result).toEqual({ ok: true, data: null })
    })
  })

  describe('dialog:pickSaveFile', () => {
    it('anchors a bare filename under ~/.ssh', async () => {
      dialogMock.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/home/u/.ssh/id_ed25519' })
      const result = await invoke('dialog:pickSaveFile', 'id_ed25519')
      expect(dialogMock.showSaveDialog).toHaveBeenCalledWith(focusedWindow, {
        defaultPath: path.join(os.homedir(), '.ssh', 'id_ed25519')
      })
      expect(result).toEqual({ ok: true, data: '/home/u/.ssh/id_ed25519' })
    })

    it('uses an absolute path as-is without anchoring under ~/.ssh', async () => {
      const absolute = path.join(path.parse(process.cwd()).root, 'custom', 'id_ed25519')
      dialogMock.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: absolute })
      await invoke('dialog:pickSaveFile', absolute)
      expect(dialogMock.showSaveDialog).toHaveBeenCalledWith(focusedWindow, { defaultPath: absolute })
    })

    it('passes no defaultPath option when none is supplied', async () => {
      dialogMock.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/tmp/x' })
      await invoke('dialog:pickSaveFile', undefined)
      expect(dialogMock.showSaveDialog).toHaveBeenCalledWith(focusedWindow, {})
    })

    it('returns null when cancelled', async () => {
      dialogMock.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined })
      const result = await invoke('dialog:pickSaveFile', 'id_ed25519')
      expect(result).toEqual({ ok: true, data: null })
    })
  })
})

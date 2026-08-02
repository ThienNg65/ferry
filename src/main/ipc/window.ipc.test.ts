import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { IpcResult } from '../../shared/contract'
import type { BrowserWindow } from 'electron'

const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, cb: (...args: unknown[]) => Promise<unknown>) => {
      registered.set(channel, cb)
    })
  }
}))

function makeFakeWindow(overrides: Partial<Record<'isMaximized', boolean>> = {}) {
  return {
    minimize: vi.fn(),
    unmaximize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => overrides.isMaximized ?? false)
  }
}

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('window.ipc', () => {
  beforeEach(() => {
    registered.clear()
    vi.clearAllMocks()
  })

  describe('window:minimize', () => {
    it('minimizes the main window when one exists', async () => {
      const win = makeFakeWindow()
      const { registerWindowHandlers } = await import('./window.ipc')
      registerWindowHandlers(() => win as unknown as BrowserWindow)
      const result = await invoke('window:minimize')
      expect(win.minimize).toHaveBeenCalledOnce()
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('is a no-op when there is no main window', async () => {
      const { registerWindowHandlers } = await import('./window.ipc')
      registerWindowHandlers(() => null)
      const result = await invoke('window:minimize')
      expect(result).toEqual({ ok: true, data: undefined })
    })
  })

  describe('window:maximizeToggle', () => {
    it('unmaximizes a currently-maximized window', async () => {
      const win = makeFakeWindow({ isMaximized: true })
      const { registerWindowHandlers } = await import('./window.ipc')
      registerWindowHandlers(() => win as unknown as BrowserWindow)
      await invoke('window:maximizeToggle')
      expect(win.unmaximize).toHaveBeenCalledOnce()
      expect(win.maximize).not.toHaveBeenCalled()
    })

    it('maximizes a currently-restored window', async () => {
      const win = makeFakeWindow({ isMaximized: false })
      const { registerWindowHandlers } = await import('./window.ipc')
      registerWindowHandlers(() => win as unknown as BrowserWindow)
      await invoke('window:maximizeToggle')
      expect(win.maximize).toHaveBeenCalledOnce()
      expect(win.unmaximize).not.toHaveBeenCalled()
    })

    it('is a no-op when there is no main window', async () => {
      const { registerWindowHandlers } = await import('./window.ipc')
      registerWindowHandlers(() => null)
      const result = await invoke('window:maximizeToggle')
      expect(result).toEqual({ ok: true, data: undefined })
    })
  })

  describe('window:close', () => {
    it('closes the main window when one exists', async () => {
      const win = makeFakeWindow()
      const { registerWindowHandlers } = await import('./window.ipc')
      registerWindowHandlers(() => win as unknown as BrowserWindow)
      await invoke('window:close')
      expect(win.close).toHaveBeenCalledOnce()
    })
  })

  describe('window:isMaximized', () => {
    it('reports true when the window is maximized', async () => {
      const win = makeFakeWindow({ isMaximized: true })
      const { registerWindowHandlers } = await import('./window.ipc')
      registerWindowHandlers(() => win as unknown as BrowserWindow)
      const result = await invoke('window:isMaximized')
      expect(result).toEqual({ ok: true, data: { isMaximized: true } })
    })

    it('reports false when there is no main window', async () => {
      const { registerWindowHandlers } = await import('./window.ipc')
      registerWindowHandlers(() => null)
      const result = await invoke('window:isMaximized')
      expect(result).toEqual({ ok: true, data: { isMaximized: false } })
    })
  })
})

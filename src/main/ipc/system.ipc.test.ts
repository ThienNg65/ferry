import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { IpcResult } from '../../shared/contract'

const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>()

const appMock = {
  getPath: vi.fn((name: string) => `/fake/${name}`),
  getVersion: vi.fn(() => '1.2.3')
}

const clipboardMock = {
  readText: vi.fn(() => 'clipboard text')
}

const nativeImageMock = {
  createFromDataURL: vi.fn(() => ({ isNativeImage: true }))
}

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, cb: (...args: unknown[]) => Promise<unknown>) => {
      registered.set(channel, cb)
    })
  },
  app: appMock,
  clipboard: clipboardMock,
  nativeImage: nativeImageMock
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('system.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    appMock.getPath.mockImplementation((name: string) => `/fake/${name}`)
    appMock.getVersion.mockReturnValue('1.2.3')
    clipboardMock.readText.mockReturnValue('clipboard text')
    const { registerSystemHandlers } = await import('./system.ipc')
    registerSystemHandlers()
  })

  describe('system:getDownloadsPath', () => {
    it('resolves the downloads path via app.getPath', async () => {
      const result = await invoke('system:getDownloadsPath')
      expect(appMock.getPath).toHaveBeenCalledWith('downloads')
      expect(result).toEqual({ ok: true, data: { path: '/fake/downloads' } })
    })
  })

  describe('system:getAppVersion', () => {
    it('resolves the running app version', async () => {
      const result = await invoke('system:getAppVersion')
      expect(result).toEqual({ ok: true, data: { version: '1.2.3' } })
    })
  })

  describe('system:clipboardReadText', () => {
    it('reads the OS clipboard synchronously', async () => {
      const result = await invoke('system:clipboardReadText')
      expect(result).toEqual({ ok: true, data: { text: 'clipboard text' } })
    })
  })

  describe('system:startDrag', () => {
    it('starts a native drag session with the given file path', async () => {
      const startDrag = vi.fn()
      const cb = registered.get('system:startDrag')
      if (!cb) throw new Error('channel not registered')
      const result = (await cb({ sender: { startDrag } }, 'C:\\some\\file.txt')) as IpcResult<unknown>
      expect(startDrag).toHaveBeenCalledWith({
        file: 'C:\\some\\file.txt',
        icon: { isNativeImage: true }
      })
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('rejects an empty file path with a validation-style error', async () => {
      const startDrag = vi.fn()
      const cb = registered.get('system:startDrag')
      if (!cb) throw new Error('channel not registered')
      const result = (await cb({ sender: { startDrag } }, '')) as IpcResult<unknown>
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN' })
      expect(startDrag).not.toHaveBeenCalled()
    })

    it('rejects a non-string file path', async () => {
      const startDrag = vi.fn()
      const cb = registered.get('system:startDrag')
      if (!cb) throw new Error('channel not registered')
      const result = (await cb({ sender: { startDrag } }, 12345)) as IpcResult<unknown>
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN' })
      expect(startDrag).not.toHaveBeenCalled()
    })
  })
})

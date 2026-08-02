import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { IpcResult } from '../../shared/contract'

const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, cb: (...args: unknown[]) => Promise<unknown>) => {
      registered.set(channel, cb)
    })
  }
}))

const appSettingsStoreMock = {
  get: vi.fn(),
  setOpenTabSiteIds: vi.fn(),
  setBandwidthLimitKBps: vi.fn(),
  setDefaultProxy: vi.fn()
}

const transferQueueMock = {
  setBandwidthLimitKBps: vi.fn()
}

vi.mock('../app/AppSettingsStore', () => ({
  AppSettingsStore: { getInstance: () => appSettingsStoreMock }
}))

vi.mock('../transfer/TransferQueue', () => ({
  TransferQueue: { getInstance: () => transferQueueMock }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('settings.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerSettingsHandlers } = await import('./settings.ipc')
    registerSettingsHandlers()
  })

  it('settings:get returns the store snapshot', async () => {
    appSettingsStoreMock.get.mockReturnValueOnce({ openTabSiteIds: [], bandwidthLimitKBps: null, defaultProxy: null })
    const result = await invoke('settings:get')
    expect(result).toEqual({
      ok: true,
      data: { openTabSiteIds: [], bandwidthLimitKBps: null, defaultProxy: null }
    })
  })

  it('settings:setOpenTabs forwards the id list', async () => {
    const result = await invoke('settings:setOpenTabs', ['a', 'b'])
    expect(appSettingsStoreMock.setOpenTabSiteIds).toHaveBeenCalledWith(['a', 'b'])
    expect(result).toEqual({ ok: true, data: undefined })
  })

  describe('settings:setBandwidthLimit', () => {
    it('accepts a positive number and applies it to both the store and the live queue', async () => {
      const result = await invoke('settings:setBandwidthLimit', 512)
      expect(appSettingsStoreMock.setBandwidthLimitKBps).toHaveBeenCalledWith(512)
      expect(transferQueueMock.setBandwidthLimitKBps).toHaveBeenCalledWith(512)
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('accepts null to mean unlimited', async () => {
      const result = await invoke('settings:setBandwidthLimit', null)
      expect(appSettingsStoreMock.setBandwidthLimitKBps).toHaveBeenCalledWith(null)
      expect(transferQueueMock.setBandwidthLimitKBps).toHaveBeenCalledWith(null)
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('rejects zero', async () => {
      const result = await invoke('settings:setBandwidthLimit', 0)
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(appSettingsStoreMock.setBandwidthLimitKBps).not.toHaveBeenCalled()
    })

    it('rejects a negative number', async () => {
      const result = await invoke('settings:setBandwidthLimit', -10)
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
    })

    it('rejects non-finite values', async () => {
      const result = await invoke('settings:setBandwidthLimit', Infinity)
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
    })

    it('rejects NaN', async () => {
      const result = await invoke('settings:setBandwidthLimit', NaN)
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
    })
  })

  it('settings:setDefaultProxy forwards the proxy config', async () => {
    const proxy = { type: 'socks5' as const, host: 'proxy', port: 1080 }
    const result = await invoke('settings:setDefaultProxy', proxy)
    expect(appSettingsStoreMock.setDefaultProxy).toHaveBeenCalledWith(proxy)
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('wraps an unexpected throw from the store into an UNKNOWN error envelope', async () => {
    appSettingsStoreMock.get.mockImplementationOnce(() => {
      throw new Error('disk read failed')
    })
    const result = await invoke('settings:get')
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'disk read failed' })
  })
})

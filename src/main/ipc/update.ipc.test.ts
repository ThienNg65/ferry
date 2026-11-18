import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handlers } from './envelope'
import { INVOKE_CHANNELS, type IpcResult } from '../../shared/contract'

const registered = handlers as unknown as Map<string, (...args: unknown[]) => Promise<unknown>>

const installUpdateNowMock = vi.fn()
const checkForUpdatesMock = vi.fn()
const getUpdateStateMock = vi.fn()

vi.mock('../update/AutoUpdater', () => ({
  installUpdateNow: installUpdateNowMock,
  checkForUpdates: checkForUpdatesMock,
  getUpdateState: getUpdateStateMock
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('update.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerUpdateHandlers } = await import('./update.ipc')
    registerUpdateHandlers()
  })

  describe('update:check', () => {
    it('triggers checkForUpdates with manual=true', async () => {
      checkForUpdatesMock.mockResolvedValueOnce({ status: 'not-available', version: '0.14.11' })
      const result = await invoke('update:check')
      expect(checkForUpdatesMock).toHaveBeenCalledWith(true)
      expect(result).toEqual({ ok: true, data: { status: 'not-available', version: '0.14.11' } })
    })

    it('returns resolved error status from checkForUpdates without throwing', async () => {
      checkForUpdatesMock.mockResolvedValueOnce({ status: 'error', error: 'HTTP 403 rate limited' })
      const result = await invoke('update:check')
      expect(result).toEqual({ ok: true, data: { status: 'error', error: 'HTTP 403 rate limited' } })
    })

    it('wraps thrown errors in an error envelope', async () => {
      checkForUpdatesMock.mockRejectedValueOnce(new Error('network offline'))
      const result = await invoke('update:check')
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'network offline' })
    })
  })

  describe('update:getStatus', () => {
    it('returns getUpdateState snapshot', async () => {
      const mockState = { status: 'idle', currentVersion: '0.24.0' }
      getUpdateStateMock.mockReturnValueOnce(mockState)
      const result = await invoke('update:getStatus')
      expect(getUpdateStateMock).toHaveBeenCalledOnce()
      expect(result).toEqual({ ok: true, data: mockState })
    })
  })

  describe('update:installNow', () => {
    it('triggers installUpdateNow', async () => {
      installUpdateNowMock.mockResolvedValueOnce(undefined)
      const result = await invoke('update:installNow')
      expect(installUpdateNowMock).toHaveBeenCalledOnce()
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('wraps a rejected promise from installUpdateNow into an error envelope', async () => {
      installUpdateNowMock.mockRejectedValueOnce(new Error('spawn EACCES'))
      const result = await invoke('update:installNow')
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'spawn EACCES' })
    })
  })

  describe('registerSidecarHandlers update wiring', () => {
    it('wires update:getStatus, update:check, and update:installNow through registerSidecarHandlers', async () => {
      registered.clear()
      const { registerSidecarHandlers } = await import('./registerSidecar')
      registerSidecarHandlers()

      expect(registered.has(INVOKE_CHANNELS.updateGetStatus)).toBe(true)
      expect(registered.has(INVOKE_CHANNELS.updateCheck)).toBe(true)
      expect(registered.has(INVOKE_CHANNELS.updateInstallNow)).toBe(true)

      getUpdateStateMock.mockReturnValueOnce({ status: 'idle', currentVersion: '0.29.1' })
      expect(await invoke(INVOKE_CHANNELS.updateGetStatus)).toEqual({
        ok: true,
        data: { status: 'idle', currentVersion: '0.29.1' }
      })

      checkForUpdatesMock.mockResolvedValueOnce({ status: 'available', version: '0.30.0' })
      expect(await invoke(INVOKE_CHANNELS.updateCheck)).toEqual({
        ok: true,
        data: { status: 'available', version: '0.30.0' }
      })

      installUpdateNowMock.mockResolvedValueOnce(undefined)
      expect(await invoke(INVOKE_CHANNELS.updateInstallNow)).toEqual({ ok: true, data: undefined })
    })
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handlers } from './envelope'
import type { IpcResult } from '../../shared/contract'

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

    it('wraps thrown errors in an error envelope', async () => {
      checkForUpdatesMock.mockRejectedValueOnce(new Error('network offline'))
      const result = await invoke('update:check')
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'network offline' })
    })
  })

  describe('update:getStatus', () => {
    it('returns getUpdateState snapshot', async () => {
      const mockState = { status: 'idle', currentVersion: '0.14.11' }
      getUpdateStateMock.mockReturnValueOnce(mockState)
      const result = await invoke('update:getStatus')
      expect(getUpdateStateMock).toHaveBeenCalledOnce()
      expect(result).toEqual({ ok: true, data: mockState })
    })
  })

  describe('update:installNow', () => {
    it('triggers installUpdateNow', async () => {
      const result = await invoke('update:installNow')
      expect(installUpdateNowMock).toHaveBeenCalledOnce()
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('wraps a thrown error from installUpdateNow into an error envelope', async () => {
      installUpdateNowMock.mockImplementationOnce(() => {
        throw new Error('no update pending')
      })
      const result = await invoke('update:installNow')
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'no update pending' })
    })
  })
})

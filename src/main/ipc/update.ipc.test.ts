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

const installUpdateNowMock = vi.fn()

vi.mock('../update/AutoUpdater', () => ({
  installUpdateNow: installUpdateNowMock
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

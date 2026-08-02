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

const operationRegistryMock = {
  cancel: vi.fn()
}

vi.mock('../operations/OperationRegistry', () => ({
  OperationRegistry: {
    getInstance: () => operationRegistryMock
  }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('operations.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerOperationsHandlers } = await import('./operations.ipc')
    registerOperationsHandlers()
  })

  describe('operation:cancel', () => {
    it('forwards the operationId (stringified) to OperationRegistry.cancel', async () => {
      const result = await invoke('operation:cancel', 'op-1')
      expect(operationRegistryMock.cancel).toHaveBeenCalledWith('op-1')
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('coerces a non-string operationId to a string before forwarding', async () => {
      await invoke('operation:cancel', 123)
      expect(operationRegistryMock.cancel).toHaveBeenCalledWith('123')
    })

    it('wraps a thrown error from cancel into an error envelope', async () => {
      operationRegistryMock.cancel.mockImplementationOnce(() => {
        throw new Error('cancel failed')
      })
      const result = await invoke('operation:cancel', 'op-1')
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'cancel failed' })
    })
  })
})

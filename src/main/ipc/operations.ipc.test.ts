import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handlers } from './envelope'
import type { IpcResult } from '../../shared/contract'

const registered = handlers as unknown as Map<string, (...args: unknown[]) => Promise<unknown>>

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
    it('forwards a valid operationId to OperationRegistry.cancel', async () => {
      const result = await invoke('operation:cancel', 'op-1')
      expect(operationRegistryMock.cancel).toHaveBeenCalledWith('op-1')
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('rejects non-string or empty operationId with VALIDATION code', async () => {
      const nonString = await invoke('operation:cancel', 123)
      expect(nonString).toMatchObject({ ok: false, code: 'VALIDATION' })

      const empty = await invoke('operation:cancel', '   ')
      expect(empty).toMatchObject({ ok: false, code: 'VALIDATION' })

      expect(operationRegistryMock.cancel).not.toHaveBeenCalled()
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

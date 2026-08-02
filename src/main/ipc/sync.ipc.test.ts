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

const syncServiceMock = {
  previewSync: vi.fn(),
  runSync: vi.fn()
}

vi.mock('../sync/SyncService', () => syncServiceMock)

const operationRegistryMock = {
  run: vi.fn((_meta: unknown, fn: (ctx: unknown) => unknown) => fn({ signal: new AbortController().signal }))
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

describe('sync.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    operationRegistryMock.run.mockImplementation((_meta: unknown, fn: (ctx: unknown) => unknown) =>
      fn({ signal: new AbortController().signal })
    )
    const { registerSyncHandlers } = await import('./sync.ipc')
    registerSyncHandlers()
  })

  describe('sync:preview', () => {
    it('forwards the options to previewSync and returns its plan', async () => {
      const plan = { toTransfer: [], toDelete: [], totalBytes: 0 }
      syncServiceMock.previewSync.mockResolvedValueOnce(plan)
      const options = {
        sessionId: 's1',
        localPath: 'C:\\local',
        remotePath: '/remote',
        direction: 'push',
        deleteExtras: false
      }
      const result = await invoke('sync:preview', options)
      expect(syncServiceMock.previewSync).toHaveBeenCalledWith(options)
      expect(result).toEqual({ ok: true, data: plan })
    })

    it('wraps a rejected previewSync into an error envelope', async () => {
      syncServiceMock.previewSync.mockRejectedValueOnce(new Error('listing failed'))
      const result = await invoke('sync:preview', {
        sessionId: 's1',
        localPath: 'a',
        remotePath: 'b',
        direction: 'pull',
        deleteExtras: false
      })
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'listing failed' })
    })
  })

  describe('sync:run', () => {
    it('runs runSync through the OperationRegistry with a direction-aware label', async () => {
      const runResult = { queuedTransferIds: ['t1'], deletedCount: 0 }
      syncServiceMock.runSync.mockResolvedValueOnce(runResult)
      const options = {
        sessionId: 's1',
        localPath: 'C:\\local',
        remotePath: '/remote',
        direction: 'push',
        deleteExtras: true
      }
      const result = await invoke('sync:run', options)
      expect(operationRegistryMock.run).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'sync', sessionId: 's1', cancellable: true, label: expect.stringContaining('local → remote') }),
        expect.any(Function)
      )
      expect(syncServiceMock.runSync).toHaveBeenCalledWith(options, expect.anything())
      expect(result).toEqual({ ok: true, data: runResult })
    })

    it('labels a pull direction distinctly from push', async () => {
      syncServiceMock.runSync.mockResolvedValueOnce({ queuedTransferIds: [], deletedCount: 0 })
      await invoke('sync:run', {
        sessionId: 's1',
        localPath: 'a',
        remotePath: 'b',
        direction: 'pull',
        deleteExtras: false
      })
      expect(operationRegistryMock.run).toHaveBeenCalledWith(
        expect.objectContaining({ label: expect.stringContaining('remote → local') }),
        expect.any(Function)
      )
    })

    it('wraps a rejected runSync into an error envelope', async () => {
      syncServiceMock.runSync.mockRejectedValueOnce(new Error('transfer failed'))
      const result = await invoke('sync:run', {
        sessionId: 's1',
        localPath: 'a',
        remotePath: 'b',
        direction: 'push',
        deleteExtras: false
      })
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'transfer failed' })
    })
  })
})

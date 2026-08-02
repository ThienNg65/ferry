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

const transferQueueMock = {
  enqueue: vi.fn(),
  enqueueTree: vi.fn(),
  cancel: vi.fn()
}

vi.mock('../transfer/TransferQueue', () => ({
  TransferQueue: {
    getInstance: () => transferQueueMock
  }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('transfer.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerTransferHandlers } = await import('./transfer.ipc')
    registerTransferHandlers()
  })

  describe('transfer:enqueue', () => {
    it('uses TransferQueue.enqueue for a single file (isDir absent/false)', async () => {
      transferQueueMock.enqueue.mockReturnValueOnce('t-1')
      const result = await invoke('transfer:enqueue', {
        sessionId: 's1',
        kind: 'upload',
        localPath: 'C:\\file.txt',
        remotePath: '/remote/file.txt'
      })
      expect(transferQueueMock.enqueue).toHaveBeenCalledWith('s1', 'upload', 'C:\\file.txt', '/remote/file.txt')
      expect(transferQueueMock.enqueueTree).not.toHaveBeenCalled()
      expect(result).toEqual({ ok: true, data: { transferId: 't-1' } })
    })

    it('uses TransferQueue.enqueueTree when isDir is true', async () => {
      transferQueueMock.enqueueTree.mockReturnValueOnce('t-2')
      const result = await invoke('transfer:enqueue', {
        sessionId: 's1',
        kind: 'download',
        localPath: 'C:\\dir',
        remotePath: '/remote/dir',
        isDir: true
      })
      expect(transferQueueMock.enqueueTree).toHaveBeenCalledWith('s1', 'download', 'C:\\dir', '/remote/dir')
      expect(transferQueueMock.enqueue).not.toHaveBeenCalled()
      expect(result).toEqual({ ok: true, data: { transferId: 't-2' } })
    })

    it('wraps a thrown error from the queue into an error envelope', async () => {
      transferQueueMock.enqueue.mockImplementationOnce(() => {
        throw new Error('queue full')
      })
      const result = await invoke('transfer:enqueue', {
        sessionId: 's1',
        kind: 'upload',
        localPath: 'a',
        remotePath: 'b'
      })
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'queue full' })
    })
  })

  describe('transfer:cancel', () => {
    it('forwards the transferId to TransferQueue.cancel', async () => {
      const result = await invoke('transfer:cancel', 't-1')
      expect(transferQueueMock.cancel).toHaveBeenCalledWith('t-1')
      expect(result).toEqual({ ok: true, data: undefined })
    })
  })
})

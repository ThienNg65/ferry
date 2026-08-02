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

const unzipServiceMock = {
  extractRemote: vi.fn()
}

vi.mock('../unzip/UnzipService', () => unzipServiceMock)

const operationRegistryMock = {
  run: vi.fn((_meta: unknown, fn: (ctx: unknown) => unknown) =>
    fn({ signal: new AbortController().signal, reportProgress: vi.fn() })
  )
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

describe('unzip.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    operationRegistryMock.run.mockImplementation((_meta: unknown, fn: (ctx: unknown) => unknown) =>
      fn({ signal: new AbortController().signal, reportProgress: vi.fn() })
    )
    const { registerUnzipHandlers } = await import('./unzip.ipc')
    registerUnzipHandlers()
  })

  describe('unzip:run', () => {
    it('runs UnzipService.extractRemote through the OperationRegistry, keyed to the session', async () => {
      unzipServiceMock.extractRemote.mockResolvedValueOnce({ stdout: 'ok', stderr: '', exitCode: 0 })
      const result = await invoke('unzip:run', {
        sessionId: 's1',
        archivePath: '/remote/archive.zip',
        targetDir: '/remote/out'
      })
      expect(operationRegistryMock.run).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'extract-remote', sessionId: 's1', cancellable: true }),
        expect.any(Function)
      )
      expect(unzipServiceMock.extractRemote).toHaveBeenCalledWith(
        's1',
        '/remote/archive.zip',
        '/remote/out',
        expect.anything()
      )
      expect(result).toEqual({ ok: true, data: { stdout: 'ok', stderr: '', exitCode: 0 } })
    })

    it('wraps a rejected extractRemote into an error envelope', async () => {
      unzipServiceMock.extractRemote.mockRejectedValueOnce(new Error('bad archive'))
      const result = await invoke('unzip:run', {
        sessionId: 's1',
        archivePath: '/a.zip',
        targetDir: '/out'
      })
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'bad archive' })
    })
  })
})

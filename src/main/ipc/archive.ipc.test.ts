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

const compressServiceMock = {
  compressLocal: vi.fn(),
  compressRemote: vi.fn()
}

vi.mock('../archive/CompressService', () => compressServiceMock)

const operationRegistryMock = {
  run: vi.fn((_meta: unknown, fn: (ctx: { signal: AbortSignal; reportProgress: () => void }) => unknown) =>
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

describe('archive.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    operationRegistryMock.run.mockImplementation(
      (_meta: unknown, fn: (ctx: { signal: AbortSignal; reportProgress: () => void }) => unknown) =>
        fn({ signal: new AbortController().signal, reportProgress: vi.fn() })
    )
    const { registerArchiveHandlers } = await import('./archive.ipc')
    registerArchiveHandlers()
  })

  describe('archive:compressLocal', () => {
    it('runs CompressService.compressLocal through the OperationRegistry with a source-basename label', async () => {
      compressServiceMock.compressLocal.mockResolvedValueOnce(undefined)
      const result = await invoke('archive:compressLocal', {
        sourcePath: 'C:\\folder\\report',
        destPath: 'C:\\folder\\report.zip'
      })
      expect(operationRegistryMock.run).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'compress-local', label: expect.stringContaining('report'), cancellable: true }),
        expect.any(Function)
      )
      expect(compressServiceMock.compressLocal).toHaveBeenCalledWith(
        'C:\\folder\\report',
        'C:\\folder\\report.zip',
        expect.objectContaining({ signal: expect.anything(), onProgress: expect.any(Function) })
      )
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('wraps a rejected compressLocal into an error envelope', async () => {
      compressServiceMock.compressLocal.mockRejectedValueOnce(new Error('disk full'))
      const result = await invoke('archive:compressLocal', {
        sourcePath: 'a',
        destPath: 'b'
      })
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'disk full' })
    })
  })

  describe('archive:compressRemote', () => {
    it('runs CompressService.compressRemote through the OperationRegistry, keyed to the session', async () => {
      compressServiceMock.compressRemote.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      const result = await invoke('archive:compressRemote', {
        sessionId: 's1',
        sourcePath: '/remote/dir',
        destPath: '/remote/dir.zip'
      })
      expect(operationRegistryMock.run).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'compress-remote', sessionId: 's1', cancellable: true }),
        expect.any(Function)
      )
      expect(compressServiceMock.compressRemote).toHaveBeenCalledWith(
        's1',
        '/remote/dir',
        '/remote/dir.zip',
        expect.anything()
      )
      expect(result).toEqual({ ok: true, data: { stdout: '', stderr: '', exitCode: 0 } })
    })

    it('wraps a rejected compressRemote into an error envelope', async () => {
      compressServiceMock.compressRemote.mockRejectedValueOnce(new Error('ssh error'))
      const result = await invoke('archive:compressRemote', {
        sessionId: 's1',
        sourcePath: '/a',
        destPath: '/b'
      })
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'ssh error' })
    })
  })
})

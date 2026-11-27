import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handlers } from './envelope'
import type { IpcResult } from '../../shared/contract'

const registered = handlers as unknown as Map<string, (...args: unknown[]) => Promise<unknown>>

const syncServiceMock = {
  compareTrees: vi.fn(),
  previewSync: vi.fn(),
  runSync: vi.fn(),
  summarizeSync: vi.fn()
}

vi.mock('../sync/SyncService', () => syncServiceMock)

const fileDiffServiceMock = {
  diffLocalAndRemote: vi.fn()
}

vi.mock('../diff/FileDiffService', () => fileDiffServiceMock)

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

    it('rejects malformed options with VALIDATION', async () => {
      expect(await invoke('sync:preview', null)).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(
        await invoke('sync:preview', {
          sessionId: 's1',
          localPath: 'a',
          remotePath: 'b',
          direction: 'sideways',
          deleteExtras: false
        })
      ).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(
        await invoke('sync:preview', {
          sessionId: 's1',
          localPath: 'a',
          remotePath: 'b',
          direction: 'push',
          deleteExtras: 'no'
        })
      ).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(syncServiceMock.previewSync).not.toHaveBeenCalled()
    })
  })

  describe('sync:compare', () => {
    it('forwards valid compare requests to compareTrees', async () => {
      syncServiceMock.compareTrees.mockResolvedValueOnce([])
      const req = { sessionId: 's1', localPath: 'C:\\local', remotePath: '/remote' }
      const result = await invoke('sync:compare', req)
      expect(syncServiceMock.compareTrees).toHaveBeenCalledWith(req)
      expect(result).toEqual({ ok: true, data: [] })
    })

    it('rejects malformed compare requests with VALIDATION', async () => {
      expect(await invoke('sync:compare', null)).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(await invoke('sync:compare', { sessionId: '', localPath: 'a', remotePath: '/b' })).toMatchObject({
        ok: false,
        code: 'VALIDATION'
      })
      expect(syncServiceMock.compareTrees).not.toHaveBeenCalled()
    })
  })

  describe('sync:diffFiles', () => {
    it('forwards valid diff requests including empty localContent', async () => {
      const diffResult = {
        localPath: 'C:\\local\\a.txt',
        remotePath: '/srv/a.txt',
        localSize: 0,
        remoteSize: 0,
        maxBytes: 1_048_576,
        identical: true,
        additions: 0,
        deletions: 0,
        hunks: []
      }
      fileDiffServiceMock.diffLocalAndRemote.mockResolvedValueOnce(diffResult)
      const req = { sessionId: 's1', localPath: 'C:\\local\\a.txt', remotePath: '/srv/a.txt', localContent: '' }
      const result = await invoke('sync:diffFiles', req)
      expect(fileDiffServiceMock.diffLocalAndRemote).toHaveBeenCalledWith(req)
      expect(result).toEqual({ ok: true, data: diffResult })
    })

    it('rejects malformed diff requests with VALIDATION', async () => {
      expect(await invoke('sync:diffFiles', null)).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(
        await invoke('sync:diffFiles', { sessionId: 's1', localPath: 'a', remotePath: '' })
      ).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(
        await invoke('sync:diffFiles', { sessionId: 's1', localPath: 'a', remotePath: '/b', localContent: 123 })
      ).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(fileDiffServiceMock.diffLocalAndRemote).not.toHaveBeenCalled()
    })
  })

  describe('sync:run', () => {
    const approvedPlan = { toTransfer: [], toDelete: [], totalBytes: 0 }
    const requestId = 'sync-request'

    it('rejects requests without approval before registering work', async () => {
      const result = await invoke('sync:run', { sessionId: 's1', deleteExtras: true })
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(operationRegistryMock.run).not.toHaveBeenCalled()
    })

    it('rejects malformed options or plan arrays with VALIDATION before registering work', async () => {
      expect(
        await invoke('sync:run', {
          requestId,
          approvedPlan,
          options: { sessionId: 's1', localPath: 'a', remotePath: 'b', direction: 'invalid', deleteExtras: false }
        })
      ).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(
        await invoke('sync:run', {
          requestId,
          approvedPlan: { toTransfer: 'not-array', toDelete: [] },
          options: { sessionId: 's1', localPath: 'a', remotePath: 'b', direction: 'push', deleteExtras: false }
        })
      ).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(operationRegistryMock.run).not.toHaveBeenCalled()
    })

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
      const result = await invoke('sync:run', { options, approvedPlan, requestId })
      expect(operationRegistryMock.run).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'sync', sessionId: 's1', cancellable: true, requestId, label: expect.stringContaining('local → remote') }),
        expect.any(Function),
        syncServiceMock.summarizeSync
      )
      expect(syncServiceMock.runSync).toHaveBeenCalledWith(options, approvedPlan, expect.anything())
      expect(result).toEqual({ ok: true, data: runResult })
    })

    it('labels a pull direction distinctly from push', async () => {
      syncServiceMock.runSync.mockResolvedValueOnce({ queuedTransferIds: [], deletedCount: 0 })
      await invoke('sync:run', {
        requestId, approvedPlan,
        options: { sessionId: 's1', localPath: 'a', remotePath: 'b', direction: 'pull', deleteExtras: false }
      })
      expect(operationRegistryMock.run).toHaveBeenCalledWith(
        expect.objectContaining({ label: expect.stringContaining('remote → local') }),
        expect.any(Function),
        syncServiceMock.summarizeSync
      )
    })

    it('wraps a rejected runSync into an error envelope', async () => {
      syncServiceMock.runSync.mockRejectedValueOnce(new Error('transfer failed'))
      const result = await invoke('sync:run', {
        requestId, approvedPlan,
        options: { sessionId: 's1', localPath: 'a', remotePath: 'b', direction: 'push', deleteExtras: false }
      })
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'transfer failed' })
    })
  })
})

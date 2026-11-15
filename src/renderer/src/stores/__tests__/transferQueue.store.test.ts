import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { INVOKE_CHANNELS, type TransferEvent } from '@shared/contract'
import { useTransferQueueStore } from '../transferQueue.store'
import { useRemoteFsStore } from '../remoteFs.store'
import { useLocalFsStore } from '../localFs.store'
import * as api from '../../api'

let eventHandler: ((evt: TransferEvent) => void) | null = null

vi.mock('../../api', () => ({
  invoke: vi.fn(),
  onEvent: vi.fn((_channel: string, cb: (evt: TransferEvent) => void) => {
    eventHandler = cb
    return () => {
      eventHandler = null
    }
  })
}))

vi.mock('../../composables/useNotify', () => ({
  useNotify: () => ({
    success: vi.fn(),
    error: vi.fn(),
    prompt: vi.fn()
  })
}))

vi.mock('../sessions.store', () => ({
  useSessionsStore: () => ({ activeSessionId: 'sess-1' })
}))

describe('transferQueue.store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    eventHandler = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes remote destination after fast synchronous upload without clearing selection', async () => {
    const remoteFs = useRemoteFsStore()
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/config',
      entries: [
        { name: 'keep.txt', path: '/config/keep.txt', isDir: false, size: 10, permissions: '0644' }
      ]
    })
    await remoteFs.loadForSession('sess-1', '/config')
    remoteFs.selectOnly('/config/keep.txt')

    const queue = useTransferQueueStore()
    queue.ensureSubscription()

    vi.mocked(api.invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.transferEnqueue) {
        // Simulate TransferQueue.push() synchronously emitting queued -> started -> done before RPC returns
        eventHandler?.({ transferId: 't-fast', kind: 'upload', state: 'queued', sessionId: 'sess-1', localPath: 'C:\\tmp\\sshd.pid', remotePath: '/config/sshd.pid', isDir: false })
        eventHandler?.({ transferId: 't-fast', kind: 'upload', state: 'started', sessionId: 'sess-1', localPath: 'C:\\tmp\\sshd.pid', remotePath: '/config/sshd.pid', isDir: false })
        eventHandler?.({ transferId: 't-fast', kind: 'upload', state: 'done', sessionId: 'sess-1', localPath: 'C:\\tmp\\sshd.pid', remotePath: '/config/sshd.pid', isDir: false, bytesTransferred: 4, totalBytes: 4, filesDone: 1, filesTotal: 1 })
        return { transferId: 't-fast' }
      }
      if (channel === INVOKE_CHANNELS.fsRemoteList) {
        return {
          path: '/config',
          entries: [
            { name: 'keep.txt', path: '/config/keep.txt', isDir: false, size: 10, permissions: '0644' },
            { name: 'sshd.pid', path: '/config/sshd.pid', isDir: false, size: 4, permissions: '0644' }
          ]
        }
      }
      return undefined
    })

    await queue.enqueue('sess-1', 'upload', 'C:\\tmp\\sshd.pid', '/config/sshd.pid')

    const item = queue.items.get('t-fast')
    expect(item?.state).toBe('done')
    expect(item?.sessionId).toBe('sess-1')
    expect(item?.remotePath).toBe('/config/sshd.pid')

    // Debounced 100ms refresh fires once
    await vi.advanceTimersByTimeAsync(120)

    expect(api.invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsRemoteList, 'sess-1', '/config', true)
    expect(remoteFs.entries.map((e) => e.name)).toContain('sshd.pid')
    expect(remoteFs.selected.has('/config/keep.txt')).toBe(true)
  })

  it('coalesces batch downloads and refreshes local directory including Windows drive roots without clearing selection', async () => {
    const localFs = useLocalFsStore()
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: 'C:\\',
      entries: [
        { name: 'existing.txt', path: 'C:\\existing.txt', isDir: false, size: 5 }
      ]
    })
    await localFs.load('C:\\')
    localFs.selectOnly('C:\\existing.txt')

    const queue = useTransferQueueStore()
    queue.ensureSubscription()

    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: 'C:\\',
      entries: [
        { name: 'existing.txt', path: 'C:\\existing.txt', isDir: false, size: 5 },
        { name: 'a.txt', path: 'C:\\a.txt', isDir: false, size: 10 },
        { name: 'b.txt', path: 'C:\\b.txt', isDir: false, size: 20 }
      ]
    })

    eventHandler?.({ transferId: 'd-1', kind: 'download', state: 'done', sessionId: 'sess-1', localPath: 'C:\\a.txt', remotePath: '/config/a.txt', isDir: false })
    eventHandler?.({ transferId: 'd-2', kind: 'download', state: 'done', sessionId: 'sess-1', localPath: 'C:\\b.txt', remotePath: '/config/b.txt', isDir: false })

    await vi.advanceTimersByTimeAsync(120)

    const listCalls = vi.mocked(api.invoke).mock.calls.filter((c) => c[0] === INVOKE_CHANNELS.fsLocalList)
    expect(listCalls).toHaveLength(2) // initial load + 1 coalesced refresh
    expect(localFs.entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt', 'existing.txt'])
    expect(localFs.selected.has('C:\\existing.txt')).toBe(true)
  })
})

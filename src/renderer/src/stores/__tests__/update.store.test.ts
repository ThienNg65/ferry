import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type UpdateState } from '@shared/contract'
import * as api from '../../api'
import { useUpdateStore } from '../update.store'

let statusListener: ((state: UpdateState) => void) | null = null
const unsubscribeMock = vi.fn(() => {
  statusListener = null
})

const confirmMock = vi.fn(async (_opts: { items?: string[] }) => true)
const notifyMock = {
  success: vi.fn(),
  error: vi.fn(),
  prompt: vi.fn()
}

const mockTransfers = { list: [] as Array<{ state: string }> }
const mockOperations = { runningCount: 0 }
const mockEditSessions = { edits: [] as Array<{ dirty: boolean }> }
const mockSessions = { tabs: [] as Array<{ status: string; connecting?: boolean }> }

vi.mock('../../api', () => ({
  invoke: vi.fn(),
  onEvent: vi.fn((channel: string, cb: (state: UpdateState) => void) => {
    if (channel === EVENT_CHANNELS.updateStatus) {
      statusListener = cb
    }
    return unsubscribeMock
  }),
  IpcError: class IpcError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
}))

vi.mock('../../composables/useConfirm', () => ({
  useConfirm: () => confirmMock
}))

vi.mock('../../composables/useNotify', () => ({
  useNotify: () => notifyMock
}))

vi.mock('../transferQueue.store', () => ({
  useTransferQueueStore: () => mockTransfers
}))

vi.mock('../operations.store', () => ({
  useOperationsStore: () => mockOperations
}))

vi.mock('../editSessions.store', () => ({
  useEditSessionsStore: () => mockEditSessions
}))

vi.mock('../sessions.store', () => ({
  useSessionsStore: () => mockSessions
}))

describe('update.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    statusListener = null
    mockTransfers.list = []
    mockOperations.runningCount = 0
    mockEditSessions.edits = []
    mockSessions.tabs = []
    confirmMock.mockResolvedValue(true)
  })

  it('recovers from failed initial update:getStatus without leaking subscriptions and disposes cleanly', async () => {
    const store = useUpdateStore()

    vi.mocked(api.invoke).mockRejectedValueOnce(new Error('sidecar not ready'))
    await store.init()
    expect(store.initialized).toBe(false)
    expect(api.onEvent).toHaveBeenCalledOnce()

    vi.mocked(api.invoke).mockResolvedValueOnce({
      status: 'idle',
      currentVersion: '0.29.1'
    } satisfies UpdateState)
    await store.init()
    expect(store.initialized).toBe(true)
    expect(store.currentVersion).toBe('0.29.1')
    expect(api.onEvent).toHaveBeenCalledOnce()

    // Concurrent/subsequent init is a no-op
    await store.init()
    expect(api.invoke).toHaveBeenCalledTimes(2)

    store.dispose()
    expect(unsubscribeMock).toHaveBeenCalledOnce()
    expect(store.initialized).toBe(false)
  })

  it('guards checkNow against re-entrancy, excludes downloaded/available from canCheck, and does not regress streamed progress', async () => {
    const store = useUpdateStore()
    store.status = 'error'
    store.error = 'old error'
    store.availableVersion = '0.28.0'
    store.progress = { percent: 12, bytesPerSecond: 100, transferred: 12, total: 100 }

    let resolveCheck!: (res: { status: 'available'; version: string }) => void
    vi.mocked(api.invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve
        })
    )

    const p1 = store.checkNow()
    expect(store.status).toBe('checking')
    expect(store.error).toBeNull()
    expect(store.availableVersion).toBeNull()
    expect(store.progress).toBeNull()
    expect(store.canCheck).toBe(false)

    // Duplicate call returns immediately without issuing another IPC invoke
    const dup = await store.checkNow()
    expect(dup).toEqual({ status: 'checking', version: undefined, error: undefined })
    expect(api.invoke).toHaveBeenCalledOnce()

    // Sidecar broadcasts downloading event before check RPC resolves
    store.applyState({
      status: 'downloading',
      currentVersion: '0.29.1',
      availableVersion: '0.30.0',
      progress: { percent: 45, bytesPerSecond: 1000, transferred: 450, total: 1000 }
    })

    resolveCheck({ status: 'available', version: '0.30.0' })
    await p1
    expect(store.status).toBe('downloading')
    expect(store.canCheck).toBe(false)

    store.applyState({
      status: 'downloaded',
      currentVersion: '0.29.1',
      availableVersion: '0.30.0'
    })
    expect(store.isDownloaded).toBe(true)
    expect(store.canCheck).toBe(false)
  })

  it('prompts before installNow when active work exists and aborts if user cancels', async () => {
    const store = useUpdateStore()
    store.status = 'downloaded'
    store.availableVersion = '0.30.0'
    mockTransfers.list = [{ state: 'progress' }]
    mockOperations.runningCount = 1
    mockEditSessions.edits = [{ dirty: true }]
    mockSessions.tabs = [{ status: 'connected' }]
    confirmMock.mockResolvedValueOnce(false)

    await store.installNow()
    expect(confirmMock).toHaveBeenCalledOnce()
    expect(confirmMock.mock.calls[0]?.[0]?.items).toHaveLength(4)
    expect(api.invoke).not.toHaveBeenCalled()
    expect(store.installing).toBe(false)
  })

  it('invokes update:installNow then window:close, tolerates expected exit disconnect, and surfaces real IpcError', async () => {
    const store = useUpdateStore()
    store.status = 'downloaded'
    store.availableVersion = '0.30.0'

    // 1. Real IpcError (e.g. EACCES / SHA-512 failure) resets installing and notifies error without closing window
    vi.mocked(api.invoke).mockRejectedValueOnce(new api.IpcError('UNKNOWN', 'spawn EACCES'))
    await store.installNow()
    expect(store.installing).toBe(false)
    expect(notifyMock.error).toHaveBeenCalledWith('Could not install update', 'spawn EACCES')
    expect(api.invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.windowClose)

    // 2. Expected sidecar disconnect during exit still proceeds to window:close
    vi.mocked(api.invoke)
      .mockRejectedValueOnce(new Error('Sidecar disconnected before replying'))
      .mockResolvedValueOnce(undefined)
    await store.installNow()
    expect(api.invoke).toHaveBeenNthCalledWith(2, INVOKE_CHANNELS.updateInstallNow)
    expect(api.invoke).toHaveBeenNthCalledWith(3, INVOKE_CHANNELS.windowClose)
  })
})

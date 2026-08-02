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

const bookmarkStoreMock = {
  list: vi.fn(),
  create: vi.fn(),
  delete: vi.fn()
}

vi.mock('../bookmarks/BookmarkStore', () => ({
  BookmarkStore: { getInstance: () => bookmarkStoreMock }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('bookmarks.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerBookmarksHandlers } = await import('./bookmarks.ipc')
    registerBookmarksHandlers()
  })

  it('bookmarks:list returns the stored bookmarks', async () => {
    bookmarkStoreMock.list.mockReturnValueOnce([{ id: '1', path: '/tmp', sessionId: 's1' }])
    const result = await invoke('bookmarks:list')
    expect(result).toEqual({ ok: true, data: [{ id: '1', path: '/tmp', sessionId: 's1' }] })
  })

  it('bookmarks:create forwards the input and returns the created bookmark', async () => {
    bookmarkStoreMock.create.mockReturnValueOnce({ id: '2', path: '/root', label: 'Root' })
    const input = { path: '/root', label: 'Root' }
    const result = await invoke('bookmarks:create', input)
    expect(bookmarkStoreMock.create).toHaveBeenCalledWith(input)
    expect(result).toEqual({ ok: true, data: { id: '2', path: '/root', label: 'Root' } })
  })

  it('bookmarks:delete forwards the id', async () => {
    const result = await invoke('bookmarks:delete', '2')
    expect(bookmarkStoreMock.delete).toHaveBeenCalledWith('2')
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('wraps an underlying BookmarkStore throw into an error envelope', async () => {
    bookmarkStoreMock.create.mockImplementationOnce(() => {
      throw new Error('duplicate bookmark')
    })
    const result = await invoke('bookmarks:create', { path: '/root', label: 'Root' })
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'duplicate bookmark' })
  })
})

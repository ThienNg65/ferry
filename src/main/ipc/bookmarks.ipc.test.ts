import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handlers } from './envelope'
import type { IpcResult } from '../../shared/contract'

const registered = handlers as unknown as Map<string, (...args: unknown[]) => Promise<unknown>>

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

  it('bookmarks:create forwards contract-standard scope input and returns the created bookmark', async () => {
    const created = { id: '2', scope: 'remote', siteId: 'ferrytest@127.0.0.1', path: '/config', label: 'Config' }
    bookmarkStoreMock.create.mockReturnValueOnce(created)
    const input = { scope: 'remote', siteId: 'ferrytest@127.0.0.1', path: '/config', label: 'Config' }
    const result = await invoke('bookmarks:create', input)
    expect(bookmarkStoreMock.create).toHaveBeenCalledWith(input)
    expect(result).toEqual({ ok: true, data: created })
  })

  it('bookmarks:create normalizes legacy side payloads to scope and rejects missing/invalid scope', async () => {
    bookmarkStoreMock.create.mockReturnValueOnce({ id: '3', scope: 'remote', path: '/root', label: 'Root' })
    const legacy = await invoke('bookmarks:create', { side: 'remote', path: '/root', label: 'Root' })
    expect(bookmarkStoreMock.create).toHaveBeenCalledWith({ scope: 'remote', path: '/root', label: 'Root' })
    expect(legacy).toEqual({ ok: true, data: { id: '3', scope: 'remote', path: '/root', label: 'Root' } })

    const missing = await invoke('bookmarks:create', { path: '/root', label: 'Root' })
    expect(missing).toMatchObject({ ok: false, code: 'VALIDATION' })

    const invalid = await invoke('bookmarks:create', { scope: 'other', path: '/root', label: 'Root' })
    expect(invalid).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(bookmarkStoreMock.create).toHaveBeenCalledTimes(1)
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
    const result = await invoke('bookmarks:create', { side: 'remote', path: '/root', label: 'Root' })
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'duplicate bookmark' })
  })
})

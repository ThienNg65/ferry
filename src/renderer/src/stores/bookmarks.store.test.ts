import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBookmarksStore } from './bookmarks.store'
import { resolveConnectionFilterKey } from './fileFilters.store'
import * as api from '../api'

vi.mock('../api', () => ({
  invoke: vi.fn()
}))

describe('bookmarks.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('coalesces concurrent ensureLoaded() calls into a single IPC request', async () => {
    const store = useBookmarksStore()
    let resolveList!: (val: unknown) => void
    vi.mocked(api.invoke).mockReturnValueOnce(
      new Promise<unknown>((resolve) => {
        resolveList = resolve
      }) as Promise<any>
    )

    const p1 = store.ensureLoaded()
    const p2 = store.ensureLoaded()
    expect(api.invoke).toHaveBeenCalledTimes(1)

    resolveList([{ id: 'b1', scope: 'local', path: 'C:\\logs', label: 'logs' }])
    await Promise.all([p1, p2])

    expect(store.loaded).toBe(true)
    expect(store.bookmarks).toHaveLength(1)

    // Subsequent ensureLoaded() does not re-fetch once loaded
    await store.ensureLoaded()
    expect(api.invoke).toHaveBeenCalledTimes(1)
  })
  it('isolates Quick Connect bookmarks across ports and reconnects', () => {
    const store = useBookmarksStore()
    const endpoint = (port: number, sessionId: string) => ({
      siteId: null,
      hostLabel: 'user@example.test',
      sessionId,
      quickConnectInput: { username: 'user', host: 'EXAMPLE.test', port }
    })
    const port22 = resolveConnectionFilterKey(endpoint(22, 'first'))!
    const port2222 = resolveConnectionFilterKey(endpoint(2222, 'second'))!
    expect(port22).not.toBe(port2222)
    expect(port22).toBe(resolveConnectionFilterKey(endpoint(22, 'reconnected')))

    const createdAt = '2026-11-20T00:00:00.000Z'
    store.bookmarks = [
      { id: 'a', scope: 'remote', siteId: port22, path: '/srv/a', label: 'a', createdAt },
      { id: 'b', scope: 'remote', siteId: port2222, path: '/srv/b', label: 'b', createdAt },
      { id: 'legacy', scope: 'remote', siteId: 'user@example.test', path: '/old', label: 'old', createdAt }
    ]
    expect(store.forSite(port22).map((b) => b.id)).toEqual(['a'])
    expect(store.forSite(port2222).map((b) => b.id)).toEqual(['b'])
    store.bookmarks = store.bookmarks.filter((b) => b.id !== 'b')
    expect(store.forSite(port2222)).toEqual([])
  })

  it('retains exact saved-site bookmark IDs', () => {
    const store = useBookmarksStore()
    const createdAt = '2026-11-20T00:00:00.000Z'
    store.bookmarks = [
      { id: 'saved', scope: 'remote', siteId: 'saved-site', path: '/srv/site', label: 'site', createdAt },
      { id: 'legacy', scope: 'remote', siteId: 'user@example.test', path: '/old', label: 'old', createdAt }
    ]
    expect(store.forSite('saved-site').map((b) => b.id)).toEqual(['saved'])
  })
})

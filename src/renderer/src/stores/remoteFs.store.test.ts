import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useRemoteFsStore } from './remoteFs.store'
import * as api from '../api'

vi.mock('../api', () => ({
  invoke: vi.fn()
}))

vi.mock('./sessions.store', () => ({
  useSessionsStore: () => ({ activeSessionId: 'sess-1' })
}))

describe('remoteFs.store with SWR cache', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('serves cached directory instantly on second visit without waiting for network', async () => {
    const store = useRemoteFsStore()
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/var/log',
      entries: [{ name: 'a.txt', path: '/var/log/a.txt', isDir: false, size: 10, permissions: '0644' }]
    })

    // First load (cold)
    await store.loadForSession('sess-1', '/var/log')
    expect(store.entries).toHaveLength(1)
    expect(api.invoke).toHaveBeenCalledTimes(1)

    // Second load (warm)
    let resolveNetwork: (val: any) => void
    const networkPromise = new Promise((resolve) => {
      resolveNetwork = resolve
    })
    vi.mocked(api.invoke).mockReturnValueOnce(networkPromise as any)

    const secondLoadPromise = store.loadForSession('sess-1', '/var/log')
    // Immediately available in store state from cache before network resolves
    expect(store.entries).toHaveLength(1)
    expect(store.currentPath).toBe('/var/log')

    resolveNetwork!({
      path: '/var/log',
      entries: [
        { name: 'a.txt', path: '/var/log/a.txt', isDir: false, size: 10, permissions: '0644' },
        { name: 'b.txt', path: '/var/log/b.txt', isDir: false, size: 20, permissions: '0644' }
      ]
    })
    await secondLoadPromise
    await new Promise((r) => setTimeout(r, 10))
    // After background revalidation completes, state updates
    expect(store.entries).toHaveLength(2)
  })

  it('bypasses cache when forceRefresh is true', async () => {
    const store = useRemoteFsStore()
    vi.mocked(api.invoke).mockResolvedValue({
      path: '/var/log',
      entries: [{ name: 'a.txt', path: '/var/log/a.txt', isDir: false, size: 10, permissions: '0644' }]
    })

    await store.loadForSession('sess-1', '/var/log')
    await store.loadForSession('sess-1', '/var/log', { forceRefresh: true })
    expect(api.invoke).toHaveBeenCalledTimes(2)
  })

  it('invalidates directory cache when mkdir or remove occurs', async () => {
    const store = useRemoteFsStore()
    vi.mocked(api.invoke).mockResolvedValue({
      path: '/var/log',
      entries: [{ name: 'a.txt', path: '/var/log/a.txt', isDir: false, size: 10, permissions: '0644' }]
    })

    await store.loadForSession('sess-1', '/var/log')
    await store.mkdir('subfolder')
    expect(api.invoke).toHaveBeenCalledWith('fs:remote:mkdir', 'sess-1', '/var/log/subfolder')
    expect(api.invoke).toHaveBeenCalledTimes(3) // initial load + mkdir + forced refresh
  })

  it('prefetches a directory without changing current path', async () => {
    const store = useRemoteFsStore()
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/var/log',
      entries: [{ name: 'nginx', path: '/var/log/nginx', isDir: true, size: 0, permissions: '0755' }]
    })
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/var/log/nginx',
      entries: [{ name: 'access.log', path: '/var/log/nginx/access.log', isDir: false, size: 100, permissions: '0644' }]
    })

    await store.loadForSession('sess-1', '/var/log')
    expect(store.currentPath).toBe('/var/log')

    // Prefetch child directory
    await store.prefetchDir('/var/log/nginx')
    // Current path unchanged
    expect(store.currentPath).toBe('/var/log')

    // Navigating into prefetched folder should be instant without new network call
    await store.loadForSession('sess-1', '/var/log/nginx')
    expect(store.currentPath).toBe('/var/log/nginx')
    expect(store.entries[0].name).toBe('access.log')
  })

  it('clears selection when navigating to a cached directory', async () => {
    const store = useRemoteFsStore()
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/var/log',
      entries: [{ name: 'a.txt', path: '/var/log/a.txt', isDir: false, size: 10, permissions: '0644' }]
    })
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/var/cache',
      entries: [{ name: 'b.txt', path: '/var/cache/b.txt', isDir: false, size: 20, permissions: '0644' }]
    })

    await store.loadForSession('sess-1', '/var/log')
    store.selectOnly('/var/log/a.txt')
    expect(store.selected.has('/var/log/a.txt')).toBe(true)

    // Load second dir
    await store.loadForSession('sess-1', '/var/cache')
    // Now return to cached first dir
    await store.loadForSession('sess-1', '/var/log')
    expect(store.selected.size).toBe(0)
    expect(store.currentPath).toBe('/var/log')
  })

  it('rolls back currentPath and entries when optimistic navigation fails', async () => {
    const store = useRemoteFsStore()
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/var/log',
      entries: [{ name: 'a.txt', path: '/var/log/a.txt', isDir: false, size: 10, permissions: '0644' }]
    })

    await store.loadForSession('sess-1', '/var/log')
    expect(store.currentPath).toBe('/var/log')
    expect(store.entries).toHaveLength(1)

    // Try navigating to a restricted path that fails
    vi.mocked(api.invoke).mockRejectedValueOnce(new Error('Permission denied'))
    await store.loadForSession('sess-1', '/root')

    // Should rollback to previous path and entries
    expect(store.currentPath).toBe('/var/log')
    expect(store.entries).toHaveLength(1)
    expect(store.error).toBe('Permission denied')
  })
})

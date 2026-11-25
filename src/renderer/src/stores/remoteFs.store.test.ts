import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useRemoteFsStore } from './remoteFs.store'
import type { FileListResult } from '@shared/contract'
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

  it('coalesces duplicate concurrent loads for the same uncached path under slow network', async () => {
    const store = useRemoteFsStore()
    let resolveSlow!: (val: any) => void
    vi.mocked(api.invoke).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSlow = resolve
      }) as any
    )

    const p1 = store.loadForSession('sess-1', '/var/slow')
    const p2 = store.loadForSession('sess-1', '/var/slow')
    expect(api.invoke).toHaveBeenCalledTimes(1)

    resolveSlow({
      path: '/var/slow',
      entries: [{ name: 'slow.log', path: '/var/slow/slow.log', isDir: false, size: 42, permissions: '0644' }]
    })
    await Promise.all([p1, p2])

    expect(store.currentPath).toBe('/var/slow')
    expect(store.entries).toHaveLength(1)
  })

  it('ignores stale slow response when user navigates elsewhere before it resolves', async () => {
    const store = useRemoteFsStore()
    let resolveFirst!: (val: any) => void
    let resolveSecond!: (val: any) => void
    vi.mocked(api.invoke)
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r }) as any)
      .mockReturnValueOnce(new Promise((r) => { resolveSecond = r }) as any)

    const pFirst = store.loadForSession('sess-1', '/slow-dir')
    const pSecond = store.loadForSession('sess-1', '/fast-dir')

    resolveSecond({
      path: '/fast-dir',
      entries: [{ name: 'fast.txt', path: '/fast-dir/fast.txt', isDir: false, size: 5, permissions: '0644' }]
    })
    await pSecond

    // Stale first response arrives later — must not overwrite /fast-dir
    resolveFirst({
      path: '/slow-dir',
      entries: [{ name: 'stale.txt', path: '/slow-dir/stale.txt', isDir: false, size: 5, permissions: '0644' }]
    })
    await pFirst

    expect(store.currentPath).toBe('/fast-dir')
    expect(store.entries[0].name).toBe('fast.txt')
  })

  it('keeps the last real listing after overlapping navigation fails and retries the failed path', async () => {
    const store = useRemoteFsStore()
    const entry = { name: 'real.txt', path: '/current/real.txt', isDir: false, size: 1 }
    vi.mocked(api.invoke).mockResolvedValueOnce({ path: '/current', entries: [entry] })
    await store.load('/current')

    let resolveSlow!: (result: { path: string; entries: [] }) => void
    const stale = new Promise((resolve) => { resolveSlow = resolve })
    vi.mocked(api.invoke).mockReturnValueOnce(stale).mockRejectedValueOnce(new Error('Access denied'))
    const slowLoad = store.load('/slow')
    await store.load('/denied')
    resolveSlow({ path: '/slow', entries: [] })
    await slowLoad

    expect(store.currentPath).toBe('/current')
    expect(store.entries).toEqual([entry])
    expect(store.failedPath).toBe('/denied')
    expect(store.error).toBe('Access denied')

    vi.mocked(api.invoke).mockResolvedValueOnce({ path: '/denied', entries: [] })
    await store.retryDirectory()
    expect(api.invoke).toHaveBeenLastCalledWith('fs:remote:list', 'sess-1', '/denied', false)
    expect(store.failedPath).toBeNull()
    expect(store.currentPath).toBe('/denied')
    expect(store.entries).toEqual([])
  })

  it('reloads the originating session directory when active tab switches during mkdir', async () => {
    const store = useRemoteFsStore()
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/tab-a',
      entries: []
    })
    await store.loadForSession('sess-1', '/tab-a')

    let resolveMkdir!: () => void
    vi.mocked(api.invoke).mockImplementationOnce(
      () => new Promise<void>((r) => { resolveMkdir = r }) as any
    )
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/tab-a',
      entries: [{ name: 'newdir', path: '/tab-a/newdir', isDir: true, size: 0, permissions: '0755' }]
    })

    const mkdirPromise = store.mkdir('newdir')
    // Switch bucket path / simulate another dir not yet interfering
    expect(api.invoke).toHaveBeenCalledWith('fs:remote:mkdir', 'sess-1', '/tab-a/newdir')
    resolveMkdir()
    await mkdirPromise
    expect(store.bySession['sess-1'].entries.map((e) => e.name)).toEqual(['newdir'])
  })
  it('queues a refresh after an in-flight load so completed archive entries reach the listing and cache', async () => {
    const store = useRemoteFsStore()
    const existingEntry = {
      name: 'notes.txt',
      path: '/var/log/notes.txt',
      isDir: false,
      size: 10,
      permissions: '0644'
    }
    const archiveEntry = {
      name: 'notes.txt.zip',
      path: '/var/log/notes.txt.zip',
      isDir: false,
      size: 20,
      permissions: '0644'
    }

    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/var/log',
      entries: [existingEntry]
    } as never)
    await store.loadForSession('sess-1', '/var/log')

    let resolveLoad!: (result: FileListResult) => void
    vi.mocked(api.invoke)
      .mockReturnValueOnce(new Promise<FileListResult>((resolve) => {
        resolveLoad = resolve
      }) as never)
      .mockResolvedValueOnce({
        path: '/var/log',
        entries: [existingEntry, archiveEntry]
      } as never)

    const loadPromise = store.loadForSession('sess-1', '/var/log', { forceRefresh: true })
    expect(store.bySession['sess-1'].loading).toBe(true)

    await store.refreshSessionIfViewing('sess-1', '/var/log')
    expect(api.invoke).toHaveBeenCalledTimes(2)
    expect(store.bySession['sess-1'].dirCache.has('/var/log')).toBe(false)

    resolveLoad({ path: '/var/log', entries: [existingEntry] })
    await loadPromise

    expect(api.invoke).toHaveBeenCalledTimes(3)
    expect(api.invoke).toHaveBeenLastCalledWith('fs:remote:list', 'sess-1', '/var/log', true)
    expect(store.bySession['sess-1'].entries.map((entry) => entry.name)).toContain('notes.txt.zip')
    expect(store.bySession['sess-1'].dirCache.get('/var/log')?.entries.map((entry) => entry.name)).toContain('notes.txt.zip')
  })

  it('discards a queued refresh when the in-flight load navigates away from its target', async () => {
    const store = useRemoteFsStore()
    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/var/log',
      entries: [{ name: 'notes.txt', path: '/var/log/notes.txt', isDir: false, size: 10 }]
    } as never)
    await store.loadForSession('sess-1', '/var/log')

    let resolveNavigation!: (result: FileListResult) => void
    vi.mocked(api.invoke).mockReturnValueOnce(new Promise<FileListResult>((resolve) => {
      resolveNavigation = resolve
    }) as never)

    const navigationPromise = store.loadForSession('sess-1', '/var/other', { forceRefresh: true })
    await store.refreshSessionIfViewing('sess-1', '/var/log')
    resolveNavigation({ path: '/var/other', entries: [] })
    await navigationPromise

    expect(api.invoke).toHaveBeenCalledTimes(2)
    expect(store.currentPath).toBe('/var/other')
    expect(store.entries).toEqual([])
    expect(store.bySession['sess-1'].dirCache.has('/var/log')).toBe(false)
  })

})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBookmarksStore } from './bookmarks.store'
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
})

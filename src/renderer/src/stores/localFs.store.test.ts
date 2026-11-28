import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { INVOKE_CHANNELS, type FileEntry, type FileListResult } from '@shared/contract'
import { useLocalFsStore } from './localFs.store'
import * as api from '../api'

vi.mock('../api', () => ({
  invoke: vi.fn()
}))

describe('localFs.store refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('queues a refresh after an in-flight load so completed files appear in the listing', async () => {
    const store = useLocalFsStore()
    const existingEntry: FileEntry = {
      name: 'notes.txt',
      path: '/local/notes.txt',
      isDir: false,
      isSymlink: false,
      size: 10,
      modifiedAt: null
    }
    const archiveEntry: FileEntry = {
      name: 'notes.txt.zip',
      path: '/local/notes.txt.zip',
      isDir: false,
      isSymlink: false,
      size: 20,
      modifiedAt: null
    }

    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/local',
      entries: [existingEntry]
    } as FileListResult)
    await store.load('/local')

    let resolveLoad!: (result: FileListResult) => void
    vi.mocked(api.invoke)
      .mockReturnValueOnce(new Promise<FileListResult>((resolve) => {
        resolveLoad = resolve
      }))
      .mockResolvedValueOnce({
        path: '/local',
        entries: [existingEntry, archiveEntry]
      } as FileListResult)

    const loadPromise = store.load('/local')
    expect(store.loading).toBe(true)

    await store.refreshIfViewing('/local')
    expect(api.invoke).toHaveBeenCalledTimes(2)

    resolveLoad({ path: '/local', entries: [existingEntry] })
    await loadPromise

    expect(api.invoke).toHaveBeenCalledTimes(3)
    expect(api.invoke).toHaveBeenNthCalledWith(3, INVOKE_CHANNELS.fsLocalList, '/local')
    expect(store.entries.map((entry) => entry.name)).toEqual(['notes.txt', 'notes.txt.zip'])
  })

  it('discards a queued refresh when the in-flight load navigates to another directory', async () => {
    const store = useLocalFsStore()
    const existingEntry: FileEntry = {
      name: 'notes.txt',
      path: '/local/notes.txt',
      isDir: false,
      isSymlink: false,
      size: 10,
      modifiedAt: null
    }

    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/local',
      entries: [existingEntry]
    } as FileListResult)
    await store.load('/local')

    let resolveNavigation!: (result: FileListResult) => void
    vi.mocked(api.invoke).mockReturnValueOnce(new Promise<FileListResult>((resolve) => {
      resolveNavigation = resolve
    }))

    const navigationPromise = store.load('/other')
    await store.refreshIfViewing('/local')
    resolveNavigation({ path: '/other', entries: [] })
    await navigationPromise

    expect(api.invoke).toHaveBeenCalledTimes(2)
    expect(store.currentPath).toBe('/other')
    expect(store.entries).toEqual([])
  })

  it('keeps the latest listing when overlapping background refreshes finish out of order', async () => {
    const store = useLocalFsStore()
    const existingEntry: FileEntry = {
      name: 'notes.txt',
      path: '/local/notes.txt',
      isDir: false,
      isSymlink: false,
      size: 10,
      modifiedAt: null
    }
    const firstArchive: FileEntry = {
      name: 'first.zip',
      path: '/local/first.zip',
      isDir: false,
      isSymlink: false,
      size: 20,
      modifiedAt: null
    }
    const secondArchive: FileEntry = {
      name: 'second.zip',
      path: '/local/second.zip',
      isDir: false,
      isSymlink: false,
      size: 30,
      modifiedAt: null
    }

    vi.mocked(api.invoke).mockResolvedValueOnce({
      path: '/local',
      entries: [existingEntry]
    } as FileListResult)
    await store.load('/local')

    let resolveFirst!: (result: FileListResult) => void
    let resolveSecond!: (result: FileListResult) => void
    vi.mocked(api.invoke)
      .mockReturnValueOnce(new Promise<FileListResult>((resolve) => {
        resolveFirst = resolve
      }))
      .mockReturnValueOnce(new Promise<FileListResult>((resolve) => {
        resolveSecond = resolve
      }))

    const firstRefresh = store.refreshIfViewing('/local')
    const secondRefresh = store.refreshIfViewing('/local')
    expect(api.invoke).toHaveBeenCalledTimes(3)

    resolveSecond({ path: '/local', entries: [existingEntry, firstArchive, secondArchive] })
    await secondRefresh
    resolveFirst({ path: '/local', entries: [existingEntry, firstArchive] })
    await firstRefresh

    expect(store.entries.map((entry) => entry.name)).toEqual(['first.zip', 'notes.txt', 'second.zip'])
  })
})
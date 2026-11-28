import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { INVOKE_CHANNELS, type FileEntry } from '@shared/contract'
import { invoke } from '../api'
import { useLocalFsStore } from './localFs.store'

vi.mock('../api', () => ({ invoke: vi.fn() }))

function entry(name: string, dir = '/home', isDir = false): FileEntry {
  return { name, path: `${dir}/${name}`, isDir, size: 1, modifiedAt: null } as FileEntry
}

function listing(path: string, names: string[]) {
  return { path, entries: names.map((n) => entry(n, path)) }
}

describe('localFs.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(invoke).mockReset()
  })

  it('loads a directory, sorts it and clears the selection', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(listing('/home', ['b', 'a']))
    const store = useLocalFsStore()
    store.selected = new Set(['x'])
    expect(await store.load('/home')).toBe(true)
    expect(store.entries.map((e) => e.name)).toEqual(['a', 'b'])
    expect(store.selected.size).toBe(0)
    expect(store.loading).toBe(false)
  })

  it('records the error and failed path when a load fails, and retries that path', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('denied'))
    const store = useLocalFsStore()
    expect(await store.load('/root')).toBe(false)
    expect(store.error).toBe('denied')
    expect(store.failedPath).toBe('/root')
    vi.mocked(invoke).mockResolvedValueOnce(listing('/root', []))
    await store.retryDirectory()
    expect(invoke).toHaveBeenLastCalledWith(INVOKE_CHANNELS.fsLocalList, '/root')
    expect(store.error).toBeNull()
  })

  it('ignores a stale response superseded by a newer load', async () => {
    let finishFirst!: (value: unknown) => void
    vi.mocked(invoke)
      .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve }))
      .mockResolvedValueOnce(listing('/second', ['s']))
    const store = useLocalFsStore()
    const first = store.load('/first')
    await store.load('/second')
    finishFirst(listing('/first', ['f']))
    expect(await first).toBe(false)
    expect(store.currentPath).toBe('/second')
    expect(store.entries.map((e) => e.name)).toEqual(['s'])
  })

  it('walks back and forward through visited directories', async () => {
    const store = useLocalFsStore()
    vi.mocked(invoke).mockImplementation(async (_c, path) => listing(String(path), []))
    await store.load('/a')
    await store.load('/b')
    await store.load('/c')
    expect(store.canGoBack).toBe(true)
    await store.goBack()
    expect(store.currentPath).toBe('/b')
    expect(store.canGoForward).toBe(true)
    await store.goForward()
    expect(store.currentPath).toBe('/c')
  })

  it('goUp handles posix roots and windows drive roots', async () => {
    vi.mocked(invoke).mockImplementation(async (_c, path) => listing(String(path), []))
    const store = useLocalFsStore()
    await store.load('/home/user')
    await store.goUp()
    expect(store.currentPath).toBe('/home')
    await store.goUp()
    expect(store.currentPath).toBe('/')
    await store.load('C:\\Users\\me')
    await store.goUp()
    expect(store.currentPath).toBe('C:\\Users')
    await store.goUp()
    expect(store.currentPath).toBe('C:\\')
  })

  it('refreshIfViewing keeps surviving selection and skips other directories', async () => {
    const store = useLocalFsStore()
    vi.mocked(invoke).mockResolvedValueOnce(listing('/home', ['a', 'b']))
    await store.load('/home')
    store.selectPaths(['/home/a', '/home/b'])
    vi.mocked(invoke).mockResolvedValueOnce(listing('/home', ['b', 'c']))
    await store.refreshIfViewing('/home/')
    expect([...store.selected]).toEqual(['/home/b'])
    vi.mocked(invoke).mockClear()
    await store.refreshIfViewing('/elsewhere')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('setSort flips direction on the active column and resets on a new one', () => {
    const store = useLocalFsStore()
    store.setSort('name')
    expect(store.sortDirection).toBe('desc')
    store.setSort('size')
    expect([store.sortColumn, store.sortDirection]).toEqual(['size', 'asc'])
  })

  it('removeMany drops deleted entries, keeps failures and throws naming them', async () => {
    const store = useLocalFsStore()
    store.entries = [entry('a'), entry('b')]
    store.selected = new Set(['/home/a', '/home/b'])
    vi.mocked(invoke).mockImplementation(async (_c, path) => {
      if (path === '/home/b') throw new Error('busy')
    })
    await expect(store.removeMany([entry('a'), entry('b')])).rejects.toThrow('Failed to delete: b')
    expect(store.entries.map((e) => e.name)).toEqual(['b'])
    expect([...store.selected]).toEqual(['/home/b'])
  })

  it('rename moves the entry, selection and anchor to the new path', async () => {
    const store = useLocalFsStore()
    store.entries = [entry('a'), entry('z')]
    store.selected = new Set(['/home/a'])
    store.selectAnchor = '/home/a'
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    await store.rename(entry('a'), 'm', false)
    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalRename, '/home/a', '/home/m', false)
    expect(store.entries.map((e) => e.name)).toEqual(['m', 'z'])
    expect([...store.selected]).toEqual(['/home/m'])
    expect(store.selectAnchor).toBe('/home/m')
  })
})

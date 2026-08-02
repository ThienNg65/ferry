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

const siteStoreMock = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  duplicate: vi.fn()
}

const bookmarkStoreMock = {
  deleteForSite: vi.fn()
}

vi.mock('../sites/SiteStore', () => ({
  SiteStore: { getInstance: () => siteStoreMock }
}))

vi.mock('../bookmarks/BookmarkStore', () => ({
  BookmarkStore: { getInstance: () => bookmarkStoreMock }
}))

vi.mock('../sites/SessionImporter', () => ({
  scanImportCandidates: vi.fn()
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('sites.ipc', () => {
  let scanImportCandidates: typeof import('../sites/SessionImporter').scanImportCandidates

  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    ;({ scanImportCandidates } = await import('../sites/SessionImporter'))
    const { registerSitesHandlers } = await import('./sites.ipc')
    registerSitesHandlers()
  })

  it('sites:list returns the stored sites', async () => {
    siteStoreMock.list.mockReturnValueOnce([{ id: '1', name: 'a' }])
    const result = await invoke('sites:list')
    expect(result).toEqual({ ok: true, data: [{ id: '1', name: 'a' }] })
  })

  it('sites:create forwards the input and returns the created site', async () => {
    siteStoreMock.create.mockReturnValueOnce({ id: '2', name: 'b' })
    const input = { name: 'b', host: 'h', port: 22, username: 'u' }
    const result = await invoke('sites:create', input)
    expect(siteStoreMock.create).toHaveBeenCalledWith(input)
    expect(result).toEqual({ ok: true, data: { id: '2', name: 'b' } })
  })

  it('sites:update forwards id and input', async () => {
    siteStoreMock.update.mockReturnValueOnce({ id: '2', name: 'c' })
    const input = { name: 'c', host: 'h', port: 22, username: 'u' }
    const result = await invoke('sites:update', '2', input)
    expect(siteStoreMock.update).toHaveBeenCalledWith('2', input)
    expect(result).toEqual({ ok: true, data: { id: '2', name: 'c' } })
  })

  it('sites:delete removes the site and cascades to its bookmarks', async () => {
    const result = await invoke('sites:delete', '2')
    expect(siteStoreMock.delete).toHaveBeenCalledWith('2')
    expect(bookmarkStoreMock.deleteForSite).toHaveBeenCalledWith('2')
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('sites:duplicate forwards the id and returns the copy', async () => {
    siteStoreMock.duplicate.mockReturnValueOnce({ id: '3', name: 'b copy' })
    const result = await invoke('sites:duplicate', '2')
    expect(siteStoreMock.duplicate).toHaveBeenCalledWith('2')
    expect(result).toEqual({ ok: true, data: { id: '3', name: 'b copy' } })
  })

  it('sites:import-scan returns scanned candidates', async () => {
    vi.mocked(scanImportCandidates).mockReturnValueOnce([{ name: 'imported', host: 'h', username: 'u' }] as never)
    const result = await invoke('sites:import-scan')
    expect(result).toEqual({ ok: true, data: [{ name: 'imported', host: 'h', username: 'u' }] })
  })

  it('wraps an underlying SiteStore throw into an error envelope', async () => {
    siteStoreMock.create.mockImplementationOnce(() => {
      throw new Error('name already exists')
    })
    const result = await invoke('sites:create', { name: 'dup', host: 'h', port: 22, username: 'u' })
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'name already exists' })
  })
})

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handlers } from './envelope'
import { INVOKE_CHANNELS, type IpcResult } from '../../shared/contract'

const registered = handlers as unknown as Map<string, (...args: unknown[]) => Promise<unknown>>

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
    const input = { name: 'b', host: 'h', port: 22, username: 'u', authMethod: 'password' }
    const result = await invoke('sites:create', input)
    expect(siteStoreMock.create).toHaveBeenCalledWith(input)
    expect(result).toEqual({ ok: true, data: { id: '2', name: 'b' } })
  })

  it('sites:update forwards id and input', async () => {
    siteStoreMock.update.mockReturnValueOnce({ id: '2', name: 'c' })
    const input = { name: 'c', host: 'h', port: 22, username: 'u', authMethod: 'password' }
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
    const result = await invoke('sites:create', { name: 'dup', host: 'h', port: 22, username: 'u', authMethod: 'password' })
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'name already exists' })
  })

  it('sites:update preserves empty string secrets so cleared proxy/jump passwords clear saved ciphertext', async () => {
    siteStoreMock.update.mockReturnValueOnce({ id: '2', name: 'c' })
    const input = {
      name: 'c',
      host: 'h',
      port: 22,
      username: 'u',
      authMethod: 'password',
      proxyMode: 'custom',
      proxy: { type: 'socks5', host: 'p', port: 1080, password: '' },
      jumpHosts: [{ host: 'j', port: 22, username: 'ju', authMethod: 'password', password: '' }]
    }
    await invoke('sites:update', '2', input)
    expect(siteStoreMock.update).toHaveBeenCalledWith(
      '2',
      expect.objectContaining({
        proxy: expect.objectContaining({ password: '' }),
        jumpHosts: [expect.objectContaining({ password: '' })]
      })
    )
  })

  it('sites:importJson rejects invalid JSON and malformed site fields with VALIDATION code and specific message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ferry-sites-backup-'))
    try {
      const invalidJsonPath = join(dir, 'invalid.json')
      await writeFile(invalidJsonPath, '{not-json', 'utf-8')
      const invalidJsonResult = await invoke(INVOKE_CHANNELS.sitesImportJson, invalidJsonPath)
      expect(invalidJsonResult).toMatchObject({
        ok: false,
        code: 'VALIDATION',
        message: 'File is not valid JSON'
      })

      const malformedSitePath = join(dir, 'malformed.json')
      await writeFile(
        malformedSitePath,
        JSON.stringify({
          schemaVersion: 1,
          sites: [
            { host: 'one.example.com', port: 22, username: 'alice', authMethod: 'password' },
            { host: 'two.example.com', port: 99999, username: 'bob', authMethod: 'password' }
          ]
        }),
        'utf-8'
      )
      const malformedResult = await invoke(INVOKE_CHANNELS.sitesImportJson, malformedSitePath)
      expect(malformedResult).toMatchObject({
        ok: false,
        code: 'VALIDATION',
        message: 'Site 2: "port" must be a port between 1 and 65535'
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

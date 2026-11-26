import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { handlers } from './envelope'
import { setHost, type Host } from '../host/host'
import type { IpcResult, KnownHostEntry } from '../../shared/contract'

const registered = handlers as unknown as Map<string, (...args: unknown[]) => Promise<unknown>>

const appSettingsStoreMock = {
  get: vi.fn(),
  setOpenTabSiteIds: vi.fn(),
  setBandwidthLimitKBps: vi.fn(),
  setDefaultProxy: vi.fn(),
  setAutoCheckUpdates: vi.fn(),
  setHistoryRetentionDays: vi.fn(),
  setUiPref: vi.fn(),
  acceptTerms: vi.fn(),
  reset: vi.fn()
}

const transferQueueMock = {
  setBandwidthLimitKBps: vi.fn()
}

const historyStoreMock = {
  pruneExpired: vi.fn(),
  list: vi.fn(() => []),
  clear: vi.fn()
}

const siteStoreMock = {
  list: vi.fn(() => []),
  clear: vi.fn()
}

const bookmarkStoreMock = {
  list: vi.fn(() => []),
  clear: vi.fn()
}

const knownHostsStoreMock = {
  list: vi.fn((): KnownHostEntry[] => []),
  forgetKey: vi.fn(),
  clear: vi.fn()
}

vi.mock('../app/AppSettingsStore', () => ({
  AppSettingsStore: { getInstance: () => appSettingsStoreMock }
}))

vi.mock('../transfer/TransferQueue', () => ({
  TransferQueue: { getInstance: () => transferQueueMock }
}))

vi.mock('../history/HistoryStore', () => ({
  HistoryStore: { getInstance: () => historyStoreMock }
}))

vi.mock('../sites/SiteStore', () => ({
  SiteStore: { getInstance: () => siteStoreMock }
}))

vi.mock('../bookmarks/BookmarkStore', () => ({
  BookmarkStore: { getInstance: () => bookmarkStoreMock }
}))

vi.mock('../ssh/KnownHostsStore', () => ({
  KnownHostsStore: { getInstance: () => knownHostsStoreMock }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

function makeTestHost(dataDir: string): Host {
  return {
    broadcast: vi.fn(),
    isEncryptionAvailable: () => false,
    encrypt: (s) => s,
    decrypt: (s) => s,
    dataDir,
    openPath: vi.fn(async () => ''),
    pickOpenFile: vi.fn(async () => null)
  }
}

describe('settings.ipc', () => {
  const tempDirs: string[] = []

  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerSettingsHandlers } = await import('./settings.ipc')
    registerSettingsHandlers()
  })

  afterEach(() => {
    delete (globalThis as typeof globalThis & { __ferryHost?: Host }).__ferryHost
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true })
    }
  })

  it('settings:get returns the store snapshot and respects null historyRetentionDays', async () => {
    appSettingsStoreMock.get.mockReturnValueOnce({
      openTabSiteIds: [],
      bandwidthLimitKBps: null,
      defaultProxy: null,
      historyRetentionDays: null
    })
    const result = await invoke('settings:get')
    expect(historyStoreMock.pruneExpired).toHaveBeenCalledWith(null)
    expect(result).toEqual({
      ok: true,
      data: { openTabSiteIds: [], bandwidthLimitKBps: null, defaultProxy: null, historyRetentionDays: null }
    })
  })

  it('settings:setOpenTabs forwards the id list', async () => {
    const result = await invoke('settings:setOpenTabs', ['a', 'b'])
    expect(appSettingsStoreMock.setOpenTabSiteIds).toHaveBeenCalledWith(['a', 'b'])
    expect(result).toEqual({ ok: true, data: undefined })
  })

  describe('settings:setBandwidthLimit', () => {
    it('accepts a positive number and applies it to both the store and the live queue', async () => {
      const result = await invoke('settings:setBandwidthLimit', 512)
      expect(appSettingsStoreMock.setBandwidthLimitKBps).toHaveBeenCalledWith(512)
      expect(transferQueueMock.setBandwidthLimitKBps).toHaveBeenCalledWith(512)
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('accepts null to mean unlimited', async () => {
      const result = await invoke('settings:setBandwidthLimit', null)
      expect(appSettingsStoreMock.setBandwidthLimitKBps).toHaveBeenCalledWith(null)
      expect(transferQueueMock.setBandwidthLimitKBps).toHaveBeenCalledWith(null)
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('rejects zero', async () => {
      const result = await invoke('settings:setBandwidthLimit', 0)
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(appSettingsStoreMock.setBandwidthLimitKBps).not.toHaveBeenCalled()
    })

    it('rejects a negative number', async () => {
      const result = await invoke('settings:setBandwidthLimit', -10)
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
    })

    it('rejects non-finite values', async () => {
      const result = await invoke('settings:setBandwidthLimit', Infinity)
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
    })

    it('rejects NaN', async () => {
      const result = await invoke('settings:setBandwidthLimit', NaN)
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
    })
  })

  it('settings:setDefaultProxy forwards the proxy config', async () => {
    const proxy = { type: 'socks5' as const, host: 'proxy', port: 1080 }
    const result = await invoke('settings:setDefaultProxy', proxy)
    expect(appSettingsStoreMock.setDefaultProxy).toHaveBeenCalledWith(proxy)
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('settings:setAutoCheckUpdates forwards the boolean setting', async () => {
    const result = await invoke('settings:setAutoCheckUpdates', false)
    expect(appSettingsStoreMock.setAutoCheckUpdates).toHaveBeenCalledWith(false)
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('wraps an unexpected throw from the store into an UNKNOWN error envelope', async () => {
    appSettingsStoreMock.get.mockImplementationOnce(() => {
      throw new Error('disk read failed')
    })
    const result = await invoke('settings:get')
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'disk read failed' })
  })

  it('settings:setHistoryRetention validates bounds and forwards null/integer days', async () => {
    expect(await invoke('settings:setHistoryRetention', 0)).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(await invoke('settings:setHistoryRetention', 90)).toEqual({ ok: true, data: undefined })
    expect(appSettingsStoreMock.setHistoryRetentionDays).toHaveBeenCalledWith(90)
    expect(historyStoreMock.pruneExpired).toHaveBeenCalledWith(90)

    expect(await invoke('settings:setHistoryRetention', null)).toEqual({ ok: true, data: undefined })
    expect(appSettingsStoreMock.setHistoryRetentionDays).toHaveBeenCalledWith(null)
    expect(historyStoreMock.pruneExpired).toHaveBeenCalledWith(null)
  })

  it('settings:acceptTerms validates non-empty version and records acceptance', async () => {
    expect(await invoke('settings:acceptTerms', '  ')).toMatchObject({ ok: false, code: 'VALIDATION' })
    const record = { version: '1.0', acceptedAt: '2026-11-14T00:00:00.000Z' }
    appSettingsStoreMock.acceptTerms.mockReturnValueOnce(record)
    expect(await invoke('settings:acceptTerms', '1.0')).toEqual({ ok: true, data: record })
  })

  it('settings:setUiPref validates ferry:ui:* keys and forwards string or null values', async () => {
    expect(await invoke('settings:setUiPref', { key: 'other:key', value: 'true' })).toMatchObject({
      ok: false,
      code: 'VALIDATION'
    })
    expect(await invoke('settings:setUiPref', { key: 'ferry:ui:glassUi', value: 123 })).toMatchObject({
      ok: false,
      code: 'VALIDATION'
    })
    expect(await invoke('settings:setUiPref', { key: 'ferry:ui:glassUi', value: 'true' })).toEqual({
      ok: true,
      data: undefined
    })
    expect(appSettingsStoreMock.setUiPref).toHaveBeenCalledWith('ferry:ui:glassUi', 'true')
    expect(await invoke('settings:setUiPref', { key: 'ferry:ui:glassUi', value: null })).toEqual({
      ok: true,
      data: undefined
    })
    expect(appSettingsStoreMock.setUiPref).toHaveBeenCalledWith('ferry:ui:glassUi', null)
  })

  it('knownHosts handlers list, forget, and clear entries', async () => {
    knownHostsStoreMock.list.mockReturnValueOnce([{ hostPort: 'example.com:22', fingerprint: 'SHA256:abc' }])
    expect(await invoke('knownHosts:list')).toEqual({
      ok: true,
      data: [{ hostPort: 'example.com:22', fingerprint: 'SHA256:abc' }]
    })
    expect(await invoke('knownHosts:forget', '')).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(await invoke('knownHosts:forget', 'example.com:22')).toEqual({ ok: true, data: undefined })
    expect(knownHostsStoreMock.forgetKey).toHaveBeenCalledWith('example.com:22')
    expect(await invoke('knownHosts:clear')).toEqual({ ok: true, data: undefined })
    expect(knownHostsStoreMock.clear).toHaveBeenCalled()
  })

  it('privacy:exportData returns JSON bundle and privacy:deleteAllData wipes all stores', async () => {
    appSettingsStoreMock.get.mockReturnValueOnce({ openTabSiteIds: [], bandwidthLimitKBps: null })
    const exported = await invoke('privacy:exportData')
    expect(exported.ok).toBe(true)
    if (exported.ok) {
      const parsed = JSON.parse(exported.data as string)
      expect(parsed).toMatchObject({ sites: [], bookmarks: [], knownHosts: [], history: [] })
    }

    expect(await invoke('privacy:deleteAllData')).toEqual({ ok: true, data: undefined })
    expect(siteStoreMock.clear).toHaveBeenCalled()
    expect(bookmarkStoreMock.clear).toHaveBeenCalled()
    expect(historyStoreMock.clear).toHaveBeenCalled()
    expect(knownHostsStoreMock.clear).toHaveBeenCalled()
    expect(appSettingsStoreMock.reset).toHaveBeenCalled()
    expect(transferQueueMock.setBandwidthLimitKBps).toHaveBeenCalledWith(null)
  })

  it('privacy:deleteAllData removes upgrade-backups/ and Ferry store *.v*.bak.json files while preserving unrelated files', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ferry-settings-ipc-'))
    tempDirs.push(dataDir)
    setHost(makeTestHost(dataDir))

    const snapshotDir = path.join(dataDir, 'upgrade-backups', 'v1.4.0-1700000000000')
    mkdirSync(snapshotDir, { recursive: true })
    writeFileSync(path.join(snapshotDir, 'sites.json'), '{"sites":[]}')
    writeFileSync(path.join(snapshotDir, 'Local State'), '{"os_crypt":{}}')

    const ferryBackups = [
      path.join(dataDir, 'sites.v0.bak.json'),
      path.join(dataDir, 'app-settings.v1.bak.json'),
      path.join(dataDir, 'bookmarks.v0.bak.json'),
      path.join(dataDir, 'history.v0.bak.json'),
      path.join(dataDir, 'known_hosts.v0.bak.json')
    ]
    for (const file of ferryBackups) {
      writeFileSync(file, '{}')
    }

    const unrelatedFile = path.join(dataDir, 'unrelated.txt')
    const unrelatedBak = path.join(dataDir, 'notes.v1.bak.json')
    writeFileSync(unrelatedFile, 'keep')
    writeFileSync(unrelatedBak, '{"note":"keep"}')

    expect(await invoke('privacy:deleteAllData')).toEqual({ ok: true, data: undefined })
    expect(existsSync(path.join(dataDir, 'upgrade-backups'))).toBe(false)
    for (const file of ferryBackups) {
      expect(existsSync(file)).toBe(false)
    }
    expect(existsSync(unrelatedFile)).toBe(true)
    expect(existsSync(unrelatedBak)).toBe(true)
  })

  it('privacy:deleteAllData succeeds when no backup directory or *.v*.bak.json files exist', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ferry-settings-ipc-empty-'))
    tempDirs.push(dataDir)
    setHost(makeTestHost(dataDir))

    expect(await invoke('privacy:deleteAllData')).toEqual({ ok: true, data: undefined })
    expect(siteStoreMock.clear).toHaveBeenCalled()
    expect(appSettingsStoreMock.reset).toHaveBeenCalled()
  })

  it('privacy:deleteAllData succeeds when host dataDir does not exist on disk', async () => {
    const missingDir = path.join(os.tmpdir(), `ferry-settings-ipc-missing-${Date.now()}`)
    setHost(makeTestHost(missingDir))

    expect(await invoke('privacy:deleteAllData')).toEqual({ ok: true, data: undefined })
    expect(siteStoreMock.clear).toHaveBeenCalled()
  })
})

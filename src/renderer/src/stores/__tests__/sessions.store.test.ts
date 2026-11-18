import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { INVOKE_CHANNELS, type Site } from '@shared/contract'
import * as api from '../../api'

vi.mock('../../api', () => ({
  invoke: vi.fn(),
  onEvent: vi.fn(() => () => {}),
  IpcError: class IpcError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
}))

vi.mock('../../composables/useNotify', () => ({
  useNotify: () => ({
    success: vi.fn(),
    error: vi.fn(),
    prompt: vi.fn()
  })
}))

const mockRemoteFs = {
  loadForSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn()
}
const mockTerminalStreams = {
  ensureTerminal: vi.fn().mockResolvedValue('term-1'),
  disposeForSession: vi.fn().mockResolvedValue(undefined)
}
const mockTailStreams = {
  closeForSession: vi.fn().mockResolvedValue(undefined),
  rebindSession: vi.fn()
}
const mockMonitor = {
  clearSession: vi.fn()
}
const mockSites = {
  sites: [] as Site[],
  fetchSites: vi.fn().mockResolvedValue(undefined)
}

vi.mock('../remoteFs.store', () => ({
  useRemoteFsStore: () => mockRemoteFs
}))

vi.mock('../terminalStreams.store', () => ({
  useTerminalStreamsStore: () => mockTerminalStreams
}))

vi.mock('../tailStreams.store', () => ({
  useTailStreamsStore: () => mockTailStreams
}))

vi.mock('../monitor.store', () => ({
  useMonitorStore: () => mockMonitor
}))

vi.mock('../sites.store', () => ({
  useSitesStore: () => mockSites
}))

describe('sessions.store quick connect and promotion', () => {
  let storageData: Map<string, string>

  beforeEach(() => {
    storageData = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storageData.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storageData.set(key, value)
      },
      removeItem: (key: string) => {
        storageData.delete(key)
      }
    })
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockSites.sites = []
    vi.mocked(api.invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.sessionOpen) {
        return { sessionId: 'sess-1', status: 'connected' }
      }
      return undefined
    })
  })

  it('stores quickConnectInput on tab without password or passphrase and records non-secret MRU up to 8 entries', async () => {
    const { useSessionsStore } = await import('../sessions.store')
    const store = useSessionsStore()

    for (let i = 1; i <= 10; i++) {
      await store.connect({
        name: 'Quick Connect',
        host: `host-${i}.example.com`,
        port: 2220 + i,
        username: `user${i}`,
        authMethod: i % 2 === 0 ? 'privateKey' : 'password',
        password: `super-secret-${i}`,
        passphrase: `passphrase-${i}`,
        privateKeyPath: i % 2 === 0 ? `C:\\keys\\id_${i}` : undefined,
        proxyMode: i % 3 === 0 ? 'none' : 'inherit'
      })
    }

    const active = store.activeTab
    expect(active.quickConnectInput).toBeDefined()
    expect(active.quickConnectInput?.host).toBe('host-10.example.com')
    expect('password' in (active.quickConnectInput ?? {})).toBe(false)
    expect('passphrase' in (active.quickConnectInput ?? {})).toBe(false)

    expect(store.recentQuickConnects).toHaveLength(8)
    expect(store.recentQuickConnects[0]).toEqual({
      host: 'host-10.example.com',
      port: 2230,
      username: 'user10',
      authMethod: 'privateKey',
      privateKeyPath: 'C:\\keys\\id_10',
      proxyMode: 'inherit'
    })
    expect(store.recentQuickConnects[7].host).toBe('host-3.example.com')

    const persistedRaw = storageData.get('ferry:recentQuickConnect') ?? ''
    expect(persistedRaw).not.toContain('super-secret')
    expect(persistedRaw).not.toContain('passphrase-')

    // Re-connecting to an older entry moves it to front without duplicating
    await store.connect({
      name: 'Quick Connect',
      host: 'host-3.example.com',
      port: 2223,
      username: 'user3',
      authMethod: 'password',
      password: 'secret-again',
      proxyMode: 'none'
    })
    expect(store.recentQuickConnects).toHaveLength(8)
    expect(store.recentQuickConnects[0].host).toBe('host-3.example.com')
  })

  it('promotes an active Quick Connect tab to a saved site and persists open tabs', async () => {
    const { useSessionsStore } = await import('../sessions.store')
    const store = useSessionsStore()

    await store.connect({
      name: 'Quick Connect',
      host: '127.0.0.1',
      port: 2222,
      username: 'agent1',
      authMethod: 'password',
      password: 'pw'
    })

    const savedSite: Site = {
      id: 'site-123',
      name: 'agent1@127.0.0.1',
      host: '127.0.0.1',
      port: 2222,
      username: 'agent1',
      authMethod: 'password',
      remoteInitialPath: '/config',
      hasPassword: false,
      hasPassphrase: false,
      createdAt: '2026-11-15T00:00:00.000Z',
      updatedAt: '2026-11-15T00:00:00.000Z'
    }

    store.promoteTabToSite(store.activeTab.tabId, savedSite)

    expect(store.activeTab.siteId).toBe('site-123')
    expect(store.activeTab.label).toBe('agent1@127.0.0.1')
    expect(api.invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.settingsSetOpenTabs, ['site-123'])
  })

  it('ignores corrupt or out-of-range entries and strips secrets when loading recentQuickConnects from localStorage', async () => {
    const { vi } = await import('vitest')
    vi.resetModules()
    storageData.set(
      'ferry:recentQuickConnect',
      JSON.stringify([
        { host: 'valid.example.com', port: 2222, username: 'alice', authMethod: 'password', password: 'leaked', passphrase: 'leaked' },
        { host: 'bad-port.example.com', port: 70000, username: 'bob', authMethod: 'password' },
        { host: 123, port: 22, username: 'nope' }
      ])
    )
    setActivePinia(createPinia())
    const { useSessionsStore } = await import('../sessions.store')
    const store = useSessionsStore()

    expect(store.recentQuickConnects).toEqual([
      {
        host: 'valid.example.com',
        port: 2222,
        username: 'alice',
        authMethod: 'password',
        privateKeyPath: undefined,
        proxyMode: undefined
      }
    ])

    storageData.set('ferry:recentQuickConnect', '{not-valid-json')
    vi.resetModules()
    setActivePinia(createPinia())
    const { useSessionsStore: useSessionsStoreCorrupt } = await import('../sessions.store')
    expect(useSessionsStoreCorrupt().recentQuickConnects).toEqual([])
  })

  it('disconnectTab clears active state synchronously before session:close resolves, cleans up session stores, and preserves Quick Connect secrets for reconnectTab', async () => {
    const { useSessionsStore } = await import('../sessions.store')
    const store = useSessionsStore()

    await store.connect({
      name: 'Quick Connect',
      host: '10.0.0.5',
      port: 2222,
      username: 'alice',
      authMethod: 'password',
      password: 'top-secret-password'
    })

    const tabId = store.activeTab.tabId
    const sid = store.activeTab.sessionId
    expect(sid).toBeTruthy()
    expect(store.activeTab.status).toBe('connected')

    let resolveClose!: () => void
    let deferredFirstClose = false
    vi.mocked(api.invoke).mockImplementation((channel) => {
      if (channel === INVOKE_CHANNELS.sessionClose && !deferredFirstClose) {
        deferredFirstClose = true
        return new Promise<void>((resolve) => {
          resolveClose = resolve
        })
      }
      if (channel === INVOKE_CHANNELS.sessionOpen) {
        return Promise.resolve({ sessionId: 'sess-reconnected', status: 'connected' })
      }
      return Promise.resolve(undefined)
    })

    const disconnectPromise = store.disconnectTab(tabId)
    // Synchronously cleared before sessionClose resolves:
    expect(store.activeTab.sessionId).toBeNull()
    expect(store.activeTab.status).toBe('disconnected')
    expect(store.activeTab.connecting).toBe(false)

    resolveClose()
    await disconnectPromise

    expect(api.invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.sessionClose, sid)
    expect(mockRemoteFs.clearSession).toHaveBeenCalledWith(sid)
    expect(mockMonitor.clearSession).toHaveBeenCalledWith(sid)
    expect(mockTailStreams.closeForSession).toHaveBeenCalledWith(sid)
    expect(mockTerminalStreams.disposeForSession).toHaveBeenCalledWith(sid)

    // Reconnect reuses the in-memory Quick Connect secret directly:
    await store.reconnectTab(tabId)
    expect(api.invoke).toHaveBeenCalledWith(
      INVOKE_CHANNELS.sessionOpen,
      expect.objectContaining({
        quickConnect: expect.objectContaining({
          host: '10.0.0.5',
          username: 'alice',
          password: 'top-secret-password'
        })
      })
    )
    expect(store.activeTab.status).toBe('connected')

    // closeTab clears the ephemeral secret so no secret lingers after tab close
    await store.closeTab(tabId)
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0].tabId).not.toBe(tabId)
  })

  it('reconnectTab reconnects saved sites and falls back to picker if Quick Connect password is missing', async () => {
    const { useSessionsStore } = await import('../sessions.store')
    const store = useSessionsStore()

    const site: Site = {
      id: 'site-1',
      name: 'Prod Box',
      host: 'prod.example.com',
      port: 22,
      username: 'deploy',
      authMethod: 'agent',
      hasPassword: false,
      hasPassphrase: false,
      createdAt: '2026-11-15T00:00:00.000Z',
      updatedAt: '2026-11-15T00:00:00.000Z'
    }
    mockSites.sites = [site]

    await store.connectToSite(site)
    const siteTabId = store.activeTab.tabId
    await store.disconnectTab(siteTabId)
    expect(store.activeTab.status).toBe('disconnected')

    await store.reconnectTab(siteTabId)
    expect(store.activeTab.status).toBe('connected')
    expect(api.invoke).toHaveBeenCalledWith(
      INVOKE_CHANNELS.sessionOpen,
      expect.objectContaining({ siteId: 'site-1' })
    )

    // Quick Connect tab without cached password drops to picker (status = null) instead of connecting empty
    store.openNewTab()
    const qcTab = store.activeTab
    qcTab.quickConnectInput = {
      name: 'Quick Connect',
      host: 'qc.example.com',
      port: 22,
      username: 'bob',
      authMethod: 'password'
    }
    qcTab.status = 'error'

    vi.clearAllMocks()
    await store.reconnectTab(qcTab.tabId)
    expect(qcTab.status).toBeNull()
    expect(api.invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.sessionOpen, expect.anything())
  })

  it('duplicateTab clones saved-site and Quick Connect tabs and closeOtherTabs closes all other tabs', async () => {
    const { useSessionsStore } = await import('../sessions.store')
    const store = useSessionsStore()

    const site: Site = {
      id: 'site-dup',
      name: 'Dup Site',
      host: 'dup.example.com',
      port: 22,
      username: 'root',
      authMethod: 'agent',
      hasPassword: false,
      hasPassphrase: false,
      createdAt: '2026-11-15T00:00:00.000Z',
      updatedAt: '2026-11-15T00:00:00.000Z'
    }
    mockSites.sites = [site]

    await store.connectToSite(site)
    const firstTabId = store.activeTab.tabId

    await store.duplicateTab(firstTabId)
    expect(store.tabs).toHaveLength(2)
    const dupSiteTabId = store.activeTab.tabId
    expect(dupSiteTabId).not.toBe(firstTabId)
    expect(store.activeTab.siteId).toBe('site-dup')
    expect(store.activeTab.status).toBe('connected')

    store.openNewTab()
    await store.connect({
      name: 'Quick Connect',
      host: 'qc2.example.com',
      port: 2222,
      username: 'carol',
      authMethod: 'password',
      password: 'pw2'
    })
    const qcTabId = store.activeTab.tabId
    await store.duplicateTab(qcTabId)
    expect(store.tabs).toHaveLength(4)
    const dupQcTabId = store.activeTab.tabId
    expect(store.activeTab.status).toBe('connected')
    expect(store.activeTab.quickConnectInput?.host).toBe('qc2.example.com')

    await store.closeOtherTabs(dupQcTabId)
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0].tabId).toBe(dupQcTabId)
    expect(store.activeTabId).toBe(dupQcTabId)
  })

  it('connectToSite ignores a second site while the first is still connecting', async () => {
    const { useSessionsStore } = await import('../sessions.store')
    const store = useSessionsStore()
    const mk = (id: string): Site => ({
      id,
      name: id,
      host: `${id}.example.com`,
      port: 22,
      username: 'root',
      authMethod: 'agent',
      hasPassword: false,
      hasPassphrase: false,
      createdAt: '2026-11-17T00:00:00.000Z',
      updatedAt: '2026-11-17T00:00:00.000Z'
    })
    let resolveOpen!: (v: { sessionId: string; status: string }) => void
    vi.mocked(api.invoke).mockImplementation((channel) =>
      channel === INVOKE_CHANNELS.sessionOpen
        ? new Promise((resolve) => {
            resolveOpen = resolve as typeof resolveOpen
          })
        : Promise.resolve(undefined)
    )

    const first = store.connectToSite(mk('site-a'))
    await store.connectToSite(mk('site-b'))
    resolveOpen({ sessionId: 'sess-a', status: 'connected' })
    await first

    const opens = vi.mocked(api.invoke).mock.calls.filter(([c]) => c === INVOKE_CHANNELS.sessionOpen)
    expect(opens).toHaveLength(1)
    expect(opens[0][1]).toMatchObject({ siteId: 'site-a' })
  })

  it('promoteTabToSite copies active Quick Connect visibility filters to the promoted site without overwriting existing site filters', async () => {
    const { useSessionsStore } = await import('../sessions.store')
    const { useFileFiltersStore } = await import('../fileFilters.store')
    const sessions = useSessionsStore()
    const filters = useFileFiltersStore()

    await sessions.connect({
      name: 'QC Logs',
      host: 'logs.example.com',
      port: 22,
      username: 'ops',
      authMethod: 'password',
      password: 'pw'
    })
    const tabId = sessions.activeTab.tabId
    filters.setFilter('host:ops@logs.example.com', {
      include: ['*.log'],
      exclude: ['*.log.????-??-??']
    })

    const savedSite: Site = {
      id: 'site-promoted-1',
      name: 'Prod Logs',
      host: 'logs.example.com',
      port: 22,
      username: 'ops',
      authMethod: 'password',
      hasPassword: true,
      hasPassphrase: false,
      createdAt: '2026-11-17T00:00:00.000Z',
      updatedAt: '2026-11-17T00:00:00.000Z'
    }
    sessions.promoteTabToSite(tabId, savedSite)

    expect(filters.getFilter('site:site-promoted-1')).toEqual({
      include: ['*.log'],
      exclude: ['*.log.????-??-??']
    })
  })

  it('connectToSite opens a new tab instead of overwriting an already-connected activeTab', async () => {
    const { useSessionsStore } = await import('../sessions.store')
    const store = useSessionsStore()
    const mk = (id: string): Site => ({
      id,
      name: id,
      host: `${id}.example.com`,
      port: 22,
      username: 'root',
      authMethod: 'agent',
      hasPassword: false,
      hasPassphrase: false,
      createdAt: '2026-11-17T00:00:00.000Z',
      updatedAt: '2026-11-17T00:00:00.000Z'
    })

    await store.connectToSite(mk('site-1'))
    const tab1 = store.activeTab.tabId
    expect(store.activeTab.status).toBe('connected')

    await store.connectToSite(mk('site-2'), { newTabIfBusy: true })
    expect(store.tabs).toHaveLength(2)
    expect(store.tabs[0].tabId).toBe(tab1)
    expect(store.tabs[0].siteId).toBe('site-1')
    expect(store.tabs[0].status).toBe('connected')
    expect(store.activeTab.siteId).toBe('site-2')
  })

  it('cancelConnect restores fresh tab identity and disposes pre-warmed terminal stream', async () => {
    const { useSessionsStore } = await import('../sessions.store')
    const store = useSessionsStore()
    vi.mocked(api.invoke).mockImplementation((channel) =>
      channel === INVOKE_CHANNELS.sessionOpen ? new Promise(() => {}) : Promise.resolve(undefined)
    )

    void store.connect({
      name: 'Quick Connect',
      host: 'slow.example.com',
      port: 22,
      username: 'alice',
      authMethod: 'password',
      password: 'pw'
    })
    const sid = store.activeTab.sessionId!
    expect(store.activeTab.connecting).toBe(true)

    await store.cancelConnect(store.activeTab.tabId)
    expect(store.activeTab.connecting).toBe(false)
    expect(store.activeTab.sessionId).toBeNull()
    expect(store.activeTab.siteId).toBeNull()
    expect(store.activeTab.label).toBeNull()
    expect(store.activeTab.hostLabel).toBeNull()
    expect(store.activeTab.quickConnectInput).toBeUndefined()
    expect(mockTerminalStreams.disposeForSession).toHaveBeenCalledWith(sid)
  })

  it('reconnectAll stops remaining tabs when cancelConnect is triggered mid-batch', async () => {
    const { useSessionsStore } = await import('../sessions.store')
    const store = useSessionsStore()
    const mk = (id: string): Site => ({
      id,
      name: id,
      host: `${id}.example.com`,
      port: 22,
      username: 'root',
      authMethod: 'agent',
      hasPassword: false,
      hasPassphrase: false,
      createdAt: '2026-11-17T00:00:00.000Z',
      updatedAt: '2026-11-17T00:00:00.000Z'
    })
    mockSites.sites = [mk('s1'), mk('s2')]
    store.tabs[0].siteId = 's1'
    store.openNewTab()
    store.tabs[1].siteId = 's2'
    store.setActiveTab(store.tabs[0].tabId)

    let resolveFirst!: (v: { sessionId: string; status: string }) => void
    vi.mocked(api.invoke).mockImplementation((channel) => {
      if (channel === INVOKE_CHANNELS.sessionOpen) {
        return new Promise((resolve) => {
          resolveFirst = resolve as typeof resolveFirst
        })
      }
      return Promise.resolve(undefined)
    })

    const batch = store.reconnectAll()
    await store.cancelConnect(store.tabs[0].tabId)
    resolveFirst({ sessionId: 'sess-1', status: 'connected' })
    await batch

    const opens = vi.mocked(api.invoke).mock.calls.filter(([c]) => c === INVOKE_CHANNELS.sessionOpen)
    expect(opens).toHaveLength(1)
  })

  it('rebinds tail streams on reconnect and still calls closeForSession if sessionClose fails', async () => {
    const { useSessionsStore } = await import('../sessions.store')
    const store = useSessionsStore()
    await store.connect({
      name: 'QC',
      host: 'a.example.com',
      port: 22,
      username: 'alice',
      authMethod: 'password',
      password: 'pw'
    })
    const firstSid = store.activeTab.sessionId!
    store.activeTab.status = 'error'

    await store.reconnectTab(store.activeTab.tabId)
    const secondSid = store.activeTab.sessionId!
    expect(secondSid).not.toBe(firstSid)
    expect(mockTailStreams.rebindSession).toHaveBeenCalledWith(firstSid, secondSid)

    vi.mocked(api.invoke).mockRejectedValueOnce(new Error('close failed'))
    await expect(store.disconnectTab(store.activeTab.tabId)).rejects.toThrow('close failed')
    expect(mockTailStreams.closeForSession).toHaveBeenCalledWith(secondSid)
  })
})

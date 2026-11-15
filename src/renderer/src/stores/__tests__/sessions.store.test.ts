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

vi.mock('../remoteFs.store', () => ({
  useRemoteFsStore: () => ({
    loadForSession: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn()
  })
}))

vi.mock('../terminalStreams.store', () => ({
  useTerminalStreamsStore: () => ({
    ensureTerminal: vi.fn().mockResolvedValue('term-1'),
    disposeForSession: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('../tailStreams.store', () => ({
  useTailStreamsStore: () => ({
    closeForSession: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('../monitor.store', () => ({
  useMonitorStore: () => ({
    clearSession: vi.fn()
  })
}))

vi.mock('../sites.store', () => ({
  useSitesStore: () => ({
    sites: [],
    fetchSites: vi.fn().mockResolvedValue(undefined)
  })
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
})

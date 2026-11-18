import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  resolveConnectionFilterKey,
  resolveLegacyConnectionFilterKey,
  useFileFiltersStore
} from './fileFilters.store'

const PREFIX = 'ferry:visibilityFilter:'
const storage = new Map<string, string>()

function quickTab(port: number, host = 'Example.TEST', username = 'alice') {
  return {
    siteId: null,
    sessionId: `session-${port}`,
    hostLabel: `${username}@${host}`,
    quickConnectInput: { username, host, port }
  }
}

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key)
  })
  setActivePinia(createPinia())
})

afterEach(() => vi.unstubAllGlobals())

describe('Quick Connect visibility filter identity', () => {
  it('separates SSH ports without changing the terminal display label', () => {
    const on22 = quickTab(22)
    const on2222 = quickTab(2222)
    expect(on22.hostLabel).toBe(on2222.hostLabel)
    expect(resolveConnectionFilterKey(on22)).not.toBe(resolveConnectionFilterKey(on2222))
    expect(resolveConnectionFilterKey(on22)).toBe(resolveConnectionFilterKey(quickTab(22, 'example.test')))
    expect(resolveConnectionFilterKey(quickTab(22, '::1'))).toContain('%3A%3A1')
    expect(resolveConnectionFilterKey(on22)).not.toBe(resolveConnectionFilterKey(quickTab(22, 'example.test', 'bob')))
  })

  it('keeps filters independent when editing, clearing, reconnecting and restarting', () => {
    const store = useFileFiltersStore()
    const key22 = resolveConnectionFilterKey(quickTab(22))!
    const key2222 = resolveConnectionFilterKey(quickTab(2222))!
    store.setFilter(key22, { include: [], exclude: ['*.log'] })
    expect(store.getFilter(key2222)).toEqual({ include: [], exclude: [] })
    store.addPattern(key2222, 'include', '*.txt')
    expect(store.getFilter(key22).exclude).toEqual(['*.log'])
    expect(store.getFilter(key2222).include).toEqual(['*.txt'])

    // Different tab/session identity must not change a saved endpoint key.
    expect(resolveConnectionFilterKey({ ...quickTab(22), sessionId: 'reconnected' })).toBe(key22)
    setActivePinia(createPinia())
    const restored = useFileFiltersStore()
    expect(restored.getFilter(key22).exclude).toEqual(['*.log'])
    expect(restored.getFilter(key2222).include).toEqual(['*.txt'])
    restored.clearFilter(key22)
    expect(restored.getFilter(key22)).toEqual({ include: [], exclude: [] })
    expect(restored.getFilter(key2222).include).toEqual(['*.txt'])
  })

  it('migrates a legacy port-agnostic filter only to port 22, without reappearing after clear', () => {
    const on22 = quickTab(22)
    const oldKey = resolveLegacyConnectionFilterKey(on22)!
    const newKey = resolveConnectionFilterKey(on22)!
    storage.set(`${PREFIX}${oldKey}`, JSON.stringify({ include: [], exclude: ['*.tmp'] }))

    const store = useFileFiltersStore()
    const on2222 = quickTab(2222)
    expect(resolveLegacyConnectionFilterKey(on2222)).toBeNull()
    expect(store.getFilter(resolveConnectionFilterKey(on2222), resolveLegacyConnectionFilterKey(on2222))).toEqual({
      include: [],
      exclude: []
    })
    expect(storage.has(`${PREFIX}${oldKey}`)).toBe(true)

    expect(store.getFilter(newKey, oldKey).exclude).toEqual(['*.tmp'])
    expect(storage.has(`${PREFIX}${oldKey}`)).toBe(false)
    expect(storage.has(`${PREFIX}${newKey}`)).toBe(true)
    store.clearFilter(newKey)
    expect(store.getFilter(newKey, oldKey)).toEqual({ include: [], exclude: [] })
    setActivePinia(createPinia())
    expect(useFileFiltersStore().getFilter(newKey, oldKey)).toEqual({ include: [], exclude: [] })
  })

  it('does not overwrite an existing endpoint-specific filter during migration', () => {
    const on22 = quickTab(22)
    const oldKey = resolveLegacyConnectionFilterKey(on22)!
    const key = resolveConnectionFilterKey(on22)!
    storage.set(`${PREFIX}${oldKey}`, JSON.stringify({ include: [], exclude: ['*.bak'] }))
    storage.set(`${PREFIX}${key}`, JSON.stringify({ include: ['*.txt'], exclude: [] }))
    const store = useFileFiltersStore()
    expect(store.getFilter(key, oldKey)).toEqual({ include: ['*.txt'], exclude: [] })
    expect(storage.has(`${PREFIX}${oldKey}`)).toBe(false)
  })

  it('preserves saved-site keys and copies only the selected endpoint filter on promotion', () => {
    const store = useFileFiltersStore()
    const source = resolveConnectionFilterKey(quickTab(2222))!
    const siteTab = { ...quickTab(2222), siteId: 'site-123' }
    const siteKey = resolveConnectionFilterKey(siteTab)!
    expect(siteKey).toBe('site:site-123')
    expect(resolveLegacyConnectionFilterKey(siteTab)).toBeNull()
    store.setFilter(source, { include: ['*.conf'], exclude: [] })
    store.migrateConnectionFilter(source, siteKey)
    expect(store.getFilter(siteKey)).toEqual({ include: ['*.conf'], exclude: [] })
    store.setFilter(siteKey, { include: ['*.json'], exclude: [] })
    store.migrateConnectionFilter(source, siteKey)
    expect(store.getFilter(siteKey).include).toEqual(['*.json'])
  })
})

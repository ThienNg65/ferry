import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { resolveConnectionFilterKey, useFileFiltersStore } from '../fileFilters.store'

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k)
  })
  return data
}

describe('resolveConnectionFilterKey', () => {
  it('prefers siteId, then hostLabel, then sessionId, else null', () => {
    expect(resolveConnectionFilterKey({ siteId: 's1', hostLabel: 'u@h', sessionId: 'sess1' })).toBe('site:s1')
    expect(resolveConnectionFilterKey({ siteId: null, hostLabel: 'u@h', sessionId: 'sess1' })).toBe('host:u@h')
    expect(resolveConnectionFilterKey({ siteId: null, hostLabel: null, sessionId: 'sess1' })).toBe('session:sess1')
    expect(resolveConnectionFilterKey({ siteId: null, hostLabel: null, sessionId: null })).toBeNull()
  })
})

describe('useFileFiltersStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('isolates filters between connections and persists site/host filters to localStorage', () => {
    const data = stubStorage()
    const store = useFileFiltersStore()

    store.setFilter('site:alpha', {
      include: ['*.log'],
      exclude: ['*.log.????-??-??']
    })

    expect(store.getFilter('site:alpha')).toEqual({
      include: ['*.log'],
      exclude: ['*.log.????-??-??']
    })
    expect(store.getFilter('site:beta')).toEqual({ include: [], exclude: [] })
    expect(store.getFilter('host:bob@other')).toEqual({ include: [], exclude: [] })
    expect(data.get('ferry:visibilityFilter:site:alpha')).toBeTruthy()

    // Simulate app restart / reconnect with fresh Pinia store
    setActivePinia(createPinia())
    const restored = useFileFiltersStore()
    expect(restored.getFilter('site:alpha')).toEqual({
      include: ['*.log'],
      exclude: ['*.log.????-??-??']
    })
  })

  it('adds unique patterns via addPattern and removes storage entry on clearFilter', () => {
    const data = stubStorage()
    const store = useFileFiltersStore()

    store.addPattern('host:deploy@prod', 'exclude', '*.log.????-??-??')
    store.addPattern('host:deploy@prod', 'exclude', '*.log.????-??-??')
    store.addPattern('host:deploy@prod', 'include', '*.log')

    expect(store.getFilter('host:deploy@prod')).toEqual({
      include: ['*.log'],
      exclude: ['*.log.????-??-??']
    })
    expect(data.has('ferry:visibilityFilter:host:deploy@prod')).toBe(true)

    store.clearFilter('host:deploy@prod')
    expect(store.getFilter('host:deploy@prod')).toEqual({ include: [], exclude: [] })
    expect(data.has('ferry:visibilityFilter:host:deploy@prod')).toBe(false)
  })

  it('keeps ephemeral session keys in memory only and cleans them up on close', () => {
    const data = stubStorage()
    const store = useFileFiltersStore()

    store.setFilter('session:temp-1', { include: ['*.txt'], exclude: [] })
    expect(store.getFilter('session:temp-1')).toEqual({ include: ['*.txt'], exclude: [] })
    expect(data.size).toBe(0)

    store.clearEphemeralSession('temp-1')
    expect(store.getFilter('session:temp-1')).toEqual({ include: [], exclude: [] })
  })

  it('handles corrupt localStorage JSON gracefully without throwing', () => {
    stubStorage({
      'ferry:visibilityFilter:site:broken': '{not-json',
      'ferry:visibilityFilter:site:badshape': JSON.stringify({ include: [123, '*.log'], exclude: 'oops' })
    })
    const store = useFileFiltersStore()

    expect(store.getFilter('site:broken')).toEqual({ include: [], exclude: [] })
    expect(store.getFilter('site:badshape')).toEqual({ include: ['*.log'], exclude: [] })
  })

  it('migrates filters from source key to target key only when target has no active filter', () => {
    stubStorage()
    const store = useFileFiltersStore()

    store.setFilter('host:alice@prod', { include: ['*.log'], exclude: ['*.log.*'] })
    store.migrateConnectionFilter('host:alice@prod', 'site:new-id')
    expect(store.getFilter('site:new-id')).toEqual({ include: ['*.log'], exclude: ['*.log.*'] })

    // Does not overwrite an already-configured target site filter
    store.setFilter('host:alice@prod', { include: ['*.txt'], exclude: [] })
    store.migrateConnectionFilter('host:alice@prod', 'site:new-id')
    expect(store.getFilter('site:new-id')).toEqual({ include: ['*.log'], exclude: ['*.log.*'] })
  })
})

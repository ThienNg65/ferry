import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDirtyUiPrefs, isDirtyUiPref, migrateLegacyPref, readStored, writeStored } from './uiPref'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../api', () => ({ invoke }))

describe('migrateLegacyPref', () => {
  beforeEach(() => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key)
    })
    vi.stubGlobal('window', { api: {} })
    invoke.mockClear()
  })

  it('moves a legacy value to the ferry:ui: key, syncs it and removes the legacy key', () => {
    localStorage.setItem('ferry:dock:collapsed', 'false')
    migrateLegacyPref('ferry:dock:collapsed', 'ferry:ui:dockCollapsed')
    expect(readStored('ferry:ui:dockCollapsed')).toBe('false')
    expect(localStorage.getItem('ferry:dock:collapsed')).toBeNull()
    expect(invoke).toHaveBeenCalledWith('settings:setUiPref', { key: 'ferry:ui:dockCollapsed', value: 'false' })
  })

  it('keeps an existing new value and still drops the legacy key', () => {
    localStorage.setItem('ferry:dock:collapsed', 'false')
    localStorage.setItem('ferry:ui:dockCollapsed', 'true')
    migrateLegacyPref('ferry:dock:collapsed', 'ferry:ui:dockCollapsed')
    expect(readStored('ferry:ui:dockCollapsed')).toBe('true')
    expect(localStorage.getItem('ferry:dock:collapsed')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does nothing when there is no legacy value', () => {
    migrateLegacyPref('ferry:dock:collapsed', 'ferry:ui:dockCollapsed')
    expect(readStored('ferry:ui:dockCollapsed')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('writeStored', () => {
  beforeEach(() => {
    clearDirtyUiPrefs()
    invoke.mockClear()
    vi.stubGlobal('window', { api: {} })
  })

  it('still syncs to the sidecar when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => undefined
    })
    writeStored('ferry:ui:dockCollapsed', 'false')
    expect(invoke).toHaveBeenCalledWith('settings:setUiPref', { key: 'ferry:ui:dockCollapsed', value: 'false' })
  })

  it('marks a written key dirty so hydration can skip it', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
    expect(isDirtyUiPref('ferry:ui:monitorIntervalMs')).toBe(false)
    writeStored('ferry:ui:monitorIntervalMs', '5000')
    expect(isDirtyUiPref('ferry:ui:monitorIntervalMs')).toBe(true)
  })
})

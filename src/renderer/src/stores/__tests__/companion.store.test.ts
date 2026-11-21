// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCompanionStore } from '../companion.store'

describe('companion.store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows optional intro on first run and never a false upgrade banner', () => {
    const store = useCompanionStore()
    store.initLifecycle('1.3.1')
    expect(store.notice?.kind).toBe('intro')
    expect(store.lastSeenVersion).toBe('1.3.1')
  })

  it('shows one upgrade notice on genuine upgrade and does not repeat after dismissal', () => {
    localStorage.setItem('ferry:ui:companionSeenVer', '1.3.0')
    localStorage.setItem('ferry:ui:companionOnboarded', 'true')
    const store = useCompanionStore()

    store.initLifecycle('1.3.1')
    expect(store.notice?.kind).toBe('upgrade')
    expect(store.notice?.title).toContain('better')
    expect(store.previousVersion).toBe('1.3.0')

    store.dismissNotice()
    expect(store.notice).toBeNull()
    expect(store.dismissedVersions).toContain('1.3.1')
  })

  it('suppresses proactive notices in Quiet Mode', () => {
    localStorage.setItem('ferry:ui:companionQuiet', 'true')
    localStorage.setItem('ferry:ui:companionSeenVer', '1.3.0')
    const store = useCompanionStore()

    store.initLifecycle('1.3.1')
    expect(store.notice).toBeNull()

    store.notifyTransferFailure('Permission denied')
    vi.advanceTimersByTime(5000)
    expect(store.notice).toBeNull()
  })

  it('debounces and rate-limits transfer failure assistance notices', () => {
    localStorage.setItem('ferry:ui:companionSeenVer', '1.3.1')
    localStorage.setItem('ferry:ui:companionOnboarded', 'true')
    const store = useCompanionStore()

    store.notifyTransferFailure('Disk full')
    expect(store.notice).toBeNull()

    vi.advanceTimersByTime(1500)
    expect(store.notice?.kind).toBe('transfer-error')

    store.dismissNotice()
    store.notifyTransferFailure('Another error immediately')
    vi.advanceTimersByTime(2000)
    // Rate-limited within 5-minute window
    expect(store.notice).toBeNull()
  })

  it('hydrates preferences from app-settings uiPrefs', () => {
    const store = useCompanionStore()
    store.hydrateFromPrefs({
      'ferry:ui:companionQuiet': 'true',
      'ferry:ui:companionShowDock': 'false',
      'ferry:ui:companionSeenVer': '1.3.1'
    })
    expect(store.quietMode).toBe(true)
    expect(store.showInDock).toBe(false)
    expect(store.lastSeenVersion).toBe('1.3.1')
  })
})

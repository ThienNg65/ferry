import { describe, expect, it } from 'vitest'
import { clampDockHeight, clampDockWidth, DEFAULT_DOCK_WIDTH, MIN_DOCK_HEIGHT, MIN_DOCK_WIDTH } from './ui.store'

describe('clampDockHeight', () => {
  it('floors a too-small value at MIN_DOCK_HEIGHT', () => {
    expect(clampDockHeight(0, 1200)).toBe(MIN_DOCK_HEIGHT)
    expect(clampDockHeight(-50, 1200)).toBe(MIN_DOCK_HEIGHT)
  })

  it('caps at 70% of window height when that is the tighter bound', () => {
    // 70% of 2000 = 1400, which is well under (2000 - 260) = 1740.
    expect(clampDockHeight(5000, 2000)).toBe(1400)
  })

  it('caps at (window - reserved chrome) when that is the tighter bound', () => {
    // At a small window, window - 224 is tighter than 70% of window.
    // 600 - 224 = 376 < 600 * 0.7 = 420.
    expect(clampDockHeight(5000, 600)).toBe(376)
  })

  it('still yields at least MIN_DOCK_HEIGHT even at a tiny window', () => {
    expect(clampDockHeight(5000, 100)).toBe(MIN_DOCK_HEIGHT)
  })

  it('passes through an in-range value unchanged', () => {
    expect(clampDockHeight(300, 1200)).toBe(300)
  })
})

describe('clampDockWidth', () => {
  it('floors a too-small value at MIN_DOCK_WIDTH', () => {
    expect(clampDockWidth(0, 1400)).toBe(MIN_DOCK_WIDTH)
    expect(clampDockWidth(-50, 1400)).toBe(MIN_DOCK_WIDTH)
  })

  it('caps at 60% of window width', () => {
    expect(clampDockWidth(2000, 1500)).toBe(900)
  })

  it('still yields at least MIN_DOCK_WIDTH on a narrow window', () => {
    expect(clampDockWidth(500, 400)).toBe(MIN_DOCK_WIDTH)
  })

  it('passes through an in-range value unchanged', () => {
    expect(clampDockWidth(DEFAULT_DOCK_WIDTH, 1400)).toBe(DEFAULT_DOCK_WIDTH)
  })
})

describe('ui store layout state', () => {
  async function freshStore(stored: Record<string, string> = {}) {
    const { vi } = await import('vitest')
    const { createPinia, setActivePinia } = await import('pinia')
    const data = new Map(Object.entries(stored))
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      clear: () => data.clear()
    })
    vi.stubGlobal('window', { innerHeight: 900 })
    setActivePinia(createPinia())
    const { useUiStore } = await import('./ui.store')
    return { ui: useUiStore(), data }
  }

  it('defaults activePane to remote and does not persist it', async () => {
    const { ui, data } = await freshStore()
    expect(ui.activePane).toBe('remote')
    ui.activePane = 'local'
    expect(data.size).toBe(0)
  })

  it('defaults density to comfortable and persists setDensity', async () => {
    const { ui, data } = await freshStore()
    expect(ui.density).toBe('comfortable')
    ui.setDensity('compact')
    expect(data.get('ferry:ui:density')).toBe('compact')
  })

  it('restores a stored compact density', async () => {
    const { ui } = await freshStore({ 'ferry:ui:density': 'compact' })
    expect(ui.density).toBe('compact')
  })

  it('defaults shortenPath to false and persists setShortenPath', async () => {
    const { ui, data } = await freshStore()
    expect(ui.shortenPath).toBe(false)
    ui.setShortenPath(true)
    expect(ui.shortenPath).toBe(true)
    expect(data.get('ferry:ui:shortenPath')).toBe('true')
  })

  it('defaults terminal appearance and persists setters', async () => {
    const { ui, data } = await freshStore()
    expect(ui.terminalScheme).toBe('ferry')
    expect(ui.terminalFont).toBe('default')
    expect(ui.terminalFontSize).toBe(14)
    ui.setTerminalScheme('nord')
    ui.setTerminalFontSize(99)
    expect(data.get('ferry:ui:terminalScheme')).toBe('nord')
    expect(ui.terminalFontSize).toBe(24)
    expect(data.get('ferry:ui:terminalFontSize')).toBe('24')
  })

  it('falls back to defaults for invalid stored terminal values', async () => {
    const { ui } = await freshStore({
      'ferry:ui:terminalScheme': 'bogus',
      'ferry:ui:terminalFont': 'bogus',
      'ferry:ui:terminalFontSize': 'abc',
      'ferry:ui:terminalLineHeight': '9'
    })
    expect(ui.terminalScheme).toBe('ferry')
    expect(ui.terminalFont).toBe('default')
    expect(ui.terminalFontSize).toBe(14)
    expect(ui.terminalLineHeight).toBe(1.5)
  })

  it('keeps spaces typed into the custom font name', async () => {
    const { ui } = await freshStore()
    ui.setTerminalFont('custom')
    ui.setTerminalFontCustom('Fira ')
    expect(ui.terminalFontCustom).toBe('Fira ')
    ui.setTerminalFontCustom('Fira Code')
    expect(ui.terminalAppearance.fontFamily).toBe("'Fira Code', monospace")
  })

  it('treats an empty stored size or line height as the default', async () => {
    const { ui } = await freshStore({ 'ferry:ui:terminalFontSize': '', 'ferry:ui:terminalLineHeight': ' ' })
    expect(ui.terminalFontSize).toBe(14)
    expect(ui.terminalLineHeight).toBe(1)
  })

  it('terminalAppearance follows the app theme for the ferry scheme and resets', async () => {
    const { ui } = await freshStore({ 'ferry:ui:theme': 'dark' })
    const dark = ui.terminalAppearance.theme.background
    ui.theme = 'light'
    expect(ui.terminalAppearance.theme.background).not.toBe(dark)
    ui.setTerminalFontSize(18)
    ui.resetTerminalAppearance()
    expect(ui.terminalFontSize).toBe(14)
  })

  it('syncs theme and fallback Win32 captionColor via window:syncTheme', async () => {
    const { vi } = await import('vitest')
    const { INVOKE_CHANNELS } = await import('@shared/contract')
    const invokeMock = vi.fn().mockResolvedValue({ ok: true, data: undefined })
    const toggleMock = vi.fn()
    vi.stubGlobal('document', {
      documentElement: {
        classList: { toggle: toggleMock, contains: () => false },
        style: { setProperty: vi.fn() }
      }
    })
    const { ui } = await freshStore({ 'ferry:ui:theme': 'dark' })
    vi.stubGlobal('window', { innerHeight: 900, api: { invoke: invokeMock } })
    await ui.initTheme()
    expect(toggleMock).toHaveBeenCalledWith('dark', true)
    expect(invokeMock).toHaveBeenCalledWith(INVOKE_CHANNELS.windowSyncTheme, { theme: 'dark', captionColor: 0x262626 })
  })

  it('defaults dockPosition to bottom and dockWidth to 460, and persists toggles and clamped widths', async () => {
    const { vi } = await import('vitest')
    const { ui, data } = await freshStore()
    expect(ui.dockPosition).toBe('bottom')
    expect(ui.dockWidth).toBe(DEFAULT_DOCK_WIDTH)

    ui.toggleDockPosition()
    expect(ui.dockPosition).toBe('right')
    expect(data.get('ferry:ui:dockPosition')).toBe('right')

    ui.toggleDockPosition()
    expect(ui.dockPosition).toBe('bottom')
    expect(data.get('ferry:ui:dockPosition')).toBe('bottom')

    vi.stubGlobal('window', { innerHeight: 900, innerWidth: 1000 })
    ui.setDockWidth(800)
    expect(ui.dockWidth).toBe(600)
    expect(data.get('ferry:ui:dockWidth')).toBe('600')

    ui.setDockWidth(100)
    expect(ui.dockWidth).toBe(MIN_DOCK_WIDTH)
    expect(data.get('ferry:ui:dockWidth')).toBe(String(MIN_DOCK_WIDTH))
  })

  it('restores persisted dockPosition and clamped dockWidth on startup', async () => {
    const { vi } = await import('vitest')
    const { createPinia, setActivePinia } = await import('pinia')
    const data = new Map<string, string>([
      ['ferry:ui:dockPosition', 'right'],
      ['ferry:ui:dockWidth', '950']
    ])
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      clear: () => data.clear()
    })
    vi.stubGlobal('window', { innerHeight: 900, innerWidth: 1000 })
    setActivePinia(createPinia())
    const { useUiStore } = await import('./ui.store')
    const ui = useUiStore()
    expect(ui.dockPosition).toBe('right')
    expect(ui.dockWidth).toBe(600)
  })

  it('defaults terminalPredictiveEcho to true and persists setTerminalPredictiveEcho', async () => {
    const { ui, data } = await freshStore()
    expect(ui.terminalPredictiveEcho).toBe(true)
    ui.setTerminalPredictiveEcho(false)
    expect(ui.terminalPredictiveEcho).toBe(false)
    expect(data.get('ferry:ui:terminalPredictiveEcho')).toBe('false')
  })

  it('restores stored false terminalPredictiveEcho', async () => {
    const { ui } = await freshStore({ 'ferry:ui:terminalPredictiveEcho': 'false' })
    expect(ui.terminalPredictiveEcho).toBe(false)
  })

  it('resetTerminalAppearance leaves terminalPredictiveEcho unchanged', async () => {
    const { ui } = await freshStore()
    ui.setTerminalPredictiveEcho(false)
    ui.resetTerminalAppearance()
    expect(ui.terminalPredictiveEcho).toBe(false)
  })

  it('defaults glassUiEnabled and glassUiPromoDismissed to false and restores stored values', async () => {
    const { ui: defaults } = await freshStore()
    expect(defaults.glassUiEnabled).toBe(false)
    expect(defaults.glassUiPromoDismissed).toBe(false)

    const { ui: restored } = await freshStore({
      'ferry:ui:glassUi': 'true',
      'ferry:ui:glassUiPromoDismissed': 'true'
    })
    expect(restored.glassUiEnabled).toBe(true)
    expect(restored.glassUiPromoDismissed).toBe(true)
  })

  it('initGlassUi and setGlassUiEnabled toggle ferry-glass class, persist, and sync DWM caption color', async () => {
    const { vi } = await import('vitest')
    const { INVOKE_CHANNELS } = await import('@shared/contract')
    const classes = new Set<string>()
    const invokeMock = vi.fn().mockResolvedValue({ ok: true, data: undefined })
    vi.stubGlobal('document', {
      documentElement: {
        classList: {
          toggle: (cls: string, force?: boolean) => {
            const on = force === undefined ? !classes.has(cls) : force
            if (on) classes.add(cls)
            else classes.delete(cls)
            return on
          },
          contains: (cls: string) => classes.has(cls)
        },
        style: { setProperty: vi.fn() }
      }
    })
    const { ui, data } = await freshStore({ 'ferry:ui:theme': 'dark' })
    vi.stubGlobal('window', { innerHeight: 900, api: { invoke: invokeMock } })

    ui.initGlassUi()
    expect(classes.has('ferry-glass')).toBe(false)

    ui.setGlassUiEnabled(true)
    expect(ui.glassUiEnabled).toBe(true)
    expect(data.get('ferry:ui:glassUi')).toBe('true')
    expect(classes.has('ferry-glass')).toBe(true)
    expect(invokeMock).toHaveBeenCalledWith(INVOKE_CHANNELS.windowSyncTheme, {
      theme: 'dark',
      captionColor: 0x160d09
    })

    ui.setGlassUiEnabled(false)
    expect(ui.glassUiEnabled).toBe(false)
    expect(data.get('ferry:ui:glassUi')).toBe('false')
    expect(classes.has('ferry-glass')).toBe(false)
    expect(invokeMock).toHaveBeenLastCalledWith(INVOKE_CHANNELS.windowSyncTheme, {
      theme: 'dark',
      captionColor: 0x262626
    })
  })

  it('reads --ferry-caption-bg when ferry-glass is active and debounces accent theme sync', async () => {
    const { vi } = await import('vitest')
    const { INVOKE_CHANNELS } = await import('@shared/contract')
    vi.useFakeTimers()
    try {
      const classes = new Set<string>(['ferry-glass', 'dark'])
      const invokeMock = vi.fn().mockResolvedValue({ ok: true, data: undefined })
      vi.stubGlobal('CSS', { supports: () => true })
      vi.stubGlobal('getComputedStyle', () => ({
        getPropertyValue: (prop: string) => (prop === '--ferry-caption-bg' ? '#112233' : '')
      }))
      vi.stubGlobal('document', {
        documentElement: {
          classList: {
            toggle: (cls: string, force?: boolean) => {
              const on = force === undefined ? !classes.has(cls) : force
              if (on) classes.add(cls)
              else classes.delete(cls)
              return on
            },
            contains: (cls: string) => classes.has(cls)
          },
          style: { setProperty: vi.fn() }
        },
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: '',
            fillRect: vi.fn(),
            getImageData: () => ({ data: new Uint8ClampedArray([0x11, 0x22, 0x33, 255]) })
          })
        })
      })

      const { ui } = await freshStore({ 'ferry:ui:theme': 'dark', 'ferry:ui:glassUi': 'false' })
      vi.stubGlobal('window', { innerHeight: 900, api: { invoke: invokeMock } })

      // Classic mode: setAccentColor does not trigger window:syncTheme
      ui.setAccentColor('#8b5cf6')
      vi.advanceTimersByTime(300)
      expect(invokeMock).not.toHaveBeenCalled()

      // Glass mode: rapid accent changes debounce to a single window:syncTheme after 250ms
      ui.setGlassUiEnabled(true)
      invokeMock.mockClear()
      ui.setAccentColor('#22c55e')
      ui.setAccentColor('#f97316')
      expect(invokeMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(249)
      expect(invokeMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(invokeMock).toHaveBeenCalledTimes(1)
      expect(invokeMock).toHaveBeenCalledWith(INVOKE_CHANNELS.windowSyncTheme, {
        theme: 'dark',
        captionColor: 0x332211
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('persists dismissGlassUiPromo, harmonizes terminalAppearance, syncs favicon, and resets cleanly on resetGlassUi', async () => {
    const { vi } = await import('vitest')
    const classes = new Set<string>()
    const faviconLink = { type: 'image/x-icon', href: './favicon.ico' }
    vi.stubGlobal('document', {
      documentElement: {
        classList: {
          toggle: (cls: string, force?: boolean) => {
            const on = force === undefined ? !classes.has(cls) : force
            if (on) classes.add(cls)
            else classes.delete(cls)
            return on
          },
          contains: (cls: string) => classes.has(cls)
        },
        style: { setProperty: vi.fn() }
      },
      querySelector: (sel: string) => (sel === 'link[rel="icon"]' ? faviconLink : null)
    })
    const { ui, data } = await freshStore({ 'ferry:ui:theme': 'dark' })
    ui.setGlassUiEnabled(true)
    ui.dismissGlassUiPromo()
    expect(ui.glassUiPromoDismissed).toBe(true)
    expect(data.get('ferry:ui:glassUiPromoDismissed')).toBe('true')
    expect(ui.terminalAppearance.theme.background).toBe('#0b0f19')
    expect(faviconLink).toEqual({ type: 'image/svg+xml', href: './ferry-glass.svg' })

    data.clear()
    ui.resetGlassUi()
    expect(ui.glassUiEnabled).toBe(false)
    expect(ui.glassUiPromoDismissed).toBe(false)
    expect(classes.has('ferry-glass')).toBe(false)
    expect(data.size).toBe(0)
    expect(ui.terminalAppearance.theme.background).toBe('#1e1e1e')
    expect(faviconLink).toEqual({ type: 'image/x-icon', href: './favicon-classic.ico' })
  })
})

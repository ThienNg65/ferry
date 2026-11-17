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
      setItem: (k: string, v: string) => void data.set(k, v)
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
    vi.stubGlobal('document', { documentElement: { classList: { toggle: toggleMock }, style: { setProperty: vi.fn() } } })
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
      setItem: (k: string, v: string) => void data.set(k, v)
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
})

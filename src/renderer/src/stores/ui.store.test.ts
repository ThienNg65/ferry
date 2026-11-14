import { describe, expect, it } from 'vitest'
import { clampDockHeight, MIN_DOCK_HEIGHT } from './ui.store'

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
})

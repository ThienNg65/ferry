import { defineStore } from 'pinia'
import { INVOKE_CHANNELS, type WindowThemeSyncInput } from '@shared/contract'
import { invoke } from '../api'
import { clampColumnWidth, parseColumnPrefs, type ColumnKey, type ColumnPrefs } from '../utils/columnPrefs'
import { generateShadeRamp } from '../utils/colorRamp'
import {
  DEFAULT_FONT_ID,
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_SCHEME_ID,
  buildFontFamily,
  clampFontSize,
  clampLineHeight,
  isFontId,
  isSchemeId,
  resolveTheme,
  type TerminalTheme
} from '../utils/terminalAppearance'

const TERM_SCHEME_KEY = 'ferry:ui:terminalScheme'
const TERM_FONT_KEY = 'ferry:ui:terminalFont'
const TERM_FONT_CUSTOM_KEY = 'ferry:ui:terminalFontCustom'
const TERM_FONT_SIZE_KEY = 'ferry:ui:terminalFontSize'
const TERM_LINE_HEIGHT_KEY = 'ferry:ui:terminalLineHeight'

export interface TerminalAppearance {
  fontFamily: string
  fontSize: number
  lineHeight: number
  theme: TerminalTheme
}

function loadScrollback(): number {
  const stored = Number(readStored(TERM_SCROLLBACK_KEY))
  return SCROLLBACK_OPTIONS.includes(stored) ? stored : 5000
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string, dirtyKeys?: Set<string>): void {
  dirtyKeys?.add(key)
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore storage quota / restricted context errors.
  }
  if (typeof window !== 'undefined' && window.api) {
    void invoke<void>(INVOKE_CHANNELS.settingsSetUiPref, { key, value }).catch(() => {
      // Non-fatal in isolated unit tests or disconnected contexts.
    })
  }
}

const STORAGE_KEY = 'ferry:ui:showLocalPane'
const PERMISSIONS_DISPLAY_KEY = 'ferry:ui:permissionsDisplay'
const DENSITY_KEY = 'ferry:ui:density'
const SHORTEN_PATH_KEY = 'ferry:ui:shortenPath'
const SHOW_HIDDEN_KEY = 'ferry:ui:showHidden'
const TERM_SCROLLBACK_KEY = 'ferry:ui:terminalScrollback'
const TERM_PREDICTIVE_ECHO_KEY = 'ferry:ui:terminalPredictiveEcho'
export const SCROLLBACK_OPTIONS = [1000, 5000, 10000, 50000]
const COLUMNS_KEY = 'ferry:ui:columns'
const THEME_KEY = 'ferry:ui:theme'
const DOCK_HEIGHT_KEY = 'ferry:ui:dockHeight'
const DOCK_POSITION_KEY = 'ferry:ui:dockPosition'
const DOCK_WIDTH_KEY = 'ferry:ui:dockWidth'
const ACCENT_KEY = 'ferry:ui:accentColor'
const LOCAL_PANE_WIDTH_KEY = 'ferry:ui:localPaneWidth'
const GLASS_UI_KEY = 'ferry:ui:glassUi'
const GLASS_PROMO_DISMISSED_KEY = 'ferry:ui:glassUiPromoDismissed'
/** Matches this app's own default `--color-brand-500` (see main.css) — picking this preset is a no-op vs. today's look. */
export const DEFAULT_ACCENT_COLOR = '#0a84ff'
export const DEFAULT_LOCAL_PANE_WIDTH = 50

export type PermissionsDisplay = 'technical' | 'friendly'
export type Theme = 'light' | 'dark'
export type Density = 'compact' | 'comfortable'
export type DockPosition = 'bottom' | 'right'

/** The dock's pre-resize default (matches the old fixed `h-56`) — zero regression for existing users. */
export const MIN_DOCK_HEIGHT = 224
/** Cap the dock at a fraction of the window so it never feels like it's "taking over". */
export const MAX_DOCK_HEIGHT_RATIO = 0.7
/** Reserve space for site tab bar + toolbar/path bar + status bar above the dock. */
const RESERVED_CHROME_HEIGHT = 224

export const MIN_DOCK_WIDTH = 320
export const DEFAULT_DOCK_WIDTH = 460
export const MAX_DOCK_WIDTH_RATIO = 0.6

/**
 * Clamps a candidate dock height to [MIN_DOCK_HEIGHT, the smaller of 70% of
 * the window or (window − reserved chrome)] — pure so it's unit-testable and
 * reusable from both the store's init and a window-resize re-clamp.
 */
export function clampDockHeight(value: number, windowInnerHeight: number): number {
  const max = Math.max(
    MIN_DOCK_HEIGHT,
    Math.min(windowInnerHeight * MAX_DOCK_HEIGHT_RATIO, windowInnerHeight - RESERVED_CHROME_HEIGHT)
  )
  return Math.min(Math.max(value, MIN_DOCK_HEIGHT), max)
}

/** Clamps a candidate right-dock width to [MIN_DOCK_WIDTH, round(60% of window width)]. */
export function clampDockWidth(value: number, windowInnerWidth: number): number {
  const safeWindowWidth = Number.isFinite(windowInnerWidth) && windowInnerWidth > 0 ? windowInnerWidth : 1280
  const max = Math.max(MIN_DOCK_WIDTH, Math.round(safeWindowWidth * MAX_DOCK_WIDTH_RATIO))
  const safeValue = Number.isFinite(value) ? value : DEFAULT_DOCK_WIDTH
  return Math.min(Math.max(safeValue, MIN_DOCK_WIDTH), max)
}

function loadDockHeight(): number {
  const stored = Number(readStored(DOCK_HEIGHT_KEY))
  const initial = Number.isFinite(stored) && stored > 0 ? stored : MIN_DOCK_HEIGHT
  return clampDockHeight(initial, window.innerHeight)
}

function loadDockPosition(): DockPosition {
  return readStored(DOCK_POSITION_KEY) === 'right' ? 'right' : 'bottom'
}

function loadDockWidth(): number {
  const stored = Number(readStored(DOCK_WIDTH_KEY))
  const initial = Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_DOCK_WIDTH
  const width = typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : 1280
  return clampDockWidth(initial, width)
}

interface UiState {
  showLocalPane: boolean
  permissionsDisplay: PermissionsDisplay
  density: Density
  shortenPath: boolean
  showHidden: boolean
  terminalScrollback: number
  terminalPredictiveEcho: boolean
  columns: ColumnPrefs
  theme: Theme
  dockHeight: number
  dockPosition: DockPosition
  dockWidth: number
  accentColor: string
  localPaneWidth: number
  glassUiEnabled: boolean
  glassUiPromoDismissed: boolean
  terminalScheme: string
  terminalFont: string
  terminalFontCustom: string
  terminalFontSize: number
  terminalLineHeight: number
  /** Which file pane the user last interacted with — per-launch layout state, not persisted. */
  activePane: 'local' | 'remote'
  /** Keys modified locally during this session so delayed initial hydration cannot clobber newer edits. */
  dirtyPrefKeys: Set<string>
}

function loadPermissionsDisplay(): PermissionsDisplay {
  return readStored(PERMISSIONS_DISPLAY_KEY) === 'technical' ? 'technical' : 'friendly'
}

function loadDensity(): Density {
  return readStored(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

function loadTheme(): Theme {
  const stored = readStored(THEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return systemPrefersDark() ? 'dark' : 'light'
}

function resolveCssColor(token: string): string {
  const styles = getComputedStyle(document.documentElement)
  if (typeof document.documentElement.appendChild === 'function' && typeof document.createElement === 'function') {
    const probe = document.createElement('span')
    if (probe && probe.style) {
      probe.style.color = `var(${token})`
      probe.style.display = 'none'
      document.documentElement.appendChild(probe)
      const computed = getComputedStyle(probe).color?.trim()
      probe.remove?.()
      if (computed) return computed
    }
  }
  return styles.getPropertyValue(token).trim()
}

/** Converts `--ferry-caption-bg` (when `.ferry-glass` is active) or `--ui-bg-muted` into a Win32 COLORREF (`0x00BBGGRR`) so the Win11 titlebar matches `SiteTabBar`. */
function resolveCaptionColorRef(theme: Theme): number {
  const isGlass = document.documentElement.classList.contains('ferry-glass')
  const fallback = isGlass
    ? (theme === 'dark' ? 0x160d09 : 0xfbf6f4)
    : (theme === 'dark' ? 0x262626 : 0xfafafa)
  try {
    const raw = (isGlass ? resolveCssColor('--ferry-caption-bg') : '') || resolveCssColor('--ui-bg-muted')
    if (!raw || (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && !CSS.supports('color', raw))) {
      return fallback
    }
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return fallback
    // Two-sentinel guard: Canvas 2D silently ignores unparseable fillStyle assignments, leaving the previous color.
    ctx.fillStyle = '#010203'
    ctx.fillStyle = raw
    const first = ctx.fillStyle
    ctx.fillStyle = '#fefdfc'
    ctx.fillStyle = raw
    if (ctx.fillStyle !== first) return fallback
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    if (a !== 255) return fallback
    return ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)
  } catch {
    return fallback
  }
}

function syncDocumentFavicon(glassEnabled: boolean): void {
  if (typeof document === 'undefined') return
  const link = document.querySelector?.<HTMLLinkElement>('link[rel="icon"]')
  if (!link) return
  link.type = glassEnabled ? 'image/svg+xml' : 'image/x-icon'
  link.href = glassEnabled ? './ferry-glass.svg' : './favicon-classic.ico'
}

function applyGlassUiClass(enabled: boolean): void {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('ferry-glass', enabled)
    syncDocumentFavicon(enabled)
  }
}

let accentThemeSyncTimer: ReturnType<typeof setTimeout> | null = null

function clearAccentThemeSyncTimer(): void {
  if (accentThemeSyncTimer !== null) {
    clearTimeout(accentThemeSyncTimer)
    accentThemeSyncTimer = null
  }
}

async function applyTheme(theme: Theme): Promise<void> {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  if (typeof window !== 'undefined' && window.api) {
    try {
      const payload: WindowThemeSyncInput = { theme, captionColor: resolveCaptionColorRef(theme) }
      await invoke<void>(INVOKE_CHANNELS.windowSyncTheme, payload)
    } catch {
      // Non-fatal in test/non-Windows environments.
    }
  }
}

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function loadAccentColor(): string {
  const stored = readStored(ACCENT_KEY)
  return stored && HEX_COLOR_RE.test(stored) ? stored : DEFAULT_ACCENT_COLOR
}

/** Overrides `--ui-color-primary-*` directly (not `--color-brand-*`) — every Nuxt UI component's compiled styling resolves its `primary` semantic color through that variable at paint time (see main.css's own `--ui-primary: var(--ui-color-primary-600)`), so this is the one runtime-live override point regardless of which Tailwind build-time color the app shipped with. */
function applyAccentColor(hex: string): void {
  const ramp = generateShadeRamp(hex)
  for (const [shade, value] of Object.entries(ramp)) {
    document.documentElement.style.setProperty(`--ui-color-primary-${shade}`, value)
  }
}

function loadLocalPaneWidth(): number {
  const stored = Number(readStored(LOCAL_PANE_WIDTH_KEY))
  return Number.isFinite(stored) && stored >= 10 && stored <= 90 ? stored : DEFAULT_LOCAL_PANE_WIDTH
}

function loadGlassUiEnabled(): boolean {
  return readStored(GLASS_UI_KEY) === 'true'
}

function loadGlassUiPromoDismissed(): boolean {
  return readStored(GLASS_PROMO_DISMISSED_KEY) === 'true'
}

function loadTerminalScheme(): string {
  const stored = readStored(TERM_SCHEME_KEY)
  return stored && isSchemeId(stored) ? stored : DEFAULT_SCHEME_ID
}

function loadTerminalFont(): string {
  const stored = readStored(TERM_FONT_KEY)
  return stored && isFontId(stored) ? stored : DEFAULT_FONT_ID
}

function loadTerminalNumber(key: string, fallback: number, clamp: (n: number) => number): number {
  const raw = readStored(key)
  return raw === null || raw.trim() === '' ? fallback : clamp(Number(raw))
}

function loadTerminalPredictiveEcho(): boolean {
  return readStored(TERM_PREDICTIVE_ECHO_KEY) !== 'false'
}

/** UI-layout preferences that persist across restarts (not session/domain state). */
export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    showLocalPane: readStored(STORAGE_KEY) !== 'false',
    permissionsDisplay: loadPermissionsDisplay(),
    density: loadDensity(),
    shortenPath: readStored(SHORTEN_PATH_KEY) === 'true',
    showHidden: readStored(SHOW_HIDDEN_KEY) !== 'false',
    terminalScrollback: loadScrollback(),
    terminalPredictiveEcho: loadTerminalPredictiveEcho(),
    columns: parseColumnPrefs(readStored(COLUMNS_KEY)),
    theme: loadTheme(),
    dockHeight: loadDockHeight(),
    dockPosition: loadDockPosition(),
    dockWidth: loadDockWidth(),
    accentColor: loadAccentColor(),
    localPaneWidth: loadLocalPaneWidth(),
    glassUiEnabled: loadGlassUiEnabled(),
    glassUiPromoDismissed: loadGlassUiPromoDismissed(),
    terminalScheme: loadTerminalScheme(),
    terminalFont: loadTerminalFont(),
    terminalFontCustom: (readStored(TERM_FONT_CUSTOM_KEY) ?? '').slice(0, 60),
    terminalFontSize: loadTerminalNumber(TERM_FONT_SIZE_KEY, DEFAULT_FONT_SIZE, clampFontSize),
    terminalLineHeight: loadTerminalNumber(TERM_LINE_HEIGHT_KEY, DEFAULT_LINE_HEIGHT, clampLineHeight),
    activePane: 'remote',
    dirtyPrefKeys: new Set()
  }),

  getters: {
    terminalAppearance: (state): TerminalAppearance => ({
      fontFamily: buildFontFamily(state.terminalFont, state.terminalFontCustom),
      fontSize: state.terminalFontSize,
      lineHeight: state.terminalLineHeight,
      theme: resolveTheme(state.terminalScheme, state.theme, state.glassUiEnabled)
    })
  },

  actions: {
    setTerminalScheme(id: string): void {
      this.terminalScheme = isSchemeId(id) ? id : DEFAULT_SCHEME_ID
      writeStored(TERM_SCHEME_KEY, this.terminalScheme, this.dirtyPrefKeys)
    },

    setTerminalFont(id: string): void {
      this.terminalFont = isFontId(id) ? id : DEFAULT_FONT_ID
      writeStored(TERM_FONT_KEY, this.terminalFont, this.dirtyPrefKeys)
    },

    setTerminalFontCustom(name: string): void {
      this.terminalFontCustom = name.slice(0, 60)
      writeStored(TERM_FONT_CUSTOM_KEY, this.terminalFontCustom, this.dirtyPrefKeys)
    },

    setTerminalFontSize(size: number): void {
      this.terminalFontSize = clampFontSize(size)
      writeStored(TERM_FONT_SIZE_KEY, String(this.terminalFontSize), this.dirtyPrefKeys)
    },

    setTerminalLineHeight(height: number): void {
      this.terminalLineHeight = clampLineHeight(height)
      writeStored(TERM_LINE_HEIGHT_KEY, String(this.terminalLineHeight), this.dirtyPrefKeys)
    },

    resetTerminalAppearance(): void {
      this.setTerminalScheme(DEFAULT_SCHEME_ID)
      this.setTerminalFont(DEFAULT_FONT_ID)
      this.setTerminalFontCustom('')
      this.setTerminalFontSize(DEFAULT_FONT_SIZE)
      this.setTerminalLineHeight(DEFAULT_LINE_HEIGHT)
    },

    toggleLocalPane(): void {
      this.showLocalPane = !this.showLocalPane
      writeStored(STORAGE_KEY, String(this.showLocalPane), this.dirtyPrefKeys)
    },

    togglePermissionsDisplay(): void {
      this.permissionsDisplay = this.permissionsDisplay === 'friendly' ? 'technical' : 'friendly'
      writeStored(PERMISSIONS_DISPLAY_KEY, this.permissionsDisplay, this.dirtyPrefKeys)
    },

    setColumnVisible(key: ColumnKey, visible: boolean): void {
      const hidden = this.columns.hidden.filter((k) => k !== key)
      this.columns = { ...this.columns, hidden: visible ? hidden : [...hidden, key] }
      this.persistColumns()
    },

    setColumnWidth(key: ColumnKey, px: number): void {
      this.columns = { ...this.columns, widths: { ...this.columns.widths, [key]: clampColumnWidth(px) } }
    },

    persistColumns(): void {
      try {
        writeStored(COLUMNS_KEY, JSON.stringify(this.columns), this.dirtyPrefKeys)
      } catch {
        return
      }
    },

    setTerminalScrollback(lines: number): void {
      this.terminalScrollback = SCROLLBACK_OPTIONS.includes(lines) ? lines : 5000
      writeStored(TERM_SCROLLBACK_KEY, String(this.terminalScrollback), this.dirtyPrefKeys)
    },

    setTerminalPredictiveEcho(enabled: boolean): void {
      this.terminalPredictiveEcho = enabled
      writeStored(TERM_PREDICTIVE_ECHO_KEY, String(enabled), this.dirtyPrefKeys)
    },

    toggleShowHidden(): void {
      this.showHidden = !this.showHidden
      writeStored(SHOW_HIDDEN_KEY, String(this.showHidden), this.dirtyPrefKeys)
    },

    setDensity(density: Density): void {
      this.density = density
      writeStored(DENSITY_KEY, density, this.dirtyPrefKeys)
    },

    setShortenPath(shorten: boolean): void {
      this.shortenPath = shorten
      writeStored(SHORTEN_PATH_KEY, String(shorten), this.dirtyPrefKeys)
    },

    /** Applies the persisted theme to the document and OS window frame — call once on app start. */
    initTheme(): Promise<void> {
      return applyTheme(this.theme)
    },

    toggleTheme(): void {
      clearAccentThemeSyncTimer()
      this.theme = this.theme === 'dark' ? 'light' : 'dark'
      writeStored(THEME_KEY, this.theme, this.dirtyPrefKeys)
      void applyTheme(this.theme)
    },

    initGlassUi(): void {
      applyGlassUiClass(this.glassUiEnabled)
    },

    setGlassUiEnabled(enabled: boolean): void {
      clearAccentThemeSyncTimer()
      this.glassUiEnabled = enabled
      writeStored(GLASS_UI_KEY, String(enabled), this.dirtyPrefKeys)
      applyGlassUiClass(enabled)
      void applyTheme(this.theme)
    },

    dismissGlassUiPromo(): void {
      this.glassUiPromoDismissed = true
      writeStored(GLASS_PROMO_DISMISSED_KEY, 'true', this.dirtyPrefKeys)
    },

    /** Resets Glass UI state and root class after `localStorage.clear()` without re-writing storage keys. */
    resetGlassUi(): void {
      clearAccentThemeSyncTimer()
      this.dirtyPrefKeys.clear()
      this.glassUiEnabled = false
      this.glassUiPromoDismissed = false
      applyGlassUiClass(false)
      void applyTheme(this.theme)
    },

    /** Hydrates UI preferences from sidecar `app-settings.json` (survives Neutralino ephemeral ports). */
    hydrateFromPrefs(prefs: Record<string, string>): void {
      const entries = Object.entries(prefs).filter(
        ([key, value]) => key.startsWith('ferry:ui:') && typeof value === 'string' && !this.dirtyPrefKeys.has(key)
      )
      if (entries.length === 0) return

      for (const [key, value] of entries) {
        try {
          localStorage.setItem(key, value)
        } catch {
          // Ignore storage quota / restricted context errors.
        }
      }

      this.showLocalPane = readStored(STORAGE_KEY) !== 'false'
      this.permissionsDisplay = loadPermissionsDisplay()
      this.density = loadDensity()
      this.shortenPath = readStored(SHORTEN_PATH_KEY) === 'true'
      this.showHidden = readStored(SHOW_HIDDEN_KEY) !== 'false'
      this.terminalScrollback = loadScrollback()
      this.terminalPredictiveEcho = loadTerminalPredictiveEcho()
      this.columns = parseColumnPrefs(readStored(COLUMNS_KEY))
      this.theme = loadTheme()
      this.dockHeight = loadDockHeight()
      this.dockPosition = loadDockPosition()
      this.dockWidth = loadDockWidth()
      this.accentColor = loadAccentColor()
      this.localPaneWidth = loadLocalPaneWidth()
      this.glassUiEnabled = loadGlassUiEnabled()
      this.glassUiPromoDismissed = loadGlassUiPromoDismissed()
      this.terminalScheme = loadTerminalScheme()
      this.terminalFont = loadTerminalFont()
      this.terminalFontCustom = (readStored(TERM_FONT_CUSTOM_KEY) ?? '').slice(0, 60)
      this.terminalFontSize = loadTerminalNumber(TERM_FONT_SIZE_KEY, DEFAULT_FONT_SIZE, clampFontSize)
      this.terminalLineHeight = loadTerminalNumber(TERM_LINE_HEIGHT_KEY, DEFAULT_LINE_HEIGHT, clampLineHeight)

      applyGlassUiClass(this.glassUiEnabled)
      applyAccentColor(this.accentColor)
      void applyTheme(this.theme)
    },

    /** Applies the persisted accent color to the document — call once on app start, alongside initTheme(). */
    initAccentColor(): void {
      applyAccentColor(this.accentColor)
    },

    setAccentColor(hex: string): void {
      this.accentColor = hex
      writeStored(ACCENT_KEY, hex, this.dirtyPrefKeys)
      applyAccentColor(hex)
      if (this.glassUiEnabled) {
        clearAccentThemeSyncTimer()
        accentThemeSyncTimer = setTimeout(() => {
          accentThemeSyncTimer = null
          void applyTheme(this.theme)
        }, 250)
      }
    },

    /** Clamps + persists a new dock height — call once at drag-end, and again on window resize to re-clamp against the new viewport. */
    setDockHeight(px: number): void {
      this.dockHeight = clampDockHeight(px, window.innerHeight)
      writeStored(DOCK_HEIGHT_KEY, String(this.dockHeight), this.dirtyPrefKeys)
    },

    toggleDockPosition(): void {
      this.dockPosition = this.dockPosition === 'bottom' ? 'right' : 'bottom'
      writeStored(DOCK_POSITION_KEY, this.dockPosition, this.dirtyPrefKeys)
    },

    /** Clamps + persists a new right-dock width. */
    setDockWidth(px: number): void {
      const width = typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : 1280
      this.dockWidth = clampDockWidth(px, width)
      writeStored(DOCK_WIDTH_KEY, String(this.dockWidth), this.dirtyPrefKeys)
    },

    setLocalPaneWidth(percent: number): void {
      this.localPaneWidth = Math.max(10, Math.min(percent, 90))
    },

    saveLocalPaneWidth(): void {
      writeStored(LOCAL_PANE_WIDTH_KEY, String(this.localPaneWidth), this.dirtyPrefKeys)
    }
  }
})

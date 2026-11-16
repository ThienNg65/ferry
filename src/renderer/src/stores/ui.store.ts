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

const STORAGE_KEY = 'ferry:ui:showLocalPane'
const PERMISSIONS_DISPLAY_KEY = 'ferry:ui:permissionsDisplay'
const DENSITY_KEY = 'ferry:ui:density'
const SHORTEN_PATH_KEY = 'ferry:ui:shortenPath'
const SHOW_HIDDEN_KEY = 'ferry:ui:showHidden'
const TERM_SCROLLBACK_KEY = 'ferry:ui:terminalScrollback'
export const SCROLLBACK_OPTIONS = [1000, 5000, 10000, 50000]
const COLUMNS_KEY = 'ferry:ui:columns'
const THEME_KEY = 'ferry:ui:theme'
const DOCK_HEIGHT_KEY = 'ferry:ui:dockHeight'
const ACCENT_KEY = 'ferry:ui:accentColor'
const LOCAL_PANE_WIDTH_KEY = 'ferry:ui:localPaneWidth'
/** Matches this app's own default `--color-brand-500` (see main.css) — picking this preset is a no-op vs. today's look. */
export const DEFAULT_ACCENT_COLOR = '#0a84ff'
export const DEFAULT_LOCAL_PANE_WIDTH = 33.33

export type PermissionsDisplay = 'technical' | 'friendly'
export type Theme = 'light' | 'dark'
export type Density = 'compact' | 'comfortable'

/** The dock's pre-resize default (matches the old fixed `h-56`) — zero regression for existing users. */
export const MIN_DOCK_HEIGHT = 224
/** Cap the dock at a fraction of the window so it never feels like it's "taking over". */
export const MAX_DOCK_HEIGHT_RATIO = 0.7
/** Reserve space for site tab bar + toolbar/path bar + status bar above the dock. */
const RESERVED_CHROME_HEIGHT = 224

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

function loadDockHeight(): number {
  const stored = Number(localStorage.getItem(DOCK_HEIGHT_KEY))
  const initial = Number.isFinite(stored) && stored > 0 ? stored : MIN_DOCK_HEIGHT
  return clampDockHeight(initial, window.innerHeight)
}

interface UiState {
  showLocalPane: boolean
  permissionsDisplay: PermissionsDisplay
  density: Density
  shortenPath: boolean
  showHidden: boolean
  terminalScrollback: number
  columns: ColumnPrefs
  theme: Theme
  dockHeight: number
  accentColor: string
  localPaneWidth: number
  terminalScheme: string
  terminalFont: string
  terminalFontCustom: string
  terminalFontSize: number
  terminalLineHeight: number
  /** Which file pane the user last interacted with — per-launch layout state, not persisted. */
  activePane: 'local' | 'remote'
}

function loadPermissionsDisplay(): PermissionsDisplay {
  return localStorage.getItem(PERMISSIONS_DISPLAY_KEY) === 'technical' ? 'technical' : 'friendly'
}

function loadDensity(): Density {
  return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

function loadTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return systemPrefersDark() ? 'dark' : 'light'
}

/** Converts `--ui-bg-muted` (including `oklch(...)`) into a Win32 COLORREF (`0x00BBGGRR`) so the Win11 titlebar matches `SiteTabBar`. */
function resolveCaptionColorRef(theme: Theme): number {
  const fallback = theme === 'dark' ? 0x262626 : 0xfafafa
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ui-bg-muted').trim()
    if (!raw || (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && !CSS.supports('color', raw))) {
      return fallback
    }
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return fallback
    ctx.fillStyle = raw
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    if (a !== 255) return fallback
    return ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)
  } catch {
    return fallback
  }
}

async function applyTheme(theme: Theme): Promise<void> {
  document.documentElement.classList.toggle('dark', theme === 'dark')
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
  const stored = localStorage.getItem(ACCENT_KEY)
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
  const stored = Number(localStorage.getItem(LOCAL_PANE_WIDTH_KEY))
  return Number.isFinite(stored) && stored >= 10 && stored <= 90 ? stored : DEFAULT_LOCAL_PANE_WIDTH
}

function loadTerminalScheme(): string {
  const stored = localStorage.getItem(TERM_SCHEME_KEY)
  return stored && isSchemeId(stored) ? stored : DEFAULT_SCHEME_ID
}

function loadTerminalFont(): string {
  const stored = localStorage.getItem(TERM_FONT_KEY)
  return stored && isFontId(stored) ? stored : DEFAULT_FONT_ID
}

function loadTerminalNumber(key: string, fallback: number, clamp: (n: number) => number): number {
  const raw = localStorage.getItem(key)
  return raw === null || raw.trim() === '' ? fallback : clamp(Number(raw))
}

/** UI-layout preferences that persist across restarts (not session/domain state). */
export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    showLocalPane: localStorage.getItem(STORAGE_KEY) !== 'false',
    permissionsDisplay: loadPermissionsDisplay(),
    density: loadDensity(),
    shortenPath: localStorage.getItem(SHORTEN_PATH_KEY) === 'true',
    showHidden: localStorage.getItem(SHOW_HIDDEN_KEY) !== 'false',
    terminalScrollback: loadScrollback(),
    columns: parseColumnPrefs(readStored(COLUMNS_KEY)),
    theme: loadTheme(),
    dockHeight: loadDockHeight(),
    accentColor: loadAccentColor(),
    localPaneWidth: loadLocalPaneWidth(),
    terminalScheme: loadTerminalScheme(),
    terminalFont: loadTerminalFont(),
    terminalFontCustom: (localStorage.getItem(TERM_FONT_CUSTOM_KEY) ?? '').slice(0, 60),
    terminalFontSize: loadTerminalNumber(TERM_FONT_SIZE_KEY, DEFAULT_FONT_SIZE, clampFontSize),
    terminalLineHeight: loadTerminalNumber(TERM_LINE_HEIGHT_KEY, DEFAULT_LINE_HEIGHT, clampLineHeight),
    activePane: 'remote'
  }),

  getters: {
    terminalAppearance: (state): TerminalAppearance => ({
      fontFamily: buildFontFamily(state.terminalFont, state.terminalFontCustom),
      fontSize: state.terminalFontSize,
      lineHeight: state.terminalLineHeight,
      theme: resolveTheme(state.terminalScheme, state.theme)
    })
  },

  actions: {
    setTerminalScheme(id: string): void {
      this.terminalScheme = isSchemeId(id) ? id : DEFAULT_SCHEME_ID
      localStorage.setItem(TERM_SCHEME_KEY, this.terminalScheme)
    },

    setTerminalFont(id: string): void {
      this.terminalFont = isFontId(id) ? id : DEFAULT_FONT_ID
      localStorage.setItem(TERM_FONT_KEY, this.terminalFont)
    },

    setTerminalFontCustom(name: string): void {
      this.terminalFontCustom = name.slice(0, 60)
      localStorage.setItem(TERM_FONT_CUSTOM_KEY, this.terminalFontCustom)
    },

    setTerminalFontSize(size: number): void {
      this.terminalFontSize = clampFontSize(size)
      localStorage.setItem(TERM_FONT_SIZE_KEY, String(this.terminalFontSize))
    },

    setTerminalLineHeight(height: number): void {
      this.terminalLineHeight = clampLineHeight(height)
      localStorage.setItem(TERM_LINE_HEIGHT_KEY, String(this.terminalLineHeight))
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
      localStorage.setItem(STORAGE_KEY, String(this.showLocalPane))
    },

    togglePermissionsDisplay(): void {
      this.permissionsDisplay = this.permissionsDisplay === 'friendly' ? 'technical' : 'friendly'
      localStorage.setItem(PERMISSIONS_DISPLAY_KEY, this.permissionsDisplay)
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
        localStorage.setItem(COLUMNS_KEY, JSON.stringify(this.columns))
      } catch {
        return
      }
    },

    setTerminalScrollback(lines: number): void {
      this.terminalScrollback = SCROLLBACK_OPTIONS.includes(lines) ? lines : 5000
      localStorage.setItem(TERM_SCROLLBACK_KEY, String(this.terminalScrollback))
    },

    toggleShowHidden(): void {
      this.showHidden = !this.showHidden
      localStorage.setItem(SHOW_HIDDEN_KEY, String(this.showHidden))
    },

    setDensity(density: Density): void {
      this.density = density
      localStorage.setItem(DENSITY_KEY, density)
    },

    setShortenPath(shorten: boolean): void {
      this.shortenPath = shorten
      localStorage.setItem(SHORTEN_PATH_KEY, String(shorten))
    },

    /** Applies the persisted theme to the document and OS window frame — call once on app start. */
    initTheme(): Promise<void> {
      return applyTheme(this.theme)
    },

    toggleTheme(): void {
      this.theme = this.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_KEY, this.theme)
      void applyTheme(this.theme)
    },

    /** Applies the persisted accent color to the document — call once on app start, alongside initTheme(). */
    initAccentColor(): void {
      applyAccentColor(this.accentColor)
    },

    setAccentColor(hex: string): void {
      this.accentColor = hex
      localStorage.setItem(ACCENT_KEY, hex)
      applyAccentColor(hex)
    },

    /** Clamps + persists a new dock height — call once at drag-end, and again on window resize to re-clamp against the new viewport. */
    setDockHeight(px: number): void {
      this.dockHeight = clampDockHeight(px, window.innerHeight)
      localStorage.setItem(DOCK_HEIGHT_KEY, String(this.dockHeight))
    },

    setLocalPaneWidth(percent: number): void {
      this.localPaneWidth = Math.max(10, Math.min(percent, 90))
    },

    saveLocalPaneWidth(): void {
      localStorage.setItem(LOCAL_PANE_WIDTH_KEY, String(this.localPaneWidth))
    }
  }
})

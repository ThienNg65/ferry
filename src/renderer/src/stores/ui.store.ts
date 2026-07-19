import { defineStore } from 'pinia'
import { generateShadeRamp } from '../utils/colorRamp'

const STORAGE_KEY = 'ferry:ui:showLocalPane'
const PERMISSIONS_DISPLAY_KEY = 'ferry:ui:permissionsDisplay'
const THEME_KEY = 'ferry:ui:theme'
const DOCK_HEIGHT_KEY = 'ferry:ui:dockHeight'
const ACCENT_KEY = 'ferry:ui:accentColor'
/** Matches this app's own default `--color-brand-500` (see main.css) — picking this preset is a no-op vs. today's look. */
export const DEFAULT_ACCENT_COLOR = '#0a84ff'

export type PermissionsDisplay = 'technical' | 'friendly'
export type Theme = 'light' | 'dark'

/** The dock's pre-resize default (matches the old fixed `h-56`) — zero regression for existing users. */
export const MIN_DOCK_HEIGHT = 224
/** Cap the dock at a fraction of the window so it never feels like it's "taking over". */
export const MAX_DOCK_HEIGHT_RATIO = 0.7
/** Reserve space for title bar + site tab bar + toolbar/path bar + status bar above the dock. */
const RESERVED_CHROME_HEIGHT = 260

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
  theme: Theme
  dockHeight: number
  accentColor: string
}

function loadPermissionsDisplay(): PermissionsDisplay {
  return localStorage.getItem(PERMISSIONS_DISPLAY_KEY) === 'technical' ? 'technical' : 'friendly'
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

function loadTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return systemPrefersDark() ? 'dark' : 'light'
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
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

/** UI-layout preferences that persist across restarts (not session/domain state). */
export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    showLocalPane: localStorage.getItem(STORAGE_KEY) !== 'false',
    permissionsDisplay: loadPermissionsDisplay(),
    theme: loadTheme(),
    dockHeight: loadDockHeight(),
    accentColor: loadAccentColor()
  }),

  actions: {
    toggleLocalPane(): void {
      this.showLocalPane = !this.showLocalPane
      localStorage.setItem(STORAGE_KEY, String(this.showLocalPane))
    },

    togglePermissionsDisplay(): void {
      this.permissionsDisplay = this.permissionsDisplay === 'friendly' ? 'technical' : 'friendly'
      localStorage.setItem(PERMISSIONS_DISPLAY_KEY, this.permissionsDisplay)
    },

    /** Applies the persisted theme to the document — call once on app start. */
    initTheme(): void {
      applyTheme(this.theme)
    },

    toggleTheme(): void {
      this.theme = this.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_KEY, this.theme)
      applyTheme(this.theme)
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
    }
  }
})

import { defineStore } from 'pinia'

const STORAGE_KEY = 'ferry:ui:showLocalPane'
const PERMISSIONS_DISPLAY_KEY = 'ferry:ui:permissionsDisplay'
const THEME_KEY = 'ferry:ui:theme'

export type PermissionsDisplay = 'technical' | 'friendly'
export type Theme = 'light' | 'dark'

interface UiState {
  showLocalPane: boolean
  permissionsDisplay: PermissionsDisplay
  theme: Theme
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

/** UI-layout preferences that persist across restarts (not session/domain state). */
export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    showLocalPane: localStorage.getItem(STORAGE_KEY) !== 'false',
    permissionsDisplay: loadPermissionsDisplay(),
    theme: loadTheme()
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
    }
  }
})

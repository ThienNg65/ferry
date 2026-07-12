import { defineStore } from 'pinia'

const STORAGE_KEY = 'ferry:ui:showLocalPane'
const PERMISSIONS_DISPLAY_KEY = 'ferry:ui:permissionsDisplay'

export type PermissionsDisplay = 'technical' | 'friendly'

interface UiState {
  showLocalPane: boolean
  permissionsDisplay: PermissionsDisplay
}

function loadPermissionsDisplay(): PermissionsDisplay {
  return localStorage.getItem(PERMISSIONS_DISPLAY_KEY) === 'technical' ? 'technical' : 'friendly'
}

/** UI-layout preferences that persist across restarts (not session/domain state). */
export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    showLocalPane: localStorage.getItem(STORAGE_KEY) !== 'false',
    permissionsDisplay: loadPermissionsDisplay()
  }),

  actions: {
    toggleLocalPane(): void {
      this.showLocalPane = !this.showLocalPane
      localStorage.setItem(STORAGE_KEY, String(this.showLocalPane))
    },

    togglePermissionsDisplay(): void {
      this.permissionsDisplay = this.permissionsDisplay === 'friendly' ? 'technical' : 'friendly'
      localStorage.setItem(PERMISSIONS_DISPLAY_KEY, this.permissionsDisplay)
    }
  }
})

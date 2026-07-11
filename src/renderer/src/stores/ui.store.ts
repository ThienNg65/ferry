import { defineStore } from 'pinia'

const STORAGE_KEY = 'ferry:ui:showLocalPane'

interface UiState {
  showLocalPane: boolean
}

/** UI-layout preferences that persist across restarts (not session/domain state). */
export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    showLocalPane: localStorage.getItem(STORAGE_KEY) !== 'false'
  }),

  actions: {
    toggleLocalPane(): void {
      this.showLocalPane = !this.showLocalPane
      localStorage.setItem(STORAGE_KEY, String(this.showLocalPane))
    }
  }
})

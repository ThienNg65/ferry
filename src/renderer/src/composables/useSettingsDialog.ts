import { ref } from 'vue'

/** Singleton open/close state for the Settings dialog — shared by the title bar's gear button and the command palette. */
const isOpen = ref(false)

export function useSettingsDialog(): { isOpen: typeof isOpen; open: () => void; close: () => void } {
  return {
    isOpen,
    open: () => {
      isOpen.value = true
    },
    close: () => {
      isOpen.value = false
    }
  }
}

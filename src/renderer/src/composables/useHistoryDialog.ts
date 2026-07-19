import { ref } from 'vue'

/** Singleton open/close state for the History dialog — shared by the command palette and any future trigger. */
const isOpen = ref(false)

export function useHistoryDialog(): { isOpen: typeof isOpen; open: () => void; close: () => void } {
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

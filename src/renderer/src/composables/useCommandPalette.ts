import { ref } from 'vue'

/** Singleton open/close state for the Command Palette — shared by the global Ctrl/Cmd+K listener and the title bar search trigger. */
const isOpen = ref(false)

export function useCommandPalette(): {
  isOpen: typeof isOpen
  open: () => void
  close: () => void
  toggle: () => void
} {
  return {
    isOpen,
    open: () => {
      isOpen.value = true
    },
    close: () => {
      isOpen.value = false
    },
    toggle: () => {
      isOpen.value = !isOpen.value
    }
  }
}

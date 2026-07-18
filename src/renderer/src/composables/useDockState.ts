import { ref } from 'vue'

export type DockTab = 'transfers' | 'tail' | 'terminal' | 'activity' | 'monitor'

// Module-scoped singletons (the useSettingsDialog.ts pattern) — deliberately
// NOT ui.store.ts, which persists to localStorage; which dock tab is open is
// ephemeral per-launch layout state, not a preference.
const collapsed = ref(false)
const tab = ref<DockTab>('transfers')
/**
 * Once true, TerminalView stays mounted forever (it renders in a v-show
 * sibling in BottomDock.vue) so its xterm instances and scrollback never get
 * torn down by dock-tab switching.
 */
const terminalEverShown = ref(false)

/**
 * Shared BottomDock open/tab state. BottomDock.vue owns the rendering; other
 * components (e.g. the TitleBar busy indicator) can call `openDock()` to
 * expand it on a specific tab.
 */
export function useDockState() {
  function openDock(target: DockTab): void {
    collapsed.value = false
    tab.value = target
    if (target === 'terminal') {
      terminalEverShown.value = true
    }
  }

  return { collapsed, tab, terminalEverShown, openDock }
}

import { ref, watch } from 'vue'
import { migrateLegacyPref, readStored, writeStored } from '../utils/uiPref'

export type DockTab = 'transfers' | 'tail' | 'terminal' | 'activity' | 'monitor' | 'edits'

const COLLAPSED_KEY = 'ferry:ui:dockCollapsed'
const LEGACY_COLLAPSED_KEY = 'ferry:dock:collapsed'

function loadCollapsed(): boolean {
  migrateLegacyPref(LEGACY_COLLAPSED_KEY, COLLAPSED_KEY)
  return readStored(COLLAPSED_KEY) !== 'false'
}

const collapsed = ref(loadCollapsed())
watch(collapsed, (value) => writeStored(COLLAPSED_KEY, String(value)))
const tab = ref<DockTab>('transfers')
const isMaximized = ref(false)
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

  function toggleMaximize(): void {
    if (collapsed.value) {
      collapsed.value = false
    }
    isMaximized.value = !isMaximized.value
  }

  const reloadCollapsed = (): void => {
    collapsed.value = loadCollapsed()
  }
  return { collapsed, tab, terminalEverShown, isMaximized, openDock, toggleMaximize, reloadCollapsed }
}

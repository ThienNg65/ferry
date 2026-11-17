<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
// Not yet in the auto-generated global components.d.ts — deep-import instead
// of relying on <UCommandPalette> (see ImportSessionsDialog.vue/ChmodDialog.vue
// for the same pattern with <UCheckbox>).
import UCommandPalette from '@nuxt/ui/components/CommandPalette.vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import { invoke } from '../../api'
import { useSessionsStore } from '../../stores/sessions.store'
import { useSitesStore } from '../../stores/sites.store'
import { useUiStore } from '../../stores/ui.store'
import { useSettingsDialog } from '../../composables/useSettingsDialog'
import { useHistoryDialog } from '../../composables/useHistoryDialog'
import { useCommandPalette } from '../../composables/useCommandPalette'
import { useDockState } from '../../composables/useDockState'
import { useUpdateStore } from '../../stores/update.store'
import { useNotify } from '../../composables/useNotify'
import { useShortcutsDialog } from '../../composables/useShortcutsDialog'
import { getPaneActions } from '../../composables/usePaneActions'

const { isOpen: open } = useCommandPalette()
const sessions = useSessionsStore()
const sites = useSitesStore()
const ui = useUiStore()
const settingsDialog = useSettingsDialog()
const historyDialog = useHistoryDialog()
const { openDock } = useDockState()
const updateStore = useUpdateStore()
const notify = useNotify()
const shortcutsDialog = useShortcutsDialog()

function onKeydown(event: KeyboardEvent): void {
  // Terminal-first: while the xterm textarea is focused, Ctrl+K belongs to the
  // shell (readline kill-to-end-of-line) — the palette stays reachable from
  // everywhere else.
  if (event.target instanceof HTMLElement && event.target.closest('.xterm')) {
    return
  }
  // Typing in a dialog's text field must never be interrupted by the global shortcut
  // (mirrors the guard in FilePane.vue's onKeydown).
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    (event.target instanceof HTMLElement && event.target.isContentEditable)
  ) {
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    open.value = !open.value
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

function run(action: () => void | Promise<void>): void {
  open.value = false
  void action()
}

const groups = computed(() => {
  const actionItems = [
    { label: 'New tab', icon: 'i-lucide-plus', onSelect: () => run(() => sessions.openNewTab()) },
    {
      label: ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      icon: 'i-lucide-sun-moon',
      onSelect: () => run(() => ui.toggleTheme())
    },
    {
      label: ui.showLocalPane ? 'Hide Local pane' : 'Show Local pane',
      icon: 'i-lucide-panel-left',
      onSelect: () => run(() => ui.toggleLocalPane())
    },
    { label: 'Keyboard shortcuts', icon: 'i-lucide-keyboard', onSelect: () => run(() => shortcutsDialog.open()) },
    {
      label: 'Toggle full screen (F11)',
      icon: 'i-lucide-maximize-2',
      onSelect: () => run(() => invoke<void>(INVOKE_CHANNELS.windowFullScreenToggle))
    },
    {
      label: 'Maximize / Restore window',
      icon: 'i-lucide-square',
      onSelect: () => run(() => invoke<void>(INVOKE_CHANNELS.windowMaximizeToggle))
    },
    {
      label: 'Minimize window',
      icon: 'i-lucide-minus',
      onSelect: () => run(() => invoke<void>(INVOKE_CHANNELS.windowMinimize))
    },
    { label: 'Transfer History…', icon: 'i-lucide-history', onSelect: () => run(() => historyDialog.open()) },
    { label: 'Settings…', icon: 'i-lucide-settings', onSelect: () => run(() => settingsDialog.open()) },
    {
      label: 'Check for updates…',
      icon: 'i-lucide-refresh-cw',
      onSelect: () =>
        run(async () => {
          const res = await updateStore.checkNow()
          if (res.status === 'not-available') {
            notify.success('Up to date', `Ferry v${updateStore.currentVersion} is the latest version`)
          } else if (res.status === 'disabled') {
            notify.error('Updates unavailable', 'Auto-update is disabled in development mode')
          } else if (res.status === 'error' && res.error) {
            notify.error('Update check failed', res.error)
          }
        })
    }
  ]

  if (sessions.status === 'connected') {
    actionItems.push(
      { label: 'Open Terminal dock', icon: 'i-lucide-terminal', onSelect: () => run(() => openDock('terminal')) },
      { label: 'Open Log Tail dock', icon: 'i-lucide-scroll-text', onSelect: () => run(() => openDock('tail')) },
      { label: 'Open Resource Monitor dock', icon: 'i-lucide-activity', onSelect: () => run(() => openDock('monitor')) },
      { label: 'Open Transfers dock', icon: 'i-lucide-arrow-down-up', onSelect: () => run(() => openDock('transfers')) }
    )
  }

  const side = ui.activePane
  const paneActions = getPaneActions(side)
  const count = paneActions?.selectedCount() ?? 0
  const fileItems: { label: string; icon: string; onSelect: () => void }[] = []
  if (paneActions && count > 0) {
    if (count === 1) {
      fileItems.push({ label: 'Rename selected', icon: 'i-lucide-pencil', onSelect: () => run(paneActions.rename) })
      fileItems.push({ label: 'Edit selected', icon: 'i-lucide-file-pen', onSelect: () => run(paneActions.edit) })
    }
    fileItems.push({
      label: side === 'local' ? `Upload ${count} selected` : `Download ${count} selected`,
      icon: side === 'local' ? 'i-lucide-upload' : 'i-lucide-download',
      onSelect: () => run(paneActions.transfer)
    })
    fileItems.push({ label: `Delete ${count} selected`, icon: 'i-lucide-trash-2', onSelect: () => run(paneActions.remove) })
  }

  return [
    ...(fileItems.length > 0 ? [{ id: 'files', label: 'Selected files', items: fileItems }] : []),
    {
      id: 'actions',
      label: 'Actions',
      items: actionItems
    },
    {
      id: 'sites',
      label: 'Connect to site',
      items: sites.sites.map((site) => ({
        label: site.name,
        suffix: `${site.username}@${site.host}`,
        icon: 'i-lucide-server',
        onSelect: () => run(() => void sessions.connectToSite(site))
      }))
    }
  ]
})
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-lg' }">
    <template #content>
      <div @keydown.enter.stop>
        <UCommandPalette :groups="groups" placeholder="Type a command or search sites…" :close="false" />
      </div>
    </template>
  </UModal>
</template>

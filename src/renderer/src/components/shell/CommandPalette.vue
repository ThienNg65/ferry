<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
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
import { useCompanionStore } from '../../stores/companion.store'
import { useNotify } from '../../composables/useNotify'
import { useShortcutsDialog } from '../../composables/useShortcutsDialog'
import { getPaneActions } from '../../composables/usePaneActions'

interface PaletteItem {
  id: string
  label: string
  icon: string
  disabled?: boolean
  suffix?: string
  onSelect: () => void
}

interface PaletteGroup {
  id: string
  label: string
  items: PaletteItem[]
}

const { isOpen: open } = useCommandPalette()
const sessions = useSessionsStore()
const sites = useSitesStore()
const ui = useUiStore()
const settingsDialog = useSettingsDialog()
const historyDialog = useHistoryDialog()
const { openDock } = useDockState()
const updateStore = useUpdateStore()
const companion = useCompanionStore()
const notify = useNotify()
const shortcutsDialog = useShortcutsDialog()

const listboxId = useId()
const searchQuery = ref('')
const activeIndex = ref(0)
const inputRef = ref<{ inputRef?: HTMLInputElement } | null>(null)
const listRef = ref<HTMLElement | null>(null)

function onKeydown(event: KeyboardEvent): void {
  // Terminal-first: while the xterm textarea is focused, Ctrl+K belongs to the
  // shell (readline kill-to-end-of-line) — the palette stays reachable from
  // everywhere else.
  if (event.target instanceof HTMLElement && event.target.closest('.xterm')) {
    return
  }
  const isToggleKey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'
  if (isToggleKey && open.value) {
    event.preventDefault()
    open.value = false
    return
  }
  // Ignore typing inside an active input unless it belongs to a closing dialog's leave transition.
  const target = event.target
  const inClosingDialog = target instanceof HTMLElement && Boolean(target.closest('[role="dialog"][data-state="closed"]'))
  if (
    !inClosingDialog &&
    (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable))
  ) {
    return
  }
  if (isToggleKey) {
    if (document.querySelector('[role="dialog"]:not([data-state="closed"])')) {
      return
    }
    event.preventDefault()
    open.value = true
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

function run(action: () => void | Promise<void>): void {
  open.value = false
  void action()
}

const groups = computed<PaletteGroup[]>(() => {
  const actionItems: PaletteItem[] = [
    { id: 'act-new-tab', label: 'New tab', icon: 'i-lucide-plus', onSelect: () => run(() => sessions.openNewTab()) },
    {
      id: 'act-theme',
      label: ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      icon: 'i-lucide-sun-moon',
      onSelect: () => run(() => ui.toggleTheme())
    },
    {
      id: 'act-local-pane',
      label: ui.showLocalPane ? 'Hide Local pane' : 'Show Local pane',
      icon: 'i-lucide-panel-left',
      onSelect: () => run(() => ui.toggleLocalPane())
    },
    { id: 'act-shortcuts', label: 'Keyboard shortcuts', icon: 'i-lucide-keyboard', onSelect: () => run(() => shortcutsDialog.open()) },
    {
      id: 'act-companion',
      label: 'Open Ferry Companion',
      icon: 'i-lucide-ship',
      suffix: 'Ctrl+Space',
      onSelect: () => run(() => companion.openPanel('chat'))
    },
    {
      id: 'act-companion-whats-new',
      label: "What's New in Ferry",
      icon: 'i-lucide-sparkles',
      onSelect: () => run(() => companion.openPanel('whats-new'))
    },
    {
      id: 'act-companion-report',
      label: 'Report a Bug / Send Feedback',
      icon: 'i-lucide-bug',
      onSelect: () => run(() => companion.openPanel('report'))
    },
    {
      id: 'act-fullscreen',
      label: 'Toggle full screen (F11)',
      icon: 'i-lucide-maximize-2',
      onSelect: () => run(() => invoke<void>(INVOKE_CHANNELS.windowFullScreenToggle))
    },
    {
      id: 'act-maximize',
      label: 'Maximize / Restore window',
      icon: 'i-lucide-square',
      onSelect: () => run(() => invoke<void>(INVOKE_CHANNELS.windowMaximizeToggle))
    },
    {
      id: 'act-minimize',
      label: 'Minimize window',
      icon: 'i-lucide-minus',
      onSelect: () => run(() => invoke<void>(INVOKE_CHANNELS.windowMinimize))
    },
    { id: 'act-history', label: 'Transfer History…', icon: 'i-lucide-history', onSelect: () => run(() => historyDialog.open()) },
    { id: 'act-settings', label: 'Settings…', icon: 'i-lucide-settings', onSelect: () => run(() => settingsDialog.open()) },
    {
      id: 'act-updates',
      label: 'Check for updates…',
      icon: 'i-lucide-refresh-cw',
      disabled: !updateStore.canCheck,
      suffix: updateStore.isChecking
        ? 'Checking…'
        : updateStore.isDownloading
          ? 'Downloading…'
          : undefined,
      onSelect: () =>
        run(async () => {
          if (!updateStore.canCheck) {
            return
          }
          const res = await updateStore.checkNow()
          if (res.status === 'not-available') {
            notify.success(
              'Up to date',
              updateStore.currentVersion
                ? `Ferry v${updateStore.currentVersion} is the latest version`
                : 'You are running the latest version'
            )
          } else if (res.status === 'disabled') {
            notify.error('Updates unavailable', 'Auto-update is disabled in development mode')
          } else if (res.status === 'error' && res.error) {
            notify.error('Update check failed', res.error)
          }
        })
    }
  ]

  if (updateStore.isDownloaded) {
    actionItems.push({
      id: 'act-install-update',
      label: updateStore.availableVersion
        ? `Restart & install update (v${updateStore.availableVersion})`
        : 'Restart & install update',
      icon: 'i-lucide-arrow-up-circle',
      disabled: updateStore.installing,
      onSelect: () => run(() => updateStore.installNow())
    })
  }

  if (sessions.status === 'connected') {
    actionItems.push(
      { id: 'act-dock-terminal', label: 'Open Terminal dock', icon: 'i-lucide-terminal', onSelect: () => run(() => openDock('terminal')) },
      { id: 'act-dock-tail', label: 'Open Log Tail dock', icon: 'i-lucide-scroll-text', onSelect: () => run(() => openDock('tail')) },
      { id: 'act-dock-monitor', label: 'Open Resource Monitor dock', icon: 'i-lucide-activity', onSelect: () => run(() => openDock('monitor')) },
      { id: 'act-dock-transfers', label: 'Open Transfers dock', icon: 'i-lucide-arrow-down-up', onSelect: () => run(() => openDock('transfers')) }
    )
  }

  const side = ui.activePane
  const paneActions = getPaneActions(side)
  const count = paneActions?.selectedCount() ?? 0
  const fileItems: PaletteItem[] = []
  if (paneActions && count > 0) {
    if (count === 1) {
      fileItems.push({ id: 'file-rename', label: 'Rename selected', icon: 'i-lucide-pencil', onSelect: () => run(paneActions.rename) })
      fileItems.push({ id: 'file-edit', label: 'Edit selected', icon: 'i-lucide-file-pen', onSelect: () => run(paneActions.edit) })
    }
    fileItems.push({
      id: 'file-transfer',
      label: side === 'local' ? `Upload ${count} selected` : `Download ${count} selected`,
      icon: side === 'local' ? 'i-lucide-upload' : 'i-lucide-download',
      onSelect: () => run(paneActions.transfer)
    })
    fileItems.push({ id: 'file-delete', label: `Delete ${count} selected`, icon: 'i-lucide-trash-2', onSelect: () => run(paneActions.remove) })
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
        id: `site-${site.id}`,
        label: site.name,
        suffix: `${site.username}@${site.host}`,
        icon: 'i-lucide-server',
        onSelect: () => run(() => void sessions.connectToSite(site, { newTabIfBusy: true }))
      }))
    }
  ]
})

const filteredGroups = computed<PaletteGroup[]>(() => {
  const tokens = searchQuery.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return groups.value.filter((g) => g.items.length > 0)
  }
  const out: PaletteGroup[] = []
  for (const group of groups.value) {
    const matched = group.items.filter((item) => {
      const hay = `${item.label} ${item.suffix ?? ''} ${group.label}`.toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
    if (matched.length > 0) {
      out.push({ ...group, items: matched })
    }
  }
  return out
})

const enabledItems = computed<PaletteItem[]>(() =>
  filteredGroups.value.flatMap((g) => g.items.filter((i) => !i.disabled))
)

const activeItem = computed<PaletteItem | null>(() => enabledItems.value[activeIndex.value] ?? null)
const activeOptionId = computed(() => (activeItem.value ? `${listboxId}-${activeItem.value.id}` : undefined))

function enabledIndexOf(item: PaletteItem): number {
  return enabledItems.value.findIndex((candidate) => candidate.id === item.id)
}

function scrollActiveIntoView(): void {
  void nextTick(() => {
    const id = activeOptionId.value
    if (!id || !listRef.value) return
    listRef.value.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })
  })
}

watch(open, (isOpen) => {
  if (isOpen) {
    searchQuery.value = ''
    activeIndex.value = 0
    void nextTick(() => {
      inputRef.value?.inputRef?.focus()
    })
  }
})

watch(searchQuery, () => {
  activeIndex.value = 0
})

watch(
  () => enabledItems.value.length,
  (len) => {
    if (len === 0) {
      activeIndex.value = 0
    } else if (activeIndex.value >= len) {
      activeIndex.value = len - 1
    }
  }
)

function onPaletteKeydown(event: KeyboardEvent): void {
  const total = enabledItems.value.length
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    open.value = false
    return
  }
  if (total === 0) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % total
    scrollActiveIntoView()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + total) % total
    scrollActiveIntoView()
  } else if (event.key === 'Home') {
    event.preventDefault()
    activeIndex.value = 0
    scrollActiveIntoView()
  } else if (event.key === 'End') {
    event.preventDefault()
    activeIndex.value = total - 1
    scrollActiveIntoView()
  } else if (event.key === 'Enter') {
    const item = activeItem.value
    if (!item || item.disabled) return
    event.preventDefault()
    event.stopPropagation()
    item.onSelect()
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Command palette" :ui="{ content: 'max-w-lg' }">
    <template #content>
      <div data-command-palette class="flex flex-col divide-y divide-default" @keydown="onPaletteKeydown">
        <div class="p-1.5">
          <UInput
            ref="inputRef"
            v-model="searchQuery"
            icon="i-lucide-search"
            variant="none"
            placeholder="Type a command or search sites…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            :aria-controls="listboxId"
            :aria-activedescendant="activeOptionId"
            autofocus
            class="w-full"
          />
        </div>
        <div
          :id="listboxId"
          ref="listRef"
          role="listbox"
          aria-label="Commands"
          class="max-h-80 overflow-y-auto p-1.5"
        >
          <p v-if="filteredGroups.length === 0" class="px-3 py-6 text-center text-xs text-muted">
            No matching commands for "{{ searchQuery.trim() }}"
          </p>
          <div v-for="group in filteredGroups" :key="group.id" role="group" :aria-label="group.label" class="mb-1 last:mb-0">
            <div class="px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-muted">
              {{ group.label }}
            </div>
            <button
              v-for="item in group.items"
              :id="`${listboxId}-${item.id}`"
              :key="item.id"
              type="button"
              role="option"
              tabindex="-1"
              :disabled="item.disabled"
              :aria-selected="activeItem?.id === item.id"
              :data-highlighted="activeItem?.id === item.id ? '' : undefined"
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors"
              :class="[
                item.disabled
                  ? 'cursor-not-allowed opacity-50 text-muted'
                  : activeItem?.id === item.id
                    ? 'bg-primary/15 text-highlighted font-medium'
                    : 'text-default hover:bg-muted/60'
              ]"
              @pointermove="() => { if (!item.disabled) { const idx = enabledIndexOf(item); if (idx !== -1) activeIndex = idx } }"
              @click="() => { if (!item.disabled) item.onSelect() }"
            >
              <UIcon :name="item.icon" class="size-4 shrink-0" :class="activeItem?.id === item.id ? 'text-primary' : 'text-muted'" />
              <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
              <span v-if="item.suffix" class="shrink-0 truncate text-2xs text-muted">{{ item.suffix }}</span>
            </button>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>

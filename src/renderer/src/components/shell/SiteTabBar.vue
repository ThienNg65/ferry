<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import ContextMenu, { type ContextMenuItem } from '@nuxt/ui/components/ContextMenu.vue'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { Site, SiteInput, WindowStateEvent, WindowStateResult } from '@shared/contract'
import { invoke, onEvent } from '../../api'
import { useCommandPalette } from '../../composables/useCommandPalette'
import { useDockState } from '../../composables/useDockState'
import { useGlobalActivity } from '../../composables/useGlobalActivity'
import { useHistoryDialog } from '../../composables/useHistoryDialog'
import { useSettingsDialog } from '../../composables/useSettingsDialog'
import { useNotify } from '../../composables/useNotify'
import { useRemoteFsStore } from '../../stores/remoteFs.store'
import { useSessionsStore, type SessionTab } from '../../stores/sessions.store'
import { useSitesStore } from '../../stores/sites.store'
import { useUiStore } from '../../stores/ui.store'
import { useUpdateStore } from '../../stores/update.store'
import { ENVIRONMENT_LABEL, ENVIRONMENT_TAB_BORDER } from '../../utils/environment'
import { onTablistKeydown } from '../../utils/tablistKeys'

const SiteFormDialog = defineAsyncComponent(() => import('../sessions/SiteFormDialog.vue'))

const sessions = useSessionsStore()
const remoteFs = useRemoteFsStore()
const ui = useUiStore()
const sites = useSitesStore()
const updateStore = useUpdateStore()
const settingsDialog = useSettingsDialog()
const historyDialog = useHistoryDialog()
const commandPalette = useCommandPalette()
const notify = useNotify()
const { isBusy, label: activityLabel } = useGlobalActivity()
const { openDock } = useDockState()

const saveQuickOpen = ref(false)
const saveQuickTabId = ref<string | null>(null)
const saveQuickInitialValues = ref<Partial<SiteInput> | null>(null)

const canSaveActiveQuickConnect = computed(() =>
  Boolean(!sessions.activeTab.siteId && sessions.status === 'connected' && sessions.activeTab.quickConnectInput)
)

function openSaveQuickSite(targetTab: SessionTab = sessions.activeTab): void {
  const qc = targetTab.quickConnectInput
  if (!qc || targetTab.siteId) {
    return
  }
  const remotePath =
    targetTab.tabId === sessions.activeTabId
      ? remoteFs.currentPath
      : targetTab.sessionId
        ? remoteFs.bySession[targetTab.sessionId]?.currentPath
        : undefined
  saveQuickTabId.value = targetTab.tabId
  saveQuickInitialValues.value = {
    ...qc,
    name: `${qc.username}@${qc.host}`,
    remoteInitialPath: remotePath || undefined
  }
  saveQuickOpen.value = true
}

function tabMenuItems(tab: SessionTab): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      label: 'Duplicate Tab',
      icon: 'i-lucide-copy',
      disabled: tab.connecting,
      onSelect: () => void sessions.duplicateTab(tab.tabId).catch(() => undefined)
    }
  ]
  if (tab.status === 'connected') {
    items.push({
      label: 'Disconnect',
      icon: 'i-lucide-unplug',
      onSelect: () => void sessions.disconnectTab(tab.tabId)
    })
  } else if (
    !tab.connecting &&
    (tab.status === 'error' || tab.status === 'disconnected' || tab.siteId !== null)
  ) {
    items.push({
      label: 'Reconnect',
      icon: 'i-lucide-refresh-cw',
      onSelect: () => void sessions.reconnectTab(tab.tabId).catch(() => undefined)
    })
  }
  if (!tab.siteId && tab.quickConnectInput) {
    items.push({
      label: 'Save as Site…',
      icon: 'i-lucide-bookmark-plus',
      onSelect: () => openSaveQuickSite(tab)
    })
  }
  items.push({ type: 'separator' })
  items.push({
    label: 'Close Tab',
    icon: 'i-lucide-x',
    onSelect: () => void sessions.closeTab(tab.tabId)
  })
  items.push({
    label: 'Close Other Tabs',
    icon: 'i-lucide-list-x',
    disabled: sessions.tabs.length <= 1,
    onSelect: () => void sessions.closeOtherTabs(tab.tabId)
  })
  return items
}

function onQuickSiteSaved(site: Site): void {
  if (saveQuickTabId.value) {
    sessions.promoteTabToSite(saveQuickTabId.value, site)
    notify.success('Site saved', site.name)
  }
}

const isFullScreen = ref(false)
let unsubscribeWindowState: (() => void) | null = null

onMounted(async () => {
  unsubscribeWindowState = onEvent<WindowStateEvent>(EVENT_CHANNELS.windowStateChange, (evt) => {
    if (typeof evt.isFullScreen === 'boolean') {
      isFullScreen.value = evt.isFullScreen
    }
  })
  try {
    const state = await invoke<WindowStateResult>(INVOKE_CHANNELS.windowGetState)
    isFullScreen.value = state.isFullScreen
  } catch {
    // Ignore in non-window test environments.
  }
})

onUnmounted(() => {
  unsubscribeWindowState?.()
})

function showActivity(): void {
  if (sessions.status === 'connected') {
    openDock('activity')
  }
}

function exitFullScreen(): void {
  void invoke(INVOKE_CHANNELS.windowFullScreenToggle)
}

function envBorder(siteId: string | null, isActive = false): string {
  const env = siteId ? sites.sites.find((s) => s.id === siteId)?.environment : undefined
  if (env) return ENVIRONMENT_TAB_BORDER[env]
  return isActive ? 'border-primary' : 'border-transparent'
}

function envLabel(siteId: string | null): string | null {
  const env = siteId ? sites.sites.find((s) => s.id === siteId)?.environment : undefined
  return env ? ENVIRONMENT_LABEL[env] : null
}

/** Hide `user@host` when the tab's label already is (or contains) the host, e.g. a site named after its IP. */
function showHost(label: string | null | undefined, hostLabel: string | null | undefined): boolean {
  return Boolean(label && hostLabel && !label.includes(hostLabel.split('@').pop() ?? hostLabel))
}

function onCloseTab(event: MouseEvent, tabId: string): void {
  event.stopPropagation()
  void sessions.closeTab(tabId)
}
</script>

<template>
  <!-- The hairline is an inset shadow (not a border) so the active tab, flush with the bottom edge, paints over it and joins the canvas below. -->
  <header class="relative flex items-end justify-between gap-2 bg-muted px-2 pt-0.5 shadow-[inset_0_-1px_0_var(--ui-border-muted)]">
    <nav class="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto pb-px" aria-label="Open connections">
      <TransitionGroup name="site-tab" tag="div" class="flex min-w-0 items-end gap-1" role="tablist" aria-label="Open sites" @keydown="onTablistKeydown($event, true)">
        <div
          v-for="tab in sessions.tabs"
          :key="tab.tabId"
          class="ferry-site-tab group relative max-w-64 shrink-0 rounded-t-md border-t-2 text-xs transition-colors"
          :class="[
            envBorder(tab.siteId, tab.tabId === sessions.activeTabId),
            tab.tabId === sessions.activeTabId
              ? 'bg-default font-medium text-highlighted'
              : 'text-muted hover:bg-elevated hover:text-default'
          ]"
          :title="tab.hostLabel ? `${tab.label ?? 'Tab'} (${tab.hostLabel})` : (tab.label ?? 'New Tab')"
          @auxclick.middle.prevent="onCloseTab($event, tab.tabId)"
        >
          <ContextMenu :items="tabMenuItems(tab)">
            <div class="flex min-w-0 items-center">
              <button
                type="button"
                role="tab"
                :aria-selected="tab.tabId === sessions.activeTabId"
                :tabindex="tab.tabId === sessions.activeTabId ? 0 : -1"
                class="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-1.5 rounded-tl-md py-1.5 pl-2.5 pr-1 text-left focus-visible:outline-2 focus-visible:outline-primary"
                @click="sessions.setActiveTab(tab.tabId)"
                @keydown.enter.self="sessions.setActiveTab(tab.tabId)"
                @keydown.space.self.prevent="sessions.setActiveTab(tab.tabId)"
              >
                <UIcon v-if="tab.connecting" name="i-lucide-loader-2" class="size-3.5 shrink-0 animate-spin" />
                <UIcon
                  v-else-if="tab.status === 'error'"
                  name="i-lucide-circle-alert"
                  class="size-3.5 shrink-0 text-error"
                />
                <span
                  v-else-if="tab.status === 'connected'"
                  class="size-2 shrink-0 rounded-full bg-success"
                />
                <UIcon
                  v-else-if="tab.siteId"
                  name="i-lucide-server"
                  class="size-3 shrink-0 text-muted"
                />
                <span class="truncate">{{ tab.label ?? tab.hostLabel ?? 'New Tab' }}</span>
                <span
                  v-if="tab.tabId === sessions.activeTabId && showHost(tab.label, tab.hostLabel)"
                  class="min-w-0 truncate font-normal text-muted"
                >
                  {{ tab.hostLabel }}
                </span>
                <span v-if="tab.connecting" class="sr-only">Connecting</span>
                <span v-else-if="tab.status === 'error'" class="sr-only">Connection error</span>
                <span v-else-if="tab.status === 'connected'" class="sr-only">Connected</span>
                <span v-if="envLabel(tab.siteId)" class="sr-only">{{ envLabel(tab.siteId) }}</span>
              </button>
              <UTooltip text="Close tab (Middle-click)">
                <button
                  type="button"
                  :aria-label="`Close ${tab.label ?? tab.hostLabel ?? 'New Tab'}`"
                  :tabindex="tab.tabId === sessions.activeTabId ? 0 : -1"
                  class="mr-0.5 flex size-6 shrink-0 items-center justify-center rounded transition-opacity hover:bg-default focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary"
                  :class="
                    tab.tabId === sessions.activeTabId
                      ? 'opacity-70 hover:opacity-100'
                      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                  "
                  @click="onCloseTab($event, tab.tabId)"
                >
                  <UIcon name="i-lucide-x" class="size-3.5" />
                </button>
              </UTooltip>
            </div>
          </ContextMenu>
        </div>
      </TransitionGroup>
      <UTooltip text="New tab">
        <UButton
          icon="i-lucide-plus"
          class="mb-0.5 shrink-0"
          size="xs"
          variant="ghost"
          color="neutral"
          aria-label="New tab"
          @click="sessions.openNewTab()"
        />
      </UTooltip>
    </nav>

    <div class="flex shrink-0 items-center gap-1 pb-0.5">
      <UTooltip v-if="isBusy" :text="activityLabel">
        <button
          v-if="sessions.status === 'connected'"
          type="button"
          aria-label="Show activity"
          class="flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-accented focus-visible:outline-2 focus-visible:outline-primary"
          @click="showActivity"
        >
          <span class="size-2 rounded-full bg-primary animate-pulse" />
        </button>
        <div
          v-else
          role="status"
          :aria-label="activityLabel"
          class="flex size-6 items-center justify-center rounded-md"
        >
          <span class="size-2 rounded-full bg-primary animate-pulse" />
        </div>
      </UTooltip>
      <UTooltip v-if="updateStore.isDownloaded" :text="`Ferry v${updateStore.availableVersion} is ready — click to restart`">
        <button
          type="button"
          aria-label="Update ready — restart to update"
          class="flex min-h-6 items-center gap-1 rounded bg-success/20 px-2 py-0.5 text-xs font-medium text-success transition-colors hover:bg-success/30 focus-visible:outline-2 focus-visible:outline-primary"
          @click="updateStore.installNow()"
        >
          <UIcon name="i-lucide-arrow-up-circle" class="size-3.5" />
          <span class="hidden md:inline">Update ready</span>
        </button>
      </UTooltip>
      <UTooltip text="Command palette (Ctrl+K)">
        <button
          type="button"
          aria-label="Search commands — open command palette"
          class="flex min-h-6 items-center gap-1.5 rounded-md border border-default/70 bg-default/50 px-2 py-0.5 text-xs text-muted transition-colors hover:border-accented hover:bg-default hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
          @click="commandPalette.open()"
        >
          <UIcon name="i-lucide-search" class="size-3.5" />
          <span class="hidden sm:inline">Search</span>
          <kbd class="rounded bg-muted px-1 py-0.5 font-mono text-2xs text-muted">Ctrl+K</kbd>
        </button>
      </UTooltip>
      <UTooltip :text="ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          :icon="ui.theme === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
          aria-label="Toggle theme"
          @click="ui.toggleTheme()"
        />
      </UTooltip>
      <UTooltip v-if="canSaveActiveQuickConnect" text="Save as site">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-bookmark-plus"
          aria-label="Save as site"
          @click="openSaveQuickSite()"
        />
      </UTooltip>
      <UTooltip text="Transfer History">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-history"
          aria-label="Transfer History"
          @click="historyDialog.open()"
        />
      </UTooltip>
      <UTooltip text="Settings">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-settings"
          aria-label="Settings"
          @click="settingsDialog.open()"
        />
      </UTooltip>
      <UTooltip v-if="isFullScreen" text="Exit full screen (F11)">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-minimize-2"
          aria-label="Exit full screen"
          @click="exitFullScreen"
        />
      </UTooltip>
      <UTooltip v-if="sessions.status === 'connected'" :text="ui.showLocalPane ? 'Hide Local pane' : 'Show Local pane'">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          :icon="ui.showLocalPane ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'"
          :aria-label="ui.showLocalPane ? 'Hide Local pane' : 'Show Local pane'"
          @click="ui.toggleLocalPane()"
        />
      </UTooltip>
    </div>
    <SiteFormDialog
      v-model:open="saveQuickOpen"
      :site="null"
      :initial-values="saveQuickInitialValues"
      @saved="onQuickSiteSaved"
    />
  </header>
</template>

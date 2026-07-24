<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { UpdateAvailableEvent, UpdateDownloadedEvent } from '@shared/contract'
import { invoke, onEvent } from './api'
import { useSessionsStore } from './stores/sessions.store'
import { useOperationsStore } from './stores/operations.store'
import { useEditSessionsStore } from './stores/editSessions.store'
import { useUiStore } from './stores/ui.store'
import { useGlobalActivity } from './composables/useGlobalActivity'
import { useSettingsDialog } from './composables/useSettingsDialog'
import { useHistoryDialog } from './composables/useHistoryDialog'
import { useNotify } from './composables/useNotify'
import TitleBar from './components/shell/TitleBar.vue'
import SiteTabBar from './components/shell/SiteTabBar.vue'

const SessionManagerView = defineAsyncComponent(() => import('./components/sessions/SessionManagerView.vue'))
const SettingsDialog = defineAsyncComponent(() => import('./components/shell/SettingsDialog.vue'))
const HistoryDialog = defineAsyncComponent(() => import('./components/history/HistoryDialog.vue'))
const CommandPalette = defineAsyncComponent(() => import('./components/shell/CommandPalette.vue'))

// Only ever rendered once connected — deferring these keeps their whole
// subtree (FileList/FileRow/FilePreviewDialog/TransferQueue/TerminalView/...)
// off the cold-start bundle-eval path.
const FilePane = defineAsyncComponent(() => import('./components/files/FilePane.vue'))
const BottomDock = defineAsyncComponent(() => import('./components/shell/BottomDock.vue'))

const sessions = useSessionsStore()
const isConnected = computed(() => sessions.status === 'connected')
// Gates the connected subtree's FIRST mount only, so FilePane/BottomDock stay off the
// cold-start bundle-eval path until the user actually connects — v-show (not this flag) handles
// every subsequent disconnect/reconnect, so the subtree (and TerminalView's xterm.js instances)
// is never unmounted again once created. See the template comment for why remounting is unsafe.
const hasConnectedOnce = ref(false)
watch(
  isConnected,
  (connected) => {
    if (connected) {
      hasConnectedOnce.value = true
    }
  },
  { immediate: true }
)
const { isBusy } = useGlobalActivity()
const settingsDialog = useSettingsDialog()
const historyDialog = useHistoryDialog()
const notify = useNotify()

const ui = useUiStore()
ui.initTheme()
ui.initAccentColor()

// Defer non-essential tab restoration and IPC subscriptions until after initial paint frame
if (typeof requestAnimationFrame === 'function') {
  requestAnimationFrame(() => {
    setTimeout(() => {
      void sessions.restoreOpenTabs()
      useOperationsStore().ensureSubscription()
      useEditSessionsStore().ensureSubscription()
    }, 0)
  })
} else {
  setTimeout(() => {
    void sessions.restoreOpenTabs()
    useOperationsStore().ensureSubscription()
    useEditSessionsStore().ensureSubscription()
  }, 0)
}

onMounted(() => {
  const mountTime = performance.now()
  const mountTimeOrigin = performance.timeOrigin
  requestAnimationFrame(() => {
    const firstPaintTime = performance.now()
    const preloadInfo = window.api?.getPreloadTime ? window.api.getPreloadTime() : { start: 0, timeOrigin: mountTimeOrigin }
    const rendererInfo = (window as unknown as { __FERRY_RENDERER_TIME__?: { start: number; timeOrigin: number } }).__FERRY_RENDERER_TIME__ || { start: 0, timeOrigin: mountTimeOrigin }

    void invoke(INVOKE_CHANNELS.profileReport, {
      preloadStart: preloadInfo.start,
      preloadTimeOrigin: preloadInfo.timeOrigin,
      rendererStart: rendererInfo.start,
      rendererTimeOrigin: rendererInfo.timeOrigin,
      rendererMount: mountTime,
      firstPaint: firstPaintTime,
      rendererMountTimeOrigin: mountTimeOrigin
    })
  })
})

// Only ever fires in a packaged build — see AutoUpdater.ts's app.isPackaged guard.
const toast = useToast()
onEvent<UpdateAvailableEvent>(EVENT_CHANNELS.updateAvailable, (evt) => {
  notify.success('Update available', `Ferry v${evt.version} is downloading in the background`)
})
onEvent<UpdateDownloadedEvent>(EVENT_CHANNELS.updateDownloaded, (evt) => {
  toast.add({
    title: 'Update ready',
    description: `Restart Ferry to install v${evt.version}`,
    color: 'success',
    icon: 'i-lucide-check-circle',
    actions: [{ label: 'Restart now', onClick: () => void invoke<void>(INVOKE_CHANNELS.updateInstallNow) }]
  })
})
</script>

<template>
  <UApp :toaster="{ position: 'bottom-right', duration: 4000 }">
    <div class="flex h-screen flex-col bg-default text-default">
      <TitleBar />
      <SiteTabBar />
      <div class="relative min-h-0 flex-1">
        <!--
          The connected view is hoisted out of the Transition/v-if instead of toggling with
          v-if/v-else — BottomDock renders TerminalView, which owns long-lived xterm.js
          `Terminal` instances (see terminalStreams.store.ts); unmounting and remounting it on
          every disconnect/reconnect cycle would call `term.open()` a second time on the same
          instance, which xterm.js does not support (see PROJECT_MAP.md Gotcha #9). v-show only
          toggles CSS display, so the subtree — and its terminal containers — never unmounts.
        -->
        <Transition name="fade" mode="out-in">
          <SessionManagerView v-if="!isConnected" key="picker" />
        </Transition>
        <div v-if="hasConnectedOnce" v-show="isConnected" class="flex h-full flex-col">
          <div class="flex min-h-0 flex-1">
            <FilePane side="local" />
            <FilePane side="remote" />
          </div>
          <BottomDock />
        </div>
      </div>
    </div>
    <SettingsDialog v-model:open="settingsDialog.isOpen.value" />
    <HistoryDialog v-model:open="historyDialog.isOpen.value" />
    <CommandPalette />
  </UApp>
</template>

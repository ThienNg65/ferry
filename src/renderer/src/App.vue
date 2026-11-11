<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { UpdateAvailableEvent, UpdateDownloadedEvent } from '@shared/contract'
import { invoke, onEvent } from './api'
import { useSessionsStore } from './stores/sessions.store'
import { useOperationsStore } from './stores/operations.store'
import { useEditSessionsStore } from './stores/editSessions.store'
import { DEFAULT_LOCAL_PANE_WIDTH, useUiStore } from './stores/ui.store'
import { clampLocalPaneWidth } from './utils/paneColumns'
import { useGlobalActivity } from './composables/useGlobalActivity'
import { useSettingsDialog } from './composables/useSettingsDialog'
import { useHistoryDialog } from './composables/useHistoryDialog'
import { useNotify } from './composables/useNotify'
import { useUpdateStore } from './stores/update.store'
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
const updateStore = useUpdateStore()
const ui = useUiStore()
const isConnected = computed(() => sessions.status === 'connected')
const isResizingPane = ref(false)
const viewportWidth = ref(window.innerWidth)
const effectiveLocalWidth = computed(() => clampLocalPaneWidth(ui.localPaneWidth, viewportWidth.value))
const onWindowResize = (): void => {
  viewportWidth.value = window.innerWidth
}
window.addEventListener('resize', onWindowResize)
onUnmounted(() => window.removeEventListener('resize', onWindowResize))
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

function onPaneResizerMouseDown() {
  isResizingPane.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onPaneResizerMouseMove)
  window.addEventListener('mouseup', onPaneResizerMouseUp)
}

function onPaneResizerMouseMove(e: MouseEvent) {
  if (!isResizingPane.value) return
  ui.setLocalPaneWidth(clampLocalPaneWidth((e.clientX / window.innerWidth) * 100, window.innerWidth))
}

function onPaneResizerKeyDown(e: KeyboardEvent): void {
  const step = e.key === 'ArrowLeft' ? -2 : e.key === 'ArrowRight' ? 2 : 0
  if (!step) return
  e.preventDefault()
  ui.setLocalPaneWidth(clampLocalPaneWidth(effectiveLocalWidth.value + step, window.innerWidth))
  ui.saveLocalPaneWidth()
}

function resetPaneWidth(): void {
  ui.setLocalPaneWidth(DEFAULT_LOCAL_PANE_WIDTH)
  ui.saveLocalPaneWidth()
}

function onPaneResizerMouseUp() {
  isResizingPane.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onPaneResizerMouseMove)
  window.removeEventListener('mouseup', onPaneResizerMouseUp)
  ui.saveLocalPaneWidth()
}

onMounted(() => {
  void updateStore.init()
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
          <div class="flex min-h-0 flex-1 relative">
            <FilePane 
              side="local" 
              :style="ui.showLocalPane ? { width: `${effectiveLocalWidth}%` } : undefined"
              :class="isResizingPane ? '!transition-none' : ''"
            />
            
            <div 
              v-if="ui.showLocalPane"
              class="relative w-0 z-50 shrink-0"
            >
              <div 
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panes"
                tabindex="0"
                :aria-valuenow="Math.round(effectiveLocalWidth)"
                aria-valuemin="0"
                aria-valuemax="100"
                class="absolute top-0 bottom-0 -ml-1 w-2 cursor-col-resize outline-none transition-colors hover:bg-primary/50 focus-visible:bg-primary"
                :class="isResizingPane ? 'bg-primary' : ''"
                @mousedown.prevent="onPaneResizerMouseDown"
                @keydown="onPaneResizerKeyDown"
                @dblclick="resetPaneWidth"
              />
            </div>
            
            <FilePane 
              side="remote"
              class="flex-1"
            />
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

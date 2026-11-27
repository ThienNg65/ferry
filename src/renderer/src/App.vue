<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { en } from '@nuxt/ui/locale'
import { extendLocale } from '@nuxt/ui/composables'
import { EVENT_CHANNELS, INVOKE_CHANNELS, LEGAL_POLICY_VERSION } from '@shared/contract'
import type { UpdateAvailableEvent, UpdateDownloadedEvent } from '@shared/contract'
import { invoke, onEvent } from './api'
import { useSessionsStore } from './stores/sessions.store'
import { useOperationsStore } from './stores/operations.store'
import { useTransferQueueStore } from './stores/transferQueue.store'
import { useEditSessionsStore } from './stores/editSessions.store'
import { useSettingsStore } from './stores/settings.store'
import { useTerminalStreamsStore } from './stores/terminalStreams.store'
import { DEFAULT_LOCAL_PANE_WIDTH, useUiStore } from './stores/ui.store'
import { clampLocalPaneWidth } from './utils/paneColumns'
import { initWindowBoundsPersistence } from './utils/windowBounds'
import { useGlobalActivity } from './composables/useGlobalActivity'
import { useSettingsDialog } from './composables/useSettingsDialog'
import { useHistoryDialog } from './composables/useHistoryDialog'
import { useShortcutsDialog } from './composables/useShortcutsDialog'
import { useDockState } from './composables/useDockState'
import ShortcutsDialog from './components/shell/ShortcutsDialog.vue'
import { useNotify } from './composables/useNotify'
import { useUpdateStore } from './stores/update.store'
import { useCompanionStore } from './stores/companion.store'
import SiteTabBar from './components/shell/SiteTabBar.vue'
import ConnectionModals from './components/sessions/ConnectionModals.vue'

const SessionManagerView = defineAsyncComponent(() => import('./components/sessions/SessionManagerView.vue'))
const SettingsDialog = defineAsyncComponent(() => import('./components/shell/SettingsDialog.vue'))
const HistoryDialog = defineAsyncComponent(() => import('./components/history/HistoryDialog.vue'))
const CommandPalette = defineAsyncComponent(() => import('./components/shell/CommandPalette.vue'))
const LegalConsentDialog = defineAsyncComponent(() => import('./components/shell/LegalConsentDialog.vue'))
const CompanionPanel = defineAsyncComponent(() => import('./components/companion/CompanionPanel.vue'))

// Only ever rendered once connected — deferring these keeps their whole
// subtree (FileList/FileRow/FilePreviewDialog/TransferQueue/TerminalView/...)
// off the cold-start bundle-eval path.
const FilePane = defineAsyncComponent(() => import('./components/files/FilePane.vue'))
const BottomDock = defineAsyncComponent(() => import('./components/shell/BottomDock.vue'))

const sessions = useSessionsStore()
const settingsStore = useSettingsStore()
const updateStore = useUpdateStore()
const companion = useCompanionStore()
const transferQueue = useTransferQueueStore()
const ui = useUiStore()
const needsLegalConsent = computed(
  () =>
    settingsStore.loaded &&
    (!settingsStore.termsAcceptance || settingsStore.termsAcceptance.version !== LEGAL_POLICY_VERSION)
)
const isConnected = computed(() => sessions.status === 'connected')
const isConnecting = computed(() => sessions.connecting && sessions.status === 'connecting')
const connectionPhase = computed(() => {
  if (sessions.pendingHostKeyPrompt) return 'Waiting for host-key confirmation…'
  if (sessions.pendingKeyboardPrompt) return 'Waiting for authentication…'
  const messages = sessions.activeTab.progressMessages
  return messages[messages.length - 1] ?? 'Opening SSH connection…'
})
const isResizingPane = ref(false)
const viewportWidth = ref(window.innerWidth)
const effectiveLocalWidth = computed(() => clampLocalPaneWidth(ui.localPaneWidth, viewportWidth.value))
const onWindowResize = (): void => {
  viewportWidth.value = window.innerWidth
}
window.addEventListener('resize', onWindowResize)
let disposeWindowBounds: (() => void) | null = null
onUnmounted(() => {
  disposeWindowBounds?.()
  companion.disposeTimers()
  unsubscribeUpdateAvailable()
  unsubscribeUpdateDownloaded()
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('keydown', onCloseTabShortcut, true)
  window.removeEventListener('keydown', onTabShortcut)
  window.removeEventListener('mousemove', onPaneResizerMouseMove)
  window.removeEventListener('mouseup', onPaneResizerMouseUp)
})
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
const { collapsed: dockCollapsed, tab: dockTab, isMaximized: dockMaximized, openDock } = useDockState()
const isDockFullHeight = computed(() => !dockCollapsed.value && dockMaximized.value)
const toasterViewportClass = computed(() => 'top-12')
const settingsDialog = useSettingsDialog()
const historyDialog = useHistoryDialog()
const shortcutsDialog = useShortcutsDialog()
const notify = useNotify()

ui.initGlassUi()
ui.initAccentColor()
const initialThemeSync = ui.initTheme()

// Defer non-essential tab restoration and IPC subscriptions until after initial paint frame
if (typeof requestAnimationFrame === 'function') {
  requestAnimationFrame(() => {
    setTimeout(() => {
      void sessions.restoreOpenTabs()
      useOperationsStore().ensureSubscription()
      useTransferQueueStore().ensureSubscription()
      useEditSessionsStore().ensureSubscription()
    }, 0)
  })
} else {
  setTimeout(() => {
    void sessions.restoreOpenTabs()
    useOperationsStore().ensureSubscription()
    useTransferQueueStore().ensureSubscription()
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

/** Intercept only tab close in capture phase; leave other shortcuts' bubbling behavior unchanged. */
function onCloseTabShortcut(event: KeyboardEvent): void {
  if (
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    event.shiftKey ||
    event.key.toLowerCase() !== 'w'
  ) {
    return
  }
  // Ctrl+W deletes a word in the embedded SSH terminal; do not steal it.
  if (event.target instanceof HTMLElement && event.target.closest('.xterm')) {
    return
  }
  // Block the browser/WebView close even when a modal is open or the key repeats.
  event.preventDefault()
  if (event.repeat || document.querySelector('[role="dialog"]')) {
    return
  }
  void sessions.closeTab(sessions.activeTabId)
}

function onTabShortcut(event: KeyboardEvent): void {
  if (event.key === 'F11' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    event.preventDefault()
    void invoke<void>(INVOKE_CHANNELS.windowFullScreenToggle)
    return
  }
  if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const target = event.target
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && (target.isContentEditable || target.closest('.xterm') !== null))
    if (!typing) {
      event.preventDefault()
      shortcutsDialog.open()
    }
    return
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey) {
    return
  }
  if (event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'Space') {
    const target = event.target
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && (target.isContentEditable || target.closest('.xterm') !== null))
    const inCompanion =
      companion.open && target instanceof HTMLElement && target.closest('[data-companion-panel]') !== null
    if ((typing && !inCompanion) || document.querySelector('[role="dialog"]:not([data-state="closed"])')) {
      return
    }
    event.preventDefault()
    companion.togglePanel()
    return
  }
  if (!event.shiftKey && event.code === 'Backquote') {
    if (!isConnected.value || document.querySelector('[role="dialog"]')) {
      return
    }
    event.preventDefault()
    if (!dockCollapsed.value && dockTab.value === 'terminal') {
      dockCollapsed.value = true
      const pane = ui.activePane === 'local' && ui.showLocalPane ? 'local' : 'remote'
      document.querySelector<HTMLElement>(`[data-pane="${pane}"]`)?.focus()
    } else {
      openDock('terminal')
      void nextTick(() => {
        if (sessions.activeSessionId) {
          useTerminalStreamsStore().focus(sessions.activeSessionId)
        }
      })
    }
    return
  }
  if (event.key === 'Tab') {
    const tabs = sessions.tabs
    const index = tabs.findIndex((t) => t.tabId === sessions.activeTabId)
    if (index === -1 || tabs.length < 2) {
      return
    }
    event.preventDefault()
    const step = event.shiftKey ? -1 : 1
    sessions.setActiveTab(tabs[(index + step + tabs.length) % tabs.length].tabId)
  }
}

onMounted(() => {
  const settingsReady = settingsStore.fetch().catch(() => {})
  disposeWindowBounds = initWindowBoundsPersistence({
    beforeShow: Promise.all([initialThemeSync, settingsReady])
      .then(() => ui.initTheme())
      .catch(() => {})
  })
  window.addEventListener('keydown', onCloseTabShortcut, true)
  window.addEventListener('keydown', onTabShortcut)
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
const appLocale = extendLocale(en, {
  messages: {
    modal: {
      close: 'Close dialog'
    }
  }
})
const unsubscribeUpdateAvailable = onEvent<UpdateAvailableEvent>(EVENT_CHANNELS.updateAvailable, (evt) => {
  notify.success('Update available', `Ferry v${evt.version} is downloading in the background`)
})
const unsubscribeUpdateDownloaded = onEvent<UpdateDownloadedEvent>(EVENT_CHANNELS.updateDownloaded, (evt) => {
  const { id } = toast.add({
    title: 'Update ready',
    description: `Restart Ferry to install v${evt.version}`,
    color: 'success',
    icon: 'i-lucide-check-circle',
    duration: 0,
    actions: [
      {
        label: 'Restart now',
        onClick: () => {
          toast.remove(id)
          void updateStore.installNow()
        }
      }
    ]
  })
})

let promoToastShown = false
let promoToastId: string | number | null = null

watch(
  () => ui.glassUiEnabled,
  (enabled) => {
    if (enabled && promoToastId !== null) {
      toast.remove(promoToastId)
      promoToastId = null
    }
  }
)

watch(
  [() => settingsStore.loaded, needsLegalConsent],
  ([loaded, consentNeeded]) => {
    if (!loaded || consentNeeded || promoToastShown) return
    if (ui.glassUiEnabled || ui.glassUiPromoDismissed) return
    promoToastShown = true

    const { id } = toast.add({
      title: 'Modern Glass UI (In Development)',
      description: 'Try Ferry’s new minimalist translucent design in Settings → Appearance.',
      icon: 'i-lucide-sparkles',
      color: 'primary',
      duration: 0,
      'onUpdate:open': (open: boolean) => {
        if (!open) {
          promoToastId = null
          ui.dismissGlassUiPromo()
        }
      },
      actions: [
        {
          label: 'Try Glass UI',
          color: 'primary',
          variant: 'solid',
          onClick: () => {
            ui.setGlassUiEnabled(true)
            ui.dismissGlassUiPromo()
            toast.remove(id)
            promoToastId = null
            notify.success(
              'Modern Glass UI enabled',
              'You can switch back anytime in Settings → Appearance.'
            )
          }
        },
        {
          label: 'Dismiss',
          color: 'neutral',
          variant: 'ghost',
          onClick: () => {
            ui.dismissGlassUiPromo()
            toast.remove(id)
            promoToastId = null
          }
        }
      ]
    })
    promoToastId = id
  },
  { immediate: true }
)

// Initialize Ferry Companion lifecycle after legal consent and settings hydration
// (decoupled from Glass UI promo toast so currentVersion populates immediately on boot).
watch(
  [() => settingsStore.loaded, needsLegalConsent],
  ([loaded, consentNeeded]) => {
    if (!loaded || consentNeeded || companion.lifecycleInitialized) return
    const resolveAndInit = async (): Promise<void> => {
      let version = updateStore.currentVersion
      if (!version) {
        try {
          const res = await invoke<string | { version?: string }>(INVOKE_CHANNELS.systemGetAppVersion)
          version = typeof res === 'string' ? res : (res?.version ?? '')
        } catch {
          version = ''
        }
      }
      if (version) {
        companion.initLifecycle(version)
      }
    }
    setTimeout(() => {
      void resolveAndInit()
    }, 0)
  },
  { immediate: true }
)

// Offer optional, rate-limited troubleshooting help when a transfer transitions into error.
const transferStateById = new Map<string, string>()
watch(
  () => transferQueue.list.map((i) => `${i.transferId}\0${i.state}\0${i.error ?? ''}`),
  () => {
    const activeIds = new Set<string>()
    for (const item of transferQueue.list) {
      activeIds.add(item.transferId)
      const prevState = transferStateById.get(item.transferId)
      transferStateById.set(item.transferId, item.state)
      if (item.state === 'error' && prevState !== 'error' && item.error) {
        companion.notifyTransferFailure({
          sessionId: item.sessionId,
          direction: item.kind,
          localPath: item.localPath,
          remotePath: item.remotePath,
          error: item.error
        })
      }
    }
    for (const id of transferStateById.keys()) {
      if (!activeIds.has(id)) transferStateById.delete(id)
    }
  }
)
</script>

<template>
  <UApp
    :locale="appLocale"
    :tooltip="{ delayDuration: 250, skipDelayDuration: 300, ignoreNonKeyboardFocus: true }"
    :toaster="{
      position: 'top-center',
      duration: 3500,
      max: 3,
      expand: false,
      ui: { viewport: toasterViewportClass }
    }"
  >
    <div v-if="ui.glassUiEnabled" class="ferry-ambient-canvas" aria-hidden="true" />
    <div
      class="relative z-10 flex h-screen flex-col text-default"
      :class="ui.glassUiEnabled ? 'bg-transparent' : 'bg-default'"
    >
      <SiteTabBar />
      <main class="relative min-h-0 flex-1">
        <!--
          The connected view is hoisted out of the Transition/v-if instead of toggling with
          v-if/v-else — BottomDock renders TerminalView, which owns long-lived xterm.js
          `Terminal` instances (see terminalStreams.store.ts); unmounting and remounting it on
          every disconnect/reconnect cycle would call `term.open()` a second time on the same
          instance, which xterm.js does not support (see PROJECT_MAP.md Gotcha #9). v-show only
          toggles CSS display, so the subtree — and its terminal containers — never unmounts.
        -->
        <section
          v-if="isConnecting"
          aria-label="Connection progress"
          class="absolute inset-0 z-10 flex items-center justify-center p-6"
        >
          <div
            class="w-full max-w-sm rounded-lg border border-default bg-default p-4 shadow-sm"
            :class="ui.glassUiEnabled ? 'ferry-glass-well' : ''"
          >
            <div role="status" aria-live="polite" aria-atomic="true" class="flex items-start gap-3">
              <UIcon name="i-lucide-loader-circle" aria-hidden="true" class="mt-0.5 size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
              <div class="min-w-0">
                <p class="break-words text-sm font-medium">Connecting to {{ sessions.activeTab.label || sessions.activeTab.hostLabel || 'server' }}</p>
                <p class="mt-1 text-xs text-muted">{{ connectionPhase }}</p>
              </div>
            </div>
            <UButton size="sm" color="neutral" variant="outline" class="mt-4" @click="sessions.cancelConnect(sessions.activeTabId)">
              Cancel
            </UButton>
          </div>
        </section>
        <Transition name="fade">
          <SessionManagerView v-if="!isConnected && !isConnecting" key="picker" class="absolute inset-0 z-10" />
        </Transition>
        <div
          v-if="hasConnectedOnce"
          v-show="isConnected"
          class="flex h-full"
          :class="ui.dockPosition === 'right' ? 'flex-row' : 'flex-col'"
        >
          <!-- Not v-show: the dock animates to full height/width and squeezes this area, so it must stay laid out. -->
          <div :inert="isDockFullHeight" class="flex min-h-0 min-w-0 flex-1 relative">
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
                class="absolute top-0 bottom-0 -ml-1 w-2 touch-none select-none cursor-col-resize outline-none transition-colors hover:bg-primary/50 focus-visible:bg-primary"
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
      </main>
    </div>
    <SettingsDialog v-model:open="settingsDialog.isOpen.value" />
    <HistoryDialog v-model:open="historyDialog.isOpen.value" />
    <ShortcutsDialog v-model:open="shortcutsDialog.isOpen.value" />
    <LegalConsentDialog :open="needsLegalConsent" />
    <CommandPalette />
    <ConnectionModals />
    <CompanionPanel v-if="companion.hasOpenedOnce" />
  </UApp>
</template>

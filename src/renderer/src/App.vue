<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
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
import SessionManagerView from './components/sessions/SessionManagerView.vue'
import SettingsDialog from './components/shell/SettingsDialog.vue'
import HistoryDialog from './components/history/HistoryDialog.vue'
import CommandPalette from './components/shell/CommandPalette.vue'

// Only ever rendered once connected — deferring these keeps their whole
// subtree (FileList/FileRow/FilePreviewDialog/TransferQueue/TerminalView/...)
// off the cold-start bundle-eval path.
const FilePane = defineAsyncComponent(() => import('./components/files/FilePane.vue'))
const BottomDock = defineAsyncComponent(() => import('./components/shell/BottomDock.vue'))

const sessions = useSessionsStore()
const isConnected = computed(() => sessions.status === 'connected')
const { isBusy } = useGlobalActivity()
const settingsDialog = useSettingsDialog()
const historyDialog = useHistoryDialog()
const notify = useNotify()

const ui = useUiStore()
ui.initTheme()
ui.initAccentColor()
void sessions.restoreOpenTabs()
// Operation events originate main-side from any invoke — subscribe up front
// so the Activity dock badge never misses the first event.
useOperationsStore().ensureSubscription()
useEditSessionsStore().ensureSubscription()

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
        <Transition name="fade" mode="out-in">
          <SessionManagerView v-if="!isConnected" key="picker" />
          <div v-else key="connected" class="flex h-full flex-col">
            <div class="flex min-h-0 flex-1">
              <FilePane side="local" />
              <FilePane side="remote" />
            </div>
            <BottomDock />
          </div>
        </Transition>
      </div>
    </div>
    <SettingsDialog v-model:open="settingsDialog.isOpen.value" />
    <HistoryDialog v-model:open="historyDialog.isOpen.value" />
    <CommandPalette />
  </UApp>
</template>

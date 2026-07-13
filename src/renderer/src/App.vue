<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { useSessionsStore } from './stores/sessions.store'
import { useGlobalActivity } from './composables/useGlobalActivity'
import TitleBar from './components/shell/TitleBar.vue'
import SiteTabBar from './components/shell/SiteTabBar.vue'
import SessionManagerView from './components/sessions/SessionManagerView.vue'

// Only ever rendered once connected — deferring these keeps their whole
// subtree (FileList/FileRow/FilePreviewDialog/TransferQueue/TerminalView/...)
// off the cold-start bundle-eval path.
const FilePane = defineAsyncComponent(() => import('./components/files/FilePane.vue'))
const BottomDock = defineAsyncComponent(() => import('./components/shell/BottomDock.vue'))

const sessions = useSessionsStore()
const isConnected = computed(() => sessions.status === 'connected')
const { isBusy } = useGlobalActivity()
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
  </UApp>
</template>

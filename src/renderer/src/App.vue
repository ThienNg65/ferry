<script setup lang="ts">
import { computed } from 'vue'
import { useSessionsStore } from './stores/sessions.store'
import TitleBar from './components/shell/TitleBar.vue'
import SiteTabBar from './components/shell/SiteTabBar.vue'
import SessionManagerView from './components/sessions/SessionManagerView.vue'
import FilePane from './components/files/FilePane.vue'
import BottomDock from './components/shell/BottomDock.vue'

const sessions = useSessionsStore()
const isConnected = computed(() => sessions.status === 'connected')
</script>

<template>
  <UApp :toaster="{ position: 'bottom-right', duration: 4000 }">
    <div class="flex h-screen flex-col bg-default text-default">
      <TitleBar />
      <SiteTabBar />
      <div class="min-h-0 flex-1">
        <SessionManagerView v-if="!isConnected" />
        <div v-else class="flex h-full flex-col">
          <div class="flex min-h-0 flex-1">
            <FilePane side="local" />
            <FilePane side="remote" />
          </div>
          <BottomDock />
        </div>
      </div>
    </div>
  </UApp>
</template>

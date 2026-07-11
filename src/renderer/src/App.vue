<script setup lang="ts">
import { computed } from 'vue'
import { useSessionsStore } from './stores/sessions.store'
import TitleBar from './components/shell/TitleBar.vue'
import SessionManagerView from './components/sessions/SessionManagerView.vue'
import FilePane from './components/files/FilePane.vue'
import BottomDock from './components/shell/BottomDock.vue'

const sessions = useSessionsStore()
const isConnected = computed(() => sessions.status === 'connected')
</script>

<template>
  <UApp>
    <div class="flex h-screen flex-col bg-default text-default">
      <TitleBar />
      <div class="min-h-0 flex-1">
        <SessionManagerView v-if="!isConnected" />
        <div v-else class="flex h-full flex-col">
          <div class="flex items-center justify-between border-b border-muted px-3 py-1.5">
            <span class="text-xs text-muted">Session {{ sessions.activeSessionId }}</span>
            <UButton color="neutral" variant="outline" size="xs" @click="sessions.disconnect()">
              Disconnect
            </UButton>
          </div>
          <div class="flex min-h-0 flex-1">
            <FilePane side="local" class="min-w-0 flex-1" />
            <FilePane side="remote" class="min-w-0 flex-1" />
          </div>
          <BottomDock />
        </div>
      </div>
    </div>
  </UApp>
</template>

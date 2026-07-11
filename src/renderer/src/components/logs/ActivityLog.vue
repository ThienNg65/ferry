<script setup lang="ts">
import { onMounted } from 'vue'
import { useActivityLogStore } from '../../stores/activityLog.store'

const store = useActivityLogStore()

onMounted(() => {
  void store.loadHistory()
})

function levelClass(level: string): string {
  switch (level) {
    case 'error':
      return 'text-error'
    case 'warn':
      return 'text-warning'
    default:
      return 'text-toned'
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false })
}
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto px-1 py-1 font-mono text-[11px]">
    <div v-for="entry in store.entries" :key="entry.id" class="flex gap-2 rounded px-2 py-0.5 hover:bg-muted">
      <span class="shrink-0 text-dimmed">{{ formatTime(entry.at) }}</span>
      <span class="flex-1 truncate" :class="levelClass(entry.level)">{{ entry.message }}</span>
    </div>
    <p v-if="store.entries.length === 0" class="px-3 py-6 text-center text-xs text-muted">No activity yet</p>
  </div>
</template>

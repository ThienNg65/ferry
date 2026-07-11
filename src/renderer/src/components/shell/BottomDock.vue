<script setup lang="ts">
import { ref } from 'vue'
import { useTailStreamsStore } from '../../stores/tailStreams.store'
import TransferQueue from '../transfers/TransferQueue.vue'
import LogTailViewer from '../logs/LogTailViewer.vue'
import ActivityLog from '../logs/ActivityLog.vue'

type DockTab = 'transfers' | 'tail' | 'activity'

const tailStreams = useTailStreamsStore()

const collapsed = ref(false)
const tab = ref<DockTab>('transfers')

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}
</script>

<template>
  <div class="flex shrink-0 flex-col border-t border-muted" :class="collapsed ? '' : 'h-56'">
    <div class="flex items-center justify-between px-2 py-1">
      <div class="flex items-center gap-1">
        <UButton
          label="Transfers"
          size="xs"
          :color="tab === 'transfers' ? 'primary' : 'neutral'"
          :variant="tab === 'transfers' ? 'soft' : 'ghost'"
          @click="tab = 'transfers'"
        />
        <UButton
          label="Log Tail"
          size="xs"
          :color="tab === 'tail' ? 'primary' : 'neutral'"
          :variant="tab === 'tail' ? 'soft' : 'ghost'"
          @click="tab = 'tail'"
        />
        <UButton
          label="Activity"
          size="xs"
          :color="tab === 'activity' ? 'primary' : 'neutral'"
          :variant="tab === 'activity' ? 'soft' : 'ghost'"
          @click="tab = 'activity'"
        />
      </div>
      <UButton
        :icon="collapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="collapsed = !collapsed"
      />
    </div>
    <div v-if="!collapsed" class="flex min-h-0 flex-1 flex-col border-t border-muted">
      <TransferQueue v-if="tab === 'transfers'" />
      <template v-else-if="tab === 'tail'">
        <div v-if="tailStreams.tabs.length > 0" class="flex items-center gap-1 border-b border-muted px-2 py-1">
          <div
            v-for="openTail in tailStreams.tabs"
            :key="openTail.tailId"
            class="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs"
            :class="
              tailStreams.activeTailId === openTail.tailId ? 'bg-accented text-highlighted' : 'text-muted hover:bg-muted'
            "
          >
            <button class="truncate" @click="tailStreams.activeTailId = openTail.tailId">
              {{ basename(openTail.remotePath) }}
            </button>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="tailStreams.close(openTail.tailId)"
            />
          </div>
        </div>
        <div class="min-h-0 flex-1">
          <LogTailViewer
            v-if="tailStreams.activeTailId"
            :key="tailStreams.activeTailId"
            :tail-id="tailStreams.activeTailId"
          />
          <p v-else class="px-3 py-6 text-center text-xs text-muted">
            Click the tail icon on a remote file to follow it live
          </p>
        </div>
      </template>
      <ActivityLog v-else-if="tab === 'activity'" />
    </div>
  </div>
</template>

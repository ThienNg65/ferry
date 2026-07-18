<script setup lang="ts">
import { computed } from 'vue'
// Not yet in the auto-generated global components.d.ts — deep-import instead
// (same pattern as ContextMenu in FileRow.vue).
import UChip from '@nuxt/ui/components/Chip.vue'
import { useTailStreamsStore } from '../../stores/tailStreams.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useTransferQueueStore } from '../../stores/transferQueue.store'
import { useOperationsStore } from '../../stores/operations.store'
import { useDockState } from '../../composables/useDockState'
import TransferQueue from '../transfers/TransferQueue.vue'
import LogTailViewer from '../logs/LogTailViewer.vue'
import TerminalView from '../terminal/TerminalView.vue'
import ActivityPanel from '../activity/ActivityPanel.vue'

const tailStreams = useTailStreamsStore()
const sessions = useSessionsStore()
const transfers = useTransferQueueStore()
const operations = useOperationsStore()

// Dock open/tab state is shared via useDockState so other components (e.g.
// the TitleBar busy indicator) can open the dock on a specific tab.
const { collapsed, tab, terminalEverShown, openDock } = useDockState()
const terminalActive = computed(() => !collapsed.value && tab.value === 'terminal')

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}
</script>

<template>
  <div
    class="flex shrink-0 flex-col overflow-hidden border-t border-muted transition-[height] duration-200 ease-in-out"
    :class="collapsed ? 'h-9' : 'h-56'"
  >
    <div class="flex items-center justify-between px-2 py-1">
      <div class="flex items-center gap-1">
        <UChip :text="transfers.activeCount" :show="transfers.activeCount > 0" size="lg" color="primary">
          <UButton
            label="Transfers"
            size="xs"
            :color="tab === 'transfers' ? 'primary' : 'neutral'"
            :variant="tab === 'transfers' ? 'soft' : 'ghost'"
            @click="openDock('transfers')"
          />
        </UChip>
        <UChip :text="operations.runningCount" :show="operations.runningCount > 0" size="lg" color="primary">
          <UButton
            label="Activity"
            size="xs"
            :color="tab === 'activity' ? 'primary' : 'neutral'"
            :variant="tab === 'activity' ? 'soft' : 'ghost'"
            @click="openDock('activity')"
          />
        </UChip>
        <UButton
          label="Log Tail"
          size="xs"
          :color="tab === 'tail' ? 'primary' : 'neutral'"
          :variant="tab === 'tail' ? 'soft' : 'ghost'"
          @click="openDock('tail')"
        />
        <UButton
          label="Terminal"
          size="xs"
          :color="tab === 'terminal' ? 'primary' : 'neutral'"
          :variant="tab === 'terminal' ? 'soft' : 'ghost'"
          :disabled="sessions.status !== 'connected'"
          @click="openDock('terminal')"
        />
      </div>
      <UTooltip :text="collapsed ? 'Expand dock' : 'Collapse dock'">
        <UButton
          :icon="collapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="collapsed = !collapsed"
        />
      </UTooltip>
    </div>
    <div v-if="!collapsed && tab !== 'terminal'" class="flex min-h-0 flex-1 flex-col border-t border-muted">
      <TransferQueue v-if="tab === 'transfers'" />
      <ActivityPanel v-else-if="tab === 'activity'" />
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
            <UTooltip text="Close tail">
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="tailStreams.close(openTail.tailId)"
              />
            </UTooltip>
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
    </div>
    <div v-show="terminalActive" class="flex min-h-0 flex-1 flex-col border-t border-muted">
      <TerminalView v-if="terminalEverShown" :active="terminalActive" />
    </div>
  </div>
</template>

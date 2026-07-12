<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTailStreamsStore } from '../../stores/tailStreams.store'
import { useSessionsStore } from '../../stores/sessions.store'
import TransferQueue from '../transfers/TransferQueue.vue'
import LogTailViewer from '../logs/LogTailViewer.vue'
import TerminalView from '../terminal/TerminalView.vue'

type DockTab = 'transfers' | 'tail' | 'terminal'

const tailStreams = useTailStreamsStore()
const sessions = useSessionsStore()

const collapsed = ref(false)
const tab = ref<DockTab>('transfers')
/** Once true, TerminalView stays mounted forever (see its own v-show sibling below) so its xterm instances and scrollback never get torn down by dock-tab switching. */
const terminalEverShown = ref(false)
const terminalActive = computed(() => !collapsed.value && tab.value === 'terminal')

function openTerminalTab(): void {
  tab.value = 'terminal'
  terminalEverShown.value = true
}

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
          label="Terminal"
          size="xs"
          :color="tab === 'terminal' ? 'primary' : 'neutral'"
          :variant="tab === 'terminal' ? 'soft' : 'ghost'"
          :disabled="sessions.status !== 'connected'"
          @click="openTerminalTab"
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

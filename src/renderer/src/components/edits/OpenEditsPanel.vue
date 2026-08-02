<script setup lang="ts">
import { computed } from 'vue'
import { useEditSessionsStore } from '../../stores/editSessions.store'
import { useSessionsStore } from '../../stores/sessions.store'

const editSessions = useEditSessionsStore()
const sessions = useSessionsStore()

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function sessionLabel(sessionId: string): string {
  const tab = sessions.tabs.find((t) => t.sessionId === sessionId)
  return tab?.label ?? tab?.hostLabel ?? sessionId
}

const edits = computed(() => editSessions.edits)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="edits.length > 0" class="flex flex-wrap items-center gap-1 px-2 py-1.5">
      <div
        v-for="edit in edits"
        :key="edit.editId"
        class="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs"
      >
        <UTooltip :text="edit.sessionClosed ? 'Session closed — further changes will not upload' : edit.dirty ? 'Unsaved changes' : 'Synced'">
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="edit.sessionClosed ? 'bg-error' : edit.dirty ? 'bg-warning' : 'bg-success'"
          />
        </UTooltip>
        <span class="truncate font-medium">{{ basename(edit.remotePath) }}</span>
        <span class="truncate text-dimmed">{{ sessionLabel(edit.sessionId) }}</span>
        <UTooltip text="Close edit">
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="editSessions.close(edit.editId)"
          />
        </UTooltip>
      </div>
    </div>
    <div v-else class="flex h-full flex-col items-center justify-center gap-1 px-3 py-6 text-center">
      <UIcon name="i-lucide-file-pen-line" class="size-5 text-dimmed" />
      <p class="text-xs text-dimmed">Files opened for editing appear here — the dot shows sync status</p>
    </div>
  </div>
</template>

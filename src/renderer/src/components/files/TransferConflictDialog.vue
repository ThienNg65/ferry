<script setup lang="ts">
import type { FileEntry } from '@shared/contract'
import type { TransferIntent } from '../../composables/useTransferIntents'
import type { ConflictChoice } from '../../utils/resolveConflicts'
import { formatBytes, formatShortDate } from '../../utils/format'

defineProps<{ conflicts: Array<{ intent: TransferIntent; target: FileEntry }> }>()
const emit = defineEmits<{ dismiss: []; resolve: [choice: ConflictChoice] }>()
</script>

<template>
  <UModal
    :open="conflicts.length > 0"
    title="File Conflict"
    :ui="{ footer: 'flex-wrap justify-end' }"
    @update:open="(v: boolean) => { if (!v) emit('dismiss') }"
  >
    <template #body>
      <p class="mb-2 text-sm text-default">These items already exist in the target directory:</p>
      <ul class="flex max-h-60 flex-col gap-2 overflow-y-auto rounded-md bg-muted p-2 text-xs text-default">
        <li v-for="c in conflicts" :key="c.intent.targetName" class="flex flex-col gap-0.5">
          <span class="truncate font-medium">{{ c.intent.targetName }}</span>
          <span class="text-muted">
            New: {{ c.intent.isDir ? 'folder' : formatBytes(c.intent.sourceSize ?? 0) }}, {{ formatShortDate(c.intent.sourceModifiedAt) || 'unknown date' }}
          </span>
          <span class="text-muted">
            Existing: {{ c.target.isDir ? 'folder' : formatBytes(c.target.size) }}, {{ formatShortDate(c.target.modifiedAt) || 'unknown date' }}
          </span>
        </li>
      </ul>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" @click="emit('dismiss')">Cancel</UButton>
      <UButton color="neutral" variant="outline" @click="emit('resolve', 'skip')">Skip existing</UButton>
      <UButton color="neutral" variant="outline" @click="emit('resolve', 'rename')">Keep both</UButton>
      <UButton color="neutral" variant="outline" @click="emit('resolve', 'newer')">Overwrite if newer</UButton>
      <UButton color="primary" @click="emit('resolve', 'overwrite')">Overwrite all</UButton>
    </template>
  </UModal>
</template>

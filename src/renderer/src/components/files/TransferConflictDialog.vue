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
    title="File conflict"
    :ui="{ content: 'sm:max-w-xl', footer: 'flex-nowrap justify-end gap-1.5 overflow-x-auto' }"
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
      <UButton size="sm" color="neutral" variant="outline" class="shrink-0 whitespace-nowrap" @click="emit('dismiss')">Cancel</UButton>
      <UButton size="sm" color="neutral" variant="outline" class="shrink-0 whitespace-nowrap" @click="emit('resolve', 'skip')">Skip existing</UButton>
      <UButton size="sm" color="neutral" variant="outline" class="shrink-0 whitespace-nowrap" @click="emit('resolve', 'rename')">Keep both</UButton>
      <UButton size="sm" color="neutral" variant="outline" class="shrink-0 whitespace-nowrap" @click="emit('resolve', 'newer')">Overwrite if newer</UButton>
      <UButton size="sm" color="primary" class="shrink-0 whitespace-nowrap" @click="emit('resolve', 'overwrite')">Overwrite all</UButton>
    </template>
  </UModal>
</template>

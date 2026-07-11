<script setup lang="ts">
import type { FileEntry } from '@shared/contract'
import FileRow from './FileRow.vue'

defineProps<{
  entries: FileEntry[]
  selected: Set<string>
  side: 'local' | 'remote'
  transferIcon?: string
  showTail?: boolean
  allowExtract?: boolean
}>()

const emit = defineEmits<{
  select: [path: string]
  open: [entry: FileEntry]
  remove: [entry: FileEntry]
  transfer: [entry: FileEntry]
  tail: [entry: FileEntry]
  extract: [entry: FileEntry]
}>()
</script>

<template>
  <div class="flex-1 overflow-y-auto px-1 py-1">
    <FileRow
      v-for="entry in entries"
      :key="entry.path"
      :entry="entry"
      :selected="selected.has(entry.path)"
      :side="side"
      :transfer-icon="transferIcon"
      :show-tail="showTail"
      :allow-extract="allowExtract"
      @select="emit('select', $event)"
      @open="emit('open', $event)"
      @remove="emit('remove', $event)"
      @transfer="emit('transfer', $event)"
      @tail="emit('tail', $event)"
      @extract="emit('extract', $event)"
    />
    <p v-if="entries.length === 0" class="px-3 py-6 text-center text-xs text-muted">Empty folder</p>
  </div>
</template>

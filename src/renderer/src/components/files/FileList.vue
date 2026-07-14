<script setup lang="ts">
import type { FileEntry } from '@shared/contract'
import type { SortColumn, SortDirection } from '../../utils/fileSort'
import FileRow from './FileRow.vue'

defineProps<{
  entries: FileEntry[]
  selected: Set<string>
  side: 'local' | 'remote'
  transferIcon?: string
  showTail?: boolean
  allowExtract?: boolean
  renamingPath?: string | null
  sortColumn: SortColumn
  sortDirection: SortDirection
}>()

const emit = defineEmits<{
  select: [path: string, event: MouseEvent]
  open: [entry: FileEntry]
  remove: [entry: FileEntry]
  transfer: [entry: FileEntry]
  tail: [entry: FileEntry]
  extract: [entry: FileEntry]
  rename: [entry: FileEntry, newName: string]
  'cancel-rename': []
  'start-rename': [entry: FileEntry]
  chmod: [entry: FileEntry]
  sort: [column: SortColumn]
}>()
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex shrink-0 items-center gap-2 border-b border-muted px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted"
    >
      <span class="size-4 shrink-0" />
      <button type="button" class="flex-1 truncate text-left hover:text-highlighted" @click="emit('sort', 'name')">
        Name
        <UIcon
          v-if="sortColumn === 'name'"
          :name="sortDirection === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="inline size-3 align-text-bottom"
        />
      </button>
      <button
        type="button"
        class="w-20 shrink-0 text-right hover:text-highlighted"
        @click="emit('sort', 'size')"
      >
        Size
        <UIcon
          v-if="sortColumn === 'size'"
          :name="sortDirection === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="inline size-3 align-text-bottom"
        />
      </button>
      <button
        type="button"
        class="w-40 shrink-0 text-right hover:text-highlighted"
        @click="emit('sort', 'modified')"
      >
        Modified
        <UIcon
          v-if="sortColumn === 'modified'"
          :name="sortDirection === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="inline size-3 align-text-bottom"
        />
      </button>
      <span v-if="side === 'remote'" class="w-36 shrink-0 text-right">Permissions</span>
      <span class="w-7 shrink-0" />
    </div>
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
        :renaming="renamingPath === entry.path"
        @select="(path, event) => emit('select', path, event)"
        @open="emit('open', $event)"
        @remove="emit('remove', $event)"
        @transfer="emit('transfer', $event)"
        @tail="emit('tail', $event)"
        @extract="emit('extract', $event)"
        @rename="(entry, newName) => emit('rename', entry, newName)"
        @cancel-rename="emit('cancel-rename')"
        @start-rename="emit('start-rename', $event)"
        @chmod="emit('chmod', $event)"
      />
      <p v-if="entries.length === 0" class="px-3 py-6 text-center text-xs text-muted">Empty folder</p>
    </div>
  </div>
</template>

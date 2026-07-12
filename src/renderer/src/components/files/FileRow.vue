<script setup lang="ts">
import { computed } from 'vue'
import type { FileEntry } from '@shared/contract'
import { useDragAndDrop } from '../../composables/useDragAndDrop'
import { useUiStore } from '../../stores/ui.store'
import { toFriendlyLabel, toTechnical } from '../../utils/permissions'

const props = defineProps<{
  entry: FileEntry
  selected: boolean
  side: 'local' | 'remote'
  transferIcon?: string
  showTail?: boolean
  allowExtract?: boolean
}>()

const { startDrag, clearDrag } = useDragAndDrop()
const ui = useUiStore()

function onDragStart(event: DragEvent): void {
  startDrag(props.side, props.entry)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', props.entry.name)
  }
}

const emit = defineEmits<{
  select: [path: string]
  open: [entry: FileEntry]
  remove: [entry: FileEntry]
  transfer: [entry: FileEntry]
  tail: [entry: FileEntry]
  extract: [entry: FileEntry]
}>()

const isZip = computed(() => /\.zip$/i.test(props.entry.name))

function formatSize(size: number, isDir: boolean): string {
  if (isDir) {
    return ''
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatDate(iso: string | null): string {
  if (!iso) {
    return ''
  }
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const transferTooltip = computed(() => (props.side === 'local' ? 'Upload to remote' : 'Download to local'))

const showPermissions = computed(() => props.side === 'remote' && !!props.entry.permissions)
const technicalPermissions = computed(() => (props.entry.permissions ? toTechnical(props.entry.permissions) : ''))
const friendlyPermissions = computed(() => (props.entry.permissions ? toFriendlyLabel(props.entry.permissions) : ''))
</script>

<template>
  <div
    class="group flex cursor-default select-none items-center gap-2 rounded-md px-3 py-1.5 text-[13px]"
    :class="selected ? 'bg-accented text-highlighted' : 'text-default hover:bg-muted'"
    :draggable="!entry.isDir"
    @click="emit('select', entry.path)"
    @dblclick="emit('open', entry)"
    @dragstart="onDragStart"
    @dragend="clearDrag"
  >
    <UIcon
      :name="entry.isDir ? 'i-lucide-folder' : 'i-lucide-file'"
      class="size-4 shrink-0 text-muted"
    />
    <span class="flex-1 truncate">{{ entry.name }}</span>
    <span class="w-20 shrink-0 text-right text-xs text-muted">{{ formatSize(entry.size, entry.isDir) }}</span>
    <span class="w-40 shrink-0 text-right text-xs text-muted">{{ formatDate(entry.modifiedAt) }}</span>
    <div v-if="showPermissions" class="flex w-36 shrink-0 justify-end">
      <UTooltip :text="`Owner permissions: ${technicalPermissions} (${entry.permissions})`">
        <span v-if="ui.permissionsDisplay === 'technical'" class="font-mono text-xs text-muted">
          {{ technicalPermissions }}
        </span>
        <UBadge v-else color="neutral" variant="subtle" size="sm" class="truncate">{{ friendlyPermissions }}</UBadge>
      </UTooltip>
    </div>
    <div v-else-if="side === 'remote'" class="w-36 shrink-0"></div>
    <div class="flex w-7 shrink-0 items-center justify-center">
      <UTooltip v-if="showTail && !entry.isDir" text="Tail this file live">
        <UButton
          icon="i-lucide-scroll-text"
          color="neutral"
          variant="ghost"
          size="xs"
          class="opacity-0 group-hover:opacity-100"
          @click.stop="emit('tail', entry)"
        />
      </UTooltip>
    </div>
    <div class="flex w-7 shrink-0 items-center justify-center">
      <UTooltip v-if="allowExtract && isZip" text="Extract here">
        <UButton
          icon="i-lucide-archive-restore"
          color="neutral"
          variant="ghost"
          size="xs"
          class="opacity-0 group-hover:opacity-100"
          @click.stop="emit('extract', entry)"
        />
      </UTooltip>
    </div>
    <div class="flex w-7 shrink-0 items-center justify-center">
      <UTooltip v-if="transferIcon && !entry.isDir" :text="transferTooltip">
        <UButton
          :icon="transferIcon"
          color="neutral"
          variant="ghost"
          size="xs"
          class="opacity-0 group-hover:opacity-100"
          @click.stop="emit('transfer', entry)"
        />
      </UTooltip>
    </div>
    <UTooltip text="Delete">
      <UButton
        icon="i-lucide-trash-2"
        color="neutral"
        variant="ghost"
        size="xs"
        class="opacity-0 group-hover:opacity-100"
        @click.stop="emit('remove', entry)"
      />
    </UTooltip>
  </div>
</template>

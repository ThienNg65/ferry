<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ContextMenu, { type ContextMenuItem } from '@nuxt/ui/components/ContextMenu.vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { FileEntry } from '@shared/contract'
import { invoke } from '../../api'
import { useDragAndDrop } from '../../composables/useDragAndDrop'
import { useUiStore } from '../../stores/ui.store'
import { useNotify } from '../../composables/useNotify'
import { toFriendlyLabel, toTechnical } from '../../utils/permissions'
import { isArchive } from '../../utils/fileTypes'

const props = defineProps<{
  entry: FileEntry
  selected: boolean
  side: 'local' | 'remote'
  transferIcon?: string
  showTail?: boolean
  allowExtract?: boolean
  renaming?: boolean
}>()

const { startDrag, clearDrag } = useDragAndDrop()
const ui = useUiStore()

/**
 * Local rows hand off to a native OS drag carrying the real file path — this both
 * lets them drop onto Explorer/Finder AND drop onto the remote pane, which treats it
 * identically to a drop from the OS (see `onOsDrop` in FilePane.vue). Remote rows have
 * no local path to hand the OS, so they keep the in-app-only payload used for downloads.
 */
function onDragStart(event: DragEvent): void {
  if (props.side === 'local') {
    event.preventDefault()
    void invoke<void>(INVOKE_CHANNELS.systemStartDrag, props.entry.path)
    return
  }
  startDrag(props.side, props.entry)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', props.entry.name)
  }
}

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
}>()

const notify = useNotify()

async function copyPath(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.entry.path)
    notify.success('Path copied', props.entry.path)
  } catch (e) {
    notify.error('Could not copy path', e instanceof Error ? e.message : String(e))
  }
}

const contextMenuItems = computed<ContextMenuItem[]>(() => {
  const items: ContextMenuItem[] = []
  if (props.transferIcon) {
    items.push({
      label: transferTooltip.value,
      icon: props.transferIcon,
      onSelect: () => emit('transfer', props.entry)
    })
  }
  if (props.showTail && !props.entry.isDir) {
    items.push({ label: 'Tail this file live', icon: 'i-lucide-scroll-text', onSelect: () => emit('tail', props.entry) })
  }
  if (props.allowExtract && isArchiveFile.value) {
    items.push({ label: 'Extract here', icon: 'i-lucide-archive-restore', onSelect: () => emit('extract', props.entry) })
  }
  items.push({ label: 'Rename', icon: 'i-lucide-pencil', kbds: ['F2'], onSelect: () => emit('start-rename', props.entry) })
  items.push({ label: 'Copy path', icon: 'i-lucide-copy', onSelect: () => void copyPath() })
  if (props.side === 'remote' && props.entry.permissions) {
    items.push({ label: 'Permissions…', icon: 'i-lucide-key-round', onSelect: () => emit('chmod', props.entry) })
  }
  items.push({ type: 'separator' })
  items.push({
    label: 'Delete',
    icon: 'i-lucide-trash-2',
    color: 'error',
    onSelect: () => emit('remove', props.entry)
  })
  return items
})

const draftName = ref(props.entry.name)
watch(
  () => props.renaming,
  (active) => {
    if (active) {
      draftName.value = props.entry.name
    }
  }
)

function submitRename(): void {
  const name = draftName.value.trim()
  if (name && name !== props.entry.name) {
    emit('rename', props.entry, name)
  } else {
    emit('cancel-rename')
  }
}

const isArchiveFile = computed(() => isArchive(props.entry.name))

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

const transferTooltip = computed(() => {
  const verb = props.side === 'local' ? 'Upload' : 'Download'
  return props.entry.isDir ? `${verb} folder` : `${verb} to ${props.side === 'local' ? 'remote' : 'local'}`
})

const showPermissions = computed(() => props.side === 'remote' && !!props.entry.permissions)
const technicalPermissions = computed(() => (props.entry.permissions ? toTechnical(props.entry.permissions) : ''))
const friendlyPermissions = computed(() => (props.entry.permissions ? toFriendlyLabel(props.entry.permissions) : ''))
</script>

<template>
  <ContextMenu :items="contextMenuItems">
  <div
    class="group flex cursor-default select-none items-center gap-2 rounded-md px-3 py-1.5 text-[13px]"
    :class="selected ? 'bg-accented text-highlighted' : 'text-default hover:bg-muted'"
    :draggable="!renaming"
    @click="emit('select', entry.path, $event)"
    @dblclick="emit('open', entry)"
    @dragstart="onDragStart"
    @dragend="clearDrag"
  >
    <UIcon
      :name="entry.isDir ? 'i-lucide-folder' : 'i-lucide-file'"
      class="size-4 shrink-0 text-muted"
    />
    <UInput
      v-if="renaming"
      v-model="draftName"
      size="xs"
      class="flex-1"
      autofocus
      @click.stop
      @dblclick.stop
      @keydown.stop
      @keyup.enter="submitRename"
      @keyup.esc="emit('cancel-rename')"
      @blur="submitRename"
    />
    <span v-else class="flex-1 truncate">{{ entry.name }}</span>
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
      <UTooltip v-if="allowExtract && isArchiveFile" text="Extract here">
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
      <UTooltip v-if="transferIcon" :text="transferTooltip">
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
  </ContextMenu>
</template>

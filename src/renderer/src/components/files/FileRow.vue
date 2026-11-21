<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { renameSelectionEnd } from '../../utils/renameSelection'
import ContextMenu, { type ContextMenuItem } from '@nuxt/ui/components/ContextMenu.vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { FileEntry } from '@shared/contract'
import { invoke } from '../../api'
import { isNeutralinoRuntime } from '../../bridge/neutralinoApi'
import { useDragAndDrop } from '../../composables/useDragAndDrop'
import { useUiStore } from '../../stores/ui.store'
import { useNotify } from '../../composables/useNotify'
import { toFriendlyLabel, toTechnical } from '../../utils/permissions'
import { isArchive, colorForFile, iconForFile } from '../../utils/fileTypes'
import { formatBytes, formatDateTime, formatShortDate } from '../../utils/format'
import { COLUMN_HIDE } from '../../utils/paneColumns'

const props = defineProps<{
  entry: FileEntry
  rowIndex: number
  selected: boolean
  /** True when this row's pane is the active one — selection is drawn loud there and grey elsewhere. */
  active: boolean
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
  if (props.side === 'local' && !isNeutralinoRuntime()) {
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
  compress: [entry: FileEntry]
  rename: [entry: FileEntry, newName: string]
  'cancel-rename': []
  'start-rename': [entry: FileEntry]
  chmod: [entry: FileEntry]
  edit: [entry: FileEntry]
  'edit-root': [entry: FileEntry]
  'hover-dir': [path: string]
  'drop-on': [entry: FileEntry, event: DragEvent]
}>()

const dropHover = ref(false)

function onRowDragOver(event: DragEvent): void {
  if (props.entry.isDir) {
    event.preventDefault()
    dropHover.value = true
  }
}

function onRowDrop(event: DragEvent): void {
  dropHover.value = false
  if (props.entry.isDir) {
    event.preventDefault()
    event.stopPropagation()
    emit('drop-on', props.entry, event)
  }
}

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
      kbds: ['F5'],
      onSelect: () => emit('transfer', props.entry)
    })
  }
  if (props.showTail && !props.entry.isDir) {
    items.push({ label: 'Tail this file live', icon: 'i-lucide-scroll-text', onSelect: () => emit('tail', props.entry) })
  }
  if (props.allowExtract && isArchiveFile.value) {
    items.push({ label: 'Extract here', icon: 'i-lucide-archive-restore', onSelect: () => emit('extract', props.entry) })
  }
  if (!props.entry.isDir) {
    items.push({ label: 'Edit', icon: 'i-lucide-file-pen', onSelect: () => emit('edit', props.entry) })
    if (props.side === 'remote') {
      items.push({ label: 'Edit as root', icon: 'i-lucide-shield-alert', onSelect: () => emit('edit-root', props.entry) })
    }
  }
  items.push({ label: 'Compress to .zip', icon: 'i-lucide-file-archive', onSelect: () => emit('compress', props.entry) })
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
const renameInput = ref<{ inputRef?: HTMLInputElement | null } | null>(null)
watch(
  () => props.renaming,
  async (active) => {
    if (active) {
      draftName.value = props.entry.name
      await nextTick()
      const inputEl = renameInput.value?.inputRef
      if (inputEl) {
        inputEl.focus()
        inputEl.setSelectionRange(0, renameSelectionEnd(props.entry.name, props.entry.isDir))
      }
    }
  },
  { immediate: true }
)

function focusPane(): void {
  document.querySelector<HTMLElement>(`[data-pane="${props.side}"]`)?.focus()
}

function onMenuCloseAutoFocus(e: Event): void {
  e.preventDefault()
  void nextTick(() => {
    if (!props.renaming) {
      focusPane()
    }
  })
}

function onRenameEscape(): void {
  cancelRename()
  focusPane()
}

function cancelRename(): void {
  draftName.value = props.entry.name
  emit('cancel-rename')
}

function submitRename(): void {
  if (draftName.value === props.entry.name) {
    onRenameEscape()
    return
  }
  emit('rename', props.entry, draftName.value)
}

const isArchiveFile = computed(() => isArchive(props.entry.name))

const transferTooltip = computed(() => {
  const verb = props.side === 'local' ? 'Upload' : 'Download'
  return props.entry.isDir ? `${verb} folder` : `${verb} to ${props.side === 'local' ? 'remote' : 'local'}`
})

const symlinkTooltip = computed(() => {
  if (!props.entry.isSymlink) return ''
  if (props.entry.symlinkBroken) {
    return props.entry.symlinkTarget
      ? `Broken symlink → ${props.entry.symlinkTarget} (target not found)`
      : 'Broken symlink (target not found)'
  }
  return props.entry.symlinkTarget ? `Symlink → ${props.entry.symlinkTarget}` : 'Symlink'
})

const showPermissions = computed(() => props.side === 'remote' && !!props.entry.permissions)
const technicalPermissions = computed(() => (props.entry.permissions ? toTechnical(props.entry.permissions) : ''))
const friendlyPermissions = computed(() => (props.entry.permissions ? toFriendlyLabel(props.entry.permissions) : ''))

let hoverTimer: ReturnType<typeof setTimeout> | null = null

function onMouseEnter(): void {
  if (props.entry.isDir && props.side === 'remote') {
    if (hoverTimer) clearTimeout(hoverTimer)
    hoverTimer = setTimeout(() => {
      emit('hover-dir', props.entry.path)
    }, 400)
  }
}

onBeforeUnmount(() => {
  if (hoverTimer) clearTimeout(hoverTimer)
})

function onMouseLeave(): void {
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
}
</script>

<template>
  <ContextMenu :items="contextMenuItems" :content="{ onCloseAutoFocus: onMenuCloseAutoFocus }">
  <div
    role="row"
    :aria-rowindex="rowIndex"
    :aria-selected="selected"
    class="group flex cursor-default select-none items-center gap-2 px-3 text-row"
    :data-row-path="entry.path"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    :class="[
      ui.density === 'compact' ? 'py-0.5' : 'py-1.5',
      dropHover ? 'ring-2 ring-primary ring-inset' : '',
      selected
        ? active
          ? [ui.glassUiEnabled ? 'bg-primary/14' : 'bg-primary/25', 'text-highlighted shadow-[inset_2px_0_0_var(--ui-primary)]']
          : [ui.glassUiEnabled ? 'bg-muted/70' : 'bg-elevated', 'text-highlighted shadow-[inset_2px_0_0_var(--ui-border-accented)]']
        : ['text-default', ui.glassUiEnabled ? 'hover:bg-muted/50' : 'hover:bg-elevated/60']
    ]"
    :draggable="!renaming"
    @click="emit('select', entry.path, $event)"
    @dblclick="emit('open', entry)"
    @dragstart="onDragStart"
    @dragend="clearDrag"
    @dragover="onRowDragOver"
    @dragleave="dropHover = false"
    @drop="onRowDrop"
  >
    <span aria-hidden="true" class="contents">
      <UTooltip v-if="entry.isSymlink" :text="symlinkTooltip">
        <span class="relative inline-flex size-4 shrink-0">
          <UIcon
            :name="iconForFile(entry.name, entry.isDir)"
            class="size-4"
            :class="colorForFile(entry.name, entry.isDir)"
          />
          <UIcon
            :name="entry.symlinkBroken ? 'i-lucide-link-2-off' : 'i-lucide-link-2'"
            class="absolute -bottom-1 -right-1 size-2.5 rounded-full bg-default"
            :class="entry.symlinkBroken ? 'text-error' : 'text-muted'"
          />
        </span>
      </UTooltip>
      <UIcon
        v-else
        :name="iconForFile(entry.name, entry.isDir)"
        class="size-4 shrink-0"
        :class="colorForFile(entry.name, entry.isDir)"
      />
    </span>
    <div role="gridcell" class="min-w-24 flex-1">
      <UInput
        v-if="renaming"
        ref="renameInput"
        v-model="draftName"
        size="xs"
        class="w-full"
        autofocus
        :aria-label="`Rename ${entry.name}`"
        @click.stop
        @dblclick.stop
        @keydown.stop
        @keyup.enter="submitRename"
        @keyup.esc="onRenameEscape"
      />
      <div v-else class="flex items-center gap-1.5 overflow-hidden">
        <span
          class="truncate"
          :class="[
            entry.isDir ? 'font-medium' : '',
            entry.isSymlink && entry.symlinkTarget ? 'shrink-0 max-w-[60%]' : ''
          ]"
          :title="entry.name"
        >{{ entry.name }}</span>
        <span
          v-if="entry.isSymlink && entry.symlinkTarget"
          class="min-w-0 flex-1 truncate text-xs font-normal text-muted"
          :title="entry.symlinkTarget"
        >
          → {{ entry.symlinkTarget }}
        </span>
        <UBadge v-if="entry.symlinkBroken" color="error" variant="subtle" size="xs" class="shrink-0">
          broken
        </UBadge>
      </div>
    </div>
    <span role="gridcell" v-if="!ui.columns.hidden.includes('size')" class="w-[var(--col-size)] shrink-0 text-right text-meta tabular-nums text-muted" :class="COLUMN_HIDE[side].size">{{ entry.isDir ? '' : formatBytes(entry.size) }}</span>
    <span role="gridcell" v-if="!ui.columns.hidden.includes('modified')" class="w-[var(--col-modified)] shrink-0 text-right text-meta tabular-nums text-muted" :class="COLUMN_HIDE[side].modified" :title="formatDateTime(entry.modifiedAt)">{{ formatShortDate(entry.modifiedAt) }}</span>
    <div role="gridcell" v-if="showPermissions && !ui.columns.hidden.includes('permissions')" class="flex w-[var(--col-permissions)] shrink-0 justify-end" :class="COLUMN_HIDE.remote.permissions">
      <UTooltip :text="`Owner permissions: ${technicalPermissions} (${entry.permissions}) — click to edit`">
        <button
          type="button"
          class="max-w-full cursor-pointer truncate rounded px-1.5 py-0.5 text-2xs transition-colors hover:bg-muted hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
          :class="ui.permissionsDisplay === 'technical' ? 'font-mono text-muted' : 'text-muted'"
          @click.stop="emit('chmod', entry)"
        >
          {{ ui.permissionsDisplay === 'technical' ? technicalPermissions : friendlyPermissions }}
        </button>
      </UTooltip>
    </div>
    <div role="gridcell" v-else-if="side === 'remote' && !ui.columns.hidden.includes('permissions')" class="w-[var(--col-permissions)] shrink-0" :class="COLUMN_HIDE.remote.permissions"></div>
    <div role="gridcell" class="flex w-14 shrink-0 items-center justify-end gap-0.5">
      <UTooltip v-if="transferIcon" :text="transferTooltip">
        <UButton
          :icon="transferIcon"
          color="primary"
          variant="ghost"
          size="xs"
          :aria-label="transferTooltip"
          class="transition-opacity"
          :class="selected ? 'opacity-75 hover:opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'"
          @click.stop="emit('transfer', entry)"
        />
      </UTooltip>
      <UTooltip text="Delete">
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Delete"
          class="transition-opacity"
          :class="selected ? 'opacity-75 hover:opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'"
          @click.stop="emit('remove', entry)"
        />
      </UTooltip>
    </div>
  </div>
  </ContextMenu>
</template>

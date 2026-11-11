<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { FileEntry } from '@shared/contract'
import type { SortColumn, SortDirection } from '../../utils/fileSort'
import { useUiStore } from '../../stores/ui.store'
import FileRow from './FileRow.vue'

const props = defineProps<{
  entries: FileEntry[]
  selected: Set<string>
  side: 'local' | 'remote'
  active: boolean
  loading?: boolean
  filtered?: boolean
  transferIcon?: string
  showTail?: boolean
  allowExtract?: boolean
  renamingPath?: string | null
  sortColumn: SortColumn
  sortDirection: SortDirection
}>()

const ui = useUiStore()

// Virtualize the row list so directories with thousands of entries mount only
// the visible rows (plus overscan) instead of one real DOM node each. Rows are
// measured (measureElement) rather than assumed to be a fixed height: a row's
// height varies slightly with the inline rename input and the remote
// permissions column, and measuring self-corrects instead of risking overlap.
const scrollEl = ref<HTMLElement | null>(null)
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: props.entries.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => (ui.density === 'compact' ? 26 : 34),
    overscan: 8,
    getItemKey: (index: number) => props.entries[index]?.path ?? index
  }))
)
const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems())
const totalSize = computed(() => rowVirtualizer.value.getTotalSize())

/** Function ref for each row wrapper — feeds real heights back to the virtualizer. */
function measureRow(el: Element | ComponentPublicInstance | null): void {
  if (el instanceof Element) {
    rowVirtualizer.value.measureElement(el)
  }
}

function scrollToIndex(index: number): void {
  if (index >= 0 && index < props.entries.length) {
    rowVirtualizer.value.scrollToIndex(index, { align: 'auto' })
  }
}

defineExpose({ scrollToIndex })

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
  sort: [column: SortColumn]
  'clear-filter': []
  'hover-dir': [path: string]
  'drop-on': [entry: FileEntry, event: DragEvent]
}>()
import { COLUMN_HIDE } from '../../utils/paneColumns'
import { DEFAULT_COLUMN_WIDTHS, type ColumnKey } from '../../utils/columnPrefs'

const columnVars = computed(() => ({
  '--col-size': `${ui.columns.widths.size}px`,
  '--col-modified': `${ui.columns.widths.modified}px`,
  '--col-permissions': `${ui.columns.widths.permissions}px`
}))

const columnMenuItems = computed(() => {
  const keys: { key: ColumnKey; label: string }[] = [
    { key: 'size', label: 'Size' },
    { key: 'modified', label: 'Modified' },
    ...(props.side === 'remote' ? [{ key: 'permissions' as const, label: 'Permissions' }] : [])
  ]
  return keys.map(({ key, label }) => ({
    type: 'checkbox' as const,
    label,
    checked: !ui.columns.hidden.includes(key),
    onUpdateChecked: (checked: boolean) => ui.setColumnVisible(key, checked)
  }))
})

function startResize(key: ColumnKey, event: PointerEvent): void {
  const startX = event.clientX
  const startWidth = ui.columns.widths[key] ?? DEFAULT_COLUMN_WIDTHS[key]
  const onMove = (e: PointerEvent): void => ui.setColumnWidth(key, startWidth + (startX - e.clientX))
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    ui.persistColumns()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<template>
  <div class="@container flex min-h-0 flex-1 flex-col" :style="columnVars">
    <!-- Same stable gutter as the scroller below, so right-aligned columns line up with the rows whether or not a scrollbar shows. -->
    <div
      class="flex shrink-0 items-center gap-2 overflow-y-hidden border-b border-muted px-3 py-1 text-meta font-medium text-muted [scrollbar-gutter:stable]"
    >
      <span class="size-4 shrink-0" />
      <button
        type="button"
        class="min-w-24 flex-1 truncate text-left hover:text-highlighted"
        :class="sortColumn === 'name' ? 'text-highlighted' : ''"
        @click="emit('sort', 'name')"
      >
        Name
        <UIcon
          v-if="sortColumn === 'name'"
          :name="sortDirection === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="inline size-3 align-text-bottom"
        />
      </button>
      <button
        v-if="!ui.columns.hidden.includes('size')"
        type="button"
        class="relative w-[var(--col-size)] shrink-0 text-right hover:text-highlighted"
        :class="[COLUMN_HIDE[side].size, sortColumn === 'size' ? 'text-highlighted' : '']"
        @click="emit('sort', 'size')"
      >
        <span class="absolute inset-y-0 -left-1 w-2 cursor-col-resize" @click.stop @pointerdown.stop.prevent="startResize('size', $event)" />
        Size
        <UIcon
          v-if="sortColumn === 'size'"
          :name="sortDirection === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="inline size-3 align-text-bottom"
        />
      </button>
      <button
        v-if="!ui.columns.hidden.includes('modified')"
        type="button"
        class="relative w-[var(--col-modified)] shrink-0 text-right hover:text-highlighted"
        :class="[COLUMN_HIDE[side].modified, sortColumn === 'modified' ? 'text-highlighted' : '']"
        @click="emit('sort', 'modified')"
      >
        <span class="absolute inset-y-0 -left-1 w-2 cursor-col-resize" @click.stop @pointerdown.stop.prevent="startResize('modified', $event)" />
        Modified
        <UIcon
          v-if="sortColumn === 'modified'"
          :name="sortDirection === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="inline size-3 align-text-bottom"
        />
      </button>
      <span
        v-if="side === 'remote' && !ui.columns.hidden.includes('permissions')"
        class="relative w-[var(--col-permissions)] shrink-0 text-right"
        :class="COLUMN_HIDE.remote.permissions"
      >
        <span class="absolute inset-y-0 -left-1 w-2 cursor-col-resize" @pointerdown.stop.prevent="startResize('permissions', $event)" />
        Permissions
      </span>
      <span class="flex w-14 shrink-0 justify-end">
        <UDropdownMenu :items="columnMenuItems">
          <UButton icon="i-lucide-columns-3" color="neutral" variant="ghost" size="xs" aria-label="Choose columns" />
        </UDropdownMenu>
      </span>
    </div>
    <div ref="scrollEl" class="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <div v-if="loading && entries.length === 0" role="status" class="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
        <p class="text-xs text-muted">Loading directory…</p>
      </div>
      <div v-else-if="entries.length === 0 && filtered" class="flex flex-col items-center gap-2 px-3 py-8 text-center">
        <UIcon name="i-lucide-search-x" class="size-5 text-dimmed" />
        <p class="text-xs text-muted">No files match the current filter</p>
        <UButton size="xs" color="neutral" variant="soft" @click="emit('clear-filter')">Clear filter</UButton>
      </div>
      <div v-else-if="entries.length === 0" class="flex flex-col items-center gap-1 px-3 py-6 text-center">
        <UIcon name="i-lucide-folder-open" class="size-5 text-dimmed" />
        <p class="text-xs text-muted">Empty folder</p>
      </div>
      <div v-else class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div
          v-for="virtualRow in virtualRows"
          :key="virtualRow.key as string | number"
          :ref="measureRow"
          :data-index="virtualRow.index"
          class="absolute left-0 top-0 w-full"
          :style="{ transform: `translateY(${virtualRow.start}px)` }"
        >
          <FileRow
            :entry="entries[virtualRow.index]"
            :selected="selected.has(entries[virtualRow.index].path)"
            :side="side"
            :active="active"
            :transfer-icon="transferIcon"
            :show-tail="showTail"
            :allow-extract="allowExtract"
            :renaming="renamingPath === entries[virtualRow.index].path"
            @select="(path, event) => emit('select', path, event)"
            @open="emit('open', $event)"
            @remove="emit('remove', $event)"
            @transfer="emit('transfer', $event)"
            @tail="emit('tail', $event)"
            @extract="emit('extract', $event)"
            @compress="emit('compress', $event)"
            @rename="(entry, newName) => emit('rename', entry, newName)"
            @cancel-rename="emit('cancel-rename')"
            @start-rename="emit('start-rename', $event)"
            @chmod="emit('chmod', $event)"
            @edit="emit('edit', $event)"
            @hover-dir="emit('hover-dir', $event)"
            @drop-on="(entry, event) => emit('drop-on', entry, event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

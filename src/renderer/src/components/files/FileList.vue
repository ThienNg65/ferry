<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { FileEntry } from '@shared/contract'
import type { SortColumn, SortDirection } from '../../utils/fileSort'
import { useUiStore } from '../../stores/ui.store'
import FileRow from './FileRow.vue'

const props = defineProps<{
  entries: FileEntry[]
  directoryPath: string
  selected: Set<string>
  side: 'local' | 'remote'
  active: boolean
  loading?: boolean
  filtered?: boolean
  visibilityFiltered?: boolean
  searchFiltered?: boolean
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

// Animate the viewport once after a successful directory change, never each
// virtualized row. Cached directories are instantaneous; slow remote navigation
// waits for loading to finish, avoiding a misleading animation of the old list.
let lastRenderedDirectory = ''
let directoryAnimation: Animation | null = null
watch(
  () => [props.directoryPath, props.loading] as const,
  ([path, loading]) => {
    if (!path || loading || path === lastRenderedDirectory) return

    const previousDirectory = lastRenderedDirectory
    lastRenderedDirectory = path
    const viewport = scrollEl.value
    if (!viewport) return

    viewport.scrollTop = 0
    directoryAnimation?.cancel()
    directoryAnimation = null

    if (!previousDirectory || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      return
    }

    directoryAnimation = viewport.animate(
      [
        { opacity: 0.65, transform: 'translate3d(0, 6px, 0)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' }
      ],
      { duration: 170, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
    )
  },
  { flush: 'post', immediate: true }
)
onBeforeUnmount(() => directoryAnimation?.cancel())

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
  'edit-root': [entry: FileEntry]
  sort: [column: SortColumn]
  'clear-filter': []
  'clear-visibility-filter': []
  'hover-dir': [path: string]
  'drop-on': [entry: FileEntry, event: DragEvent]
  'select-many': [paths: string[]]
}>()
import { COLUMN_HIDE } from '../../utils/paneColumns'
import { DEFAULT_COLUMN_WIDTHS, type ColumnKey } from '../../utils/columnPrefs'

const band = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
const bandStyle = computed(() => {
  const b = band.value
  return b
    ? { left: `${Math.min(b.x0, b.x1)}px`, top: `${Math.min(b.y0, b.y1)}px`, width: `${Math.abs(b.x1 - b.x0)}px`, height: `${Math.abs(b.y1 - b.y0)}px` }
    : {}
})

function onBandStart(event: MouseEvent): void {
  const el = scrollEl.value
  if (!el || event.button !== 0) return
  const target = event.target as HTMLElement
  const onEmptySpace = target === el || target.parentElement === el
  if (!onEmptySpace && !event.altKey) return
  if (event.offsetX > el.clientWidth && target === el) return
  event.preventDefault()
  const rect = el.getBoundingClientRect()
  const toLocal = (e: MouseEvent): { x: number; y: number } => ({
    x: e.clientX - rect.left + el.scrollLeft,
    y: e.clientY - rect.top + el.scrollTop
  })
  const start = toLocal(event)
  const additive = event.ctrlKey || event.metaKey
  const base = additive ? new Set(props.selected) : new Set<string>()
  const onMove = (e: MouseEvent): void => {
    const cur = toLocal(e)
    band.value = { x0: start.x, y0: start.y, x1: cur.x, y1: cur.y }
    const lo = Math.min(start.y, cur.y)
    const hi = Math.max(start.y, cur.y)
    const paths = new Set(base)
    for (const item of rowVirtualizer.value.measurementsCache) {
      if (item.end >= lo && item.start <= hi && props.entries[item.index]) {
        paths.add(props.entries[item.index].path)
      }
    }
    emit('select-many', [...paths])
  }
  const onUp = (): void => {
    band.value = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function ariaSort(column: SortColumn): 'ascending' | 'descending' | 'none' {
  if (props.sortColumn !== column) {
    return 'none'
  }
  return props.sortDirection === 'asc' ? 'ascending' : 'descending'
}

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
  <div class="@container flex min-h-0 flex-1 flex-col overflow-hidden" :style="columnVars">
    <!-- Same stable gutter as the scroller below, so right-aligned columns line up with the rows whether or not a scrollbar shows. -->
    <div
      role="row"
      class="flex shrink-0 items-center gap-2 overflow-y-hidden border-b border-muted bg-muted/20 px-3 py-1 text-meta font-medium text-muted [scrollbar-gutter:stable]"
    >
      <span class="size-4 shrink-0" />
      <button
        type="button"
        role="columnheader"
        :aria-sort="ariaSort('name')"
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
        role="columnheader"
        :aria-sort="ariaSort('size')"
        class="relative w-[var(--col-size)] shrink-0 text-right hover:text-highlighted"
        :class="[COLUMN_HIDE[side].size, sortColumn === 'size' ? 'text-highlighted' : '']"
        @click="emit('sort', 'size')"
      >
        <span class="absolute inset-y-0 -left-1 w-2 cursor-col-resize rounded-full transition-colors hover:bg-primary/50" @click.stop @pointerdown.stop.prevent="startResize('size', $event)" />
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
        role="columnheader"
        :aria-sort="ariaSort('modified')"
        class="relative w-[var(--col-modified)] shrink-0 text-right hover:text-highlighted"
        :class="[COLUMN_HIDE[side].modified, sortColumn === 'modified' ? 'text-highlighted' : '']"
        @click="emit('sort', 'modified')"
      >
        <span class="absolute inset-y-0 -left-1 w-2 cursor-col-resize rounded-full transition-colors hover:bg-primary/50" @click.stop @pointerdown.stop.prevent="startResize('modified', $event)" />
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
        <span class="absolute inset-y-0 -left-1 w-2 cursor-col-resize rounded-full transition-colors hover:bg-primary/50" @pointerdown.stop.prevent="startResize('permissions', $event)" />
        Permissions
      </span>
      <span class="flex w-14 shrink-0 justify-end">
        <UDropdownMenu :items="columnMenuItems">
          <UButton icon="i-lucide-columns-3" color="neutral" variant="ghost" size="xs" aria-label="Choose columns" />
        </UDropdownMenu>
      </span>
    </div>
    <div class="h-0.5 shrink-0">
      <UProgress v-if="loading && entries.length > 0" size="xs" />
    </div>
    <div ref="scrollEl" role="grid" :aria-label="`${side} files`" :aria-rowcount="entries.length" class="relative flex-1 overflow-y-auto [scrollbar-gutter:stable]" @mousedown="onBandStart">
      <div v-if="band" class="pointer-events-none absolute z-10 border border-primary bg-primary/15" :style="bandStyle" />
      <div v-if="loading && entries.length === 0" role="status" aria-label="Loading directory" class="flex flex-col gap-1 px-2 py-2">
        <div
          v-for="i in 10"
          :key="i"
          class="flex items-center gap-2.5 rounded-sm px-1.5"
          :class="ui.density === 'compact' ? 'h-6' : 'h-8'"
        >
          <USkeleton class="size-4 shrink-0 rounded-xs" />
          <USkeleton class="h-3 flex-1 max-w-[55%]" :style="{ maxWidth: `${35 + ((i * 17) % 40)}%` }" />
          <USkeleton class="ml-auto h-3 w-12 shrink-0" />
          <USkeleton class="h-3 w-20 shrink-0" />
        </div>
      </div>
      <div v-else-if="entries.length === 0 && (visibilityFiltered || searchFiltered || filtered)" class="flex flex-col items-center gap-2 px-3 py-8 text-center">
        <UIcon name="i-lucide-search-x" class="size-5 text-muted" />
        <p class="text-xs text-muted">
          <template v-if="visibilityFiltered && searchFiltered">No files match the active visibility filters and search</template>
          <template v-else-if="visibilityFiltered">No files match the active visibility filters</template>
          <template v-else>No files match the current search</template>
        </p>
        <p v-if="visibilityFiltered" class="text-2xs text-muted">
          Directories stay visible; adjust or clear your include/exclude patterns.
        </p>
        <div class="flex flex-wrap items-center justify-center gap-1.5">
          <UButton v-if="visibilityFiltered" size="xs" color="neutral" variant="soft" @click="emit('clear-visibility-filter')">
            Clear filters
          </UButton>
          <UButton v-if="searchFiltered || (!visibilityFiltered && filtered)" size="xs" color="neutral" variant="soft" @click="emit('clear-filter')">
            Clear search
          </UButton>
        </div>
      </div>
      <div v-else-if="entries.length === 0" class="flex flex-col items-center gap-1 px-3 py-6 text-center">
        <UIcon name="i-lucide-folder-open" class="size-5 text-muted" />
        <p class="text-xs text-muted">Empty folder</p>
      </div>
      <div v-else role="presentation" class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div
          v-for="virtualRow in virtualRows"
          :key="virtualRow.key as string | number"
          :ref="measureRow"
          role="presentation"
          :data-index="virtualRow.index"
          class="absolute left-0 top-0 w-full"
          :style="{ transform: `translateY(${virtualRow.start}px)` }"
        >
          <FileRow
            v-memo="[
              entries[virtualRow.index],
              selected.has(entries[virtualRow.index].path),
              active,
              renamingPath === entries[virtualRow.index].path,
              transferIcon,
              showTail,
              allowExtract
            ]"
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
            @edit-root="emit('edit-root', $event)"
            @hover-dir="emit('hover-dir', $event)"
            @drop-on="(entry, event) => emit('drop-on', entry, event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

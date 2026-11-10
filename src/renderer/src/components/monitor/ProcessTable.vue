<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useMonitorStore } from '../../stores/monitor.store'
import { formatBytes } from '../../utils/format'

type SortKey = 'name' | 'cpuPct' | 'rssBytes'

const monitor = useMonitorStore()

const sortKey = ref<SortKey>('cpuPct')
const sortDir = ref<'asc' | 'desc'>('desc')

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
    return
  }
  sortKey.value = key
  // Numeric columns default to highest-first; Name defaults to A→Z.
  sortDir.value = key === 'name' ? 'asc' : 'desc'
}

const sortedProcesses = computed(() => {
  const list = monitor.latest?.processes ?? []
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    if (sortKey.value === 'name') {
      return a.name.localeCompare(b.name) * dir
    }
    const av = sortKey.value === 'cpuPct' ? (a.cpuPct ?? -1) : a.rssBytes
    const bv = sortKey.value === 'cpuPct' ? (b.cpuPct ?? -1) : b.rssBytes
    return (av - bv) * dir
  })
})

const shownCount = computed(() => sortedProcesses.value.length)
const totalCount = computed(() => monitor.latest?.processTotalCount ?? 0)

// Virtualize the row list ("lazy load on scroll") — same @tanstack/vue-virtual
// pattern as FileList.vue. Rows are fixed-height, single-line, non-wrapping
// text, so a fixed estimateSize is exact (no need for measureElement).
// Keying by pid (not array index) is what keeps scroll position stable across
// the store's wholesale sample replacement every 2s tick, even as the sort
// order reshuffles underneath it.
const scrollEl = ref<HTMLElement | null>(null)
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: sortedProcesses.value.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => 28,
    overscan: 8,
    getItemKey: (index: number) => sortedProcesses.value[index]?.pid ?? index
  }))
)
const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems())
const totalSize = computed(() => rowVirtualizer.value.getTotalSize())

function sortIcon(key: SortKey): string {
  if (sortKey.value !== key) {
    return ''
  }
  return sortDir.value === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex shrink-0 items-center gap-2 border-b border-muted px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-default"
    >
      <button type="button" class="flex-1 truncate text-left hover:text-highlighted" @click="toggleSort('name')">
        Name
        <UIcon v-if="sortIcon('name')" :name="sortIcon('name')" class="inline size-3 align-text-bottom" />
      </button>
      <span class="w-14 shrink-0 text-right">PID</span>
      <button
        type="button"
        class="w-20 shrink-0 text-right hover:text-highlighted"
        @click="toggleSort('rssBytes')"
      >
        RAM
        <UIcon v-if="sortIcon('rssBytes')" :name="sortIcon('rssBytes')" class="inline size-3 align-text-bottom" />
      </button>
      <button
        type="button"
        class="w-16 shrink-0 text-right hover:text-highlighted"
        @click="toggleSort('cpuPct')"
      >
        CPU%
        <UIcon v-if="sortIcon('cpuPct')" :name="sortIcon('cpuPct')" class="inline size-3 align-text-bottom" />
      </button>
    </div>
    <p v-if="totalCount > shownCount" class="shrink-0 px-3 py-0.5 text-right text-[10px] text-dimmed">
      showing top {{ shownCount }} of {{ totalCount }}
    </p>
    <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto px-1 py-1">
      <div v-if="sortedProcesses.length === 0" class="flex flex-col items-center gap-1 px-3 py-6 text-center">
        <p class="text-xs text-dimmed">No process data yet</p>
      </div>
      <div v-else class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div
          v-for="virtualRow in virtualRows"
          :key="virtualRow.key as string | number"
          class="absolute left-0 top-0 flex w-full items-center gap-2 px-2 text-[11px] text-default"
          :style="{ height: '28px', transform: `translateY(${virtualRow.start}px)` }"
        >
          <span class="flex-1 truncate" :title="sortedProcesses[virtualRow.index].name">
            {{ sortedProcesses[virtualRow.index].name }}
          </span>
          <span class="w-14 shrink-0 text-right text-dimmed">{{ sortedProcesses[virtualRow.index].pid }}</span>
          <span class="w-20 shrink-0 text-right">{{ formatBytes(sortedProcesses[virtualRow.index].rssBytes) }}</span>
          <span class="w-16 shrink-0 text-right">
            {{
              sortedProcesses[virtualRow.index].cpuPct === null
                ? '—'
                : `${sortedProcesses[virtualRow.index].cpuPct?.toFixed(1)}%`
            }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

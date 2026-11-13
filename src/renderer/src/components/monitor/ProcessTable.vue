<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useMonitorStore } from '../../stores/monitor.store'
import { useNotify } from '../../composables/useNotify'
import { formatBytes } from '../../utils/format'
import {
  filterAndSortProcesses,
  usageTone,
  type ProcessSortKey,
  type SortDirection
} from '../../utils/monitorHelpers'

const monitor = useMonitorStore()
const notify = useNotify()

const searchQuery = ref('')
const sortKey = ref<ProcessSortKey>('cpuPct')
const sortDir = ref<SortDirection>('desc')
const selectedPid = ref<number | null>(null)

function toggleSort(key: ProcessSortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
    return
  }
  sortKey.value = key
  // Text/ID columns default ascending; resource usage columns default highest-first.
  sortDir.value = key === 'name' || key === 'pid' ? 'asc' : 'desc'
}

const rawProcesses = computed(() => monitor.latest?.processes ?? [])

const sortedProcesses = computed(() =>
  filterAndSortProcesses(rawProcesses.value, searchQuery.value, sortKey.value, sortDir.value)
)

const shownCount = computed(() => sortedProcesses.value.length)
const capturedCount = computed(() => rawProcesses.value.length)
const totalCount = computed(() => monitor.latest?.processTotalCount ?? 0)
const totalMemBytes = computed(() => monitor.latest?.memory.totalBytes ?? 0)

// Virtualize the row list — fixed single-line row height keeps estimateSize exact,
// and keying by pid preserves scroll position across 2s sample updates.
const scrollEl = ref<HTMLElement | null>(null)
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: sortedProcesses.value.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => 30,
    overscan: 8,
    getItemKey: (index: number) => sortedProcesses.value[index]?.pid ?? index
  }))
)
const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems())
const totalSize = computed(() => rowVirtualizer.value.getTotalSize())

function sortIcon(key: ProcessSortKey): string {
  if (sortKey.value !== key) return ''
  return sortDir.value === 'asc' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'
}

function ramPercent(rssBytes: number): number {
  if (totalMemBytes.value <= 0) return 0
  return Math.min(100, (rssBytes / totalMemBytes.value) * 100)
}

function barToneClass(pct: number): string {
  const tone = usageTone(pct)
  if (tone === 'error') return 'bg-error/70'
  if (tone === 'warning') return 'bg-warning/70'
  return 'bg-primary/60'
}

function selectRow(pid: number): void {
  selectedPid.value = selectedPid.value === pid ? null : pid
}

async function copyText(label: string, value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    notify.success(`Copied ${label}`, value)
  } catch {
    notify.error(`Failed to copy ${label}`)
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Filter & Count Toolbar -->
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-muted bg-muted/20 px-3 py-1.5">
      <div class="flex items-center gap-1.5">
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          placeholder="Filter by name or PID…"
          size="xs"
          class="w-56"
          aria-label="Filter processes"
        />
        <UButton
          v-if="searchQuery"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Clear process filter"
          @click="searchQuery = ''"
        />
      </div>
      <span class="text-[11px] text-muted tabular-nums">
        <template v-if="searchQuery.trim()">
          {{ shownCount }} matching · top {{ capturedCount }} of {{ totalCount }}
        </template>
        <template v-else-if="totalCount > capturedCount">
          Top {{ capturedCount }} of {{ totalCount }} processes
        </template>
        <template v-else>
          {{ totalCount }} processes
        </template>
      </span>
    </div>

    <!-- Sortable Table Header -->
    <div
      class="flex shrink-0 items-center gap-2 border-b border-muted px-3 py-1.5 text-2xs font-medium uppercase tracking-wide text-muted select-none"
    >
      <button
        type="button"
        class="flex flex-1 items-center gap-1 truncate text-left transition-colors hover:text-highlighted"
        :class="sortKey === 'name' ? 'text-highlighted' : ''"
        @click="toggleSort('name')"
      >
        <span>Process</span>
        <UIcon v-if="sortIcon('name')" :name="sortIcon('name')" class="size-3 text-primary" />
      </button>
      <button
        type="button"
        class="flex w-20 shrink-0 items-center justify-end gap-0.5 transition-colors hover:text-highlighted"
        :class="sortKey === 'pid' ? 'text-highlighted' : ''"
        @click="toggleSort('pid')"
      >
        <UIcon v-if="sortIcon('pid')" :name="sortIcon('pid')" class="size-3 text-primary" />
        <span>PID</span>
      </button>
      <button
        type="button"
        class="flex w-40 shrink-0 items-center justify-end gap-0.5 transition-colors hover:text-highlighted"
        :class="sortKey === 'rssBytes' ? 'text-highlighted' : ''"
        @click="toggleSort('rssBytes')"
      >
        <UIcon v-if="sortIcon('rssBytes')" :name="sortIcon('rssBytes')" class="size-3 text-primary" />
        <span>RAM</span>
      </button>
      <button
        type="button"
        class="flex w-24 shrink-0 items-center justify-end gap-0.5 transition-colors hover:text-highlighted"
        :class="sortKey === 'cpuPct' ? 'text-highlighted' : ''"
        @click="toggleSort('cpuPct')"
      >
        <UIcon v-if="sortIcon('cpuPct')" :name="sortIcon('cpuPct')" class="size-3 text-primary" />
        <span>CPU%</span>
      </button>
    </div>

    <!-- Virtualized Rows -->
    <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto px-1 py-1">
      <div v-if="sortedProcesses.length === 0" class="flex flex-col items-center gap-1 px-3 py-6 text-center">
        <UIcon name="i-lucide-search-x" class="size-4 text-dimmed" />
        <p class="text-xs text-muted">
          {{ searchQuery.trim() ? `No processes matching "${searchQuery.trim()}"` : 'No process data yet' }}
        </p>
      </div>
      <div v-else class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div
          v-for="virtualRow in virtualRows"
          :key="virtualRow.key as string | number"
          role="button"
          tabindex="0"
          :aria-pressed="selectedPid === sortedProcesses[virtualRow.index].pid"
          class="group absolute left-0 top-0 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 text-2xs transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          :class="
            selectedPid === sortedProcesses[virtualRow.index].pid
              ? 'bg-primary/10 text-highlighted ring-1 ring-inset ring-primary/25'
              : 'border-b border-muted/30 text-default hover:bg-muted/60'
          "
          :style="{ height: '30px', transform: `translateY(${virtualRow.start}px)` }"
          @click="selectRow(sortedProcesses[virtualRow.index].pid)"
          @keydown.enter="selectRow(sortedProcesses[virtualRow.index].pid)"
          @keydown.space.prevent="selectRow(sortedProcesses[virtualRow.index].pid)"
        >
          <div class="flex min-w-0 flex-1 items-center gap-1.5">
            <span class="truncate font-medium" :title="sortedProcesses[virtualRow.index].name">
              {{ sortedProcesses[virtualRow.index].name }}
            </span>
            <div
              class="flex shrink-0 items-center gap-0.5 transition-opacity"
              :class="
                selectedPid === sortedProcesses[virtualRow.index].pid
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
              "
              @click.stop
            >
              <UTooltip text="Copy PID">
                <UButton
                  icon="i-lucide-hash"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="Copy PID"
                  @click="copyText('PID', String(sortedProcesses[virtualRow.index].pid))"
                />
              </UTooltip>
              <UTooltip text="Copy process name">
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="Copy process name"
                  @click="copyText('process name', sortedProcesses[virtualRow.index].name)"
                />
              </UTooltip>
            </div>
          </div>

          <span class="w-20 shrink-0 text-right font-mono text-dimmed tabular-nums">
            {{ sortedProcesses[virtualRow.index].pid }}
          </span>

          <div class="flex w-40 shrink-0 items-center justify-end gap-1.5 tabular-nums">
            <span class="shrink-0 whitespace-nowrap font-mono text-default">
              {{ formatBytes(sortedProcesses[virtualRow.index].rssBytes) }}
            </span>
            <span v-if="totalMemBytes > 0" class="w-10 shrink-0 text-right font-mono text-[10px] text-dimmed">
              {{ ramPercent(sortedProcesses[virtualRow.index].rssBytes).toFixed(1) }}%
            </span>
            <div class="h-1.5 w-8 shrink-0 overflow-hidden rounded-full bg-elevated">
              <div
                class="h-full w-full origin-left transform-gpu rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none"
                :class="barToneClass(ramPercent(sortedProcesses[virtualRow.index].rssBytes))"
                :style="{ transform: `scaleX(${ramPercent(sortedProcesses[virtualRow.index].rssBytes) / 100})` }"
              />
            </div>
          </div>

          <div class="flex w-24 shrink-0 items-center justify-end gap-1.5 tabular-nums">
            <span class="font-mono">
              {{
                sortedProcesses[virtualRow.index].cpuPct === null
                  ? '—'
                  : `${sortedProcesses[virtualRow.index].cpuPct?.toFixed(1)}%`
              }}
            </span>
            <div class="h-1.5 w-8 shrink-0 overflow-hidden rounded-full bg-elevated">
              <div
                v-if="sortedProcesses[virtualRow.index].cpuPct !== null"
                class="h-full w-full origin-left transform-gpu rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none"
                :class="barToneClass(sortedProcesses[virtualRow.index].cpuPct ?? 0)"
                :style="{ transform: `scaleX(${Math.min(100, Math.max(0, sortedProcesses[virtualRow.index].cpuPct ?? 0)) / 100})` }"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

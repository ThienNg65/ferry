<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useTailStreamsStore } from '../../stores/tailStreams.store'
import { useNotify } from '../../composables/useNotify'
import { getLogLevelStyles, parseLogLevel, splitLineMatches, type LogLevel } from '../../utils/logParser'
import LogSearchBar from './LogSearchBar.vue'

const props = defineProps<{ tailId: string }>()

const tailStreams = useTailStreamsStore()
const notify = useNotify()

const lines = computed(() => tailStreams.linesMap[props.tailId] || [])
const ended = computed(() => tailStreams.endedMap[props.tailId] || false)
const error = computed(() => tailStreams.errorMap[props.tailId])

// UI & Controls State
const scrollEl = ref<HTMLDivElement | null>(null)
const searchBarRef = ref<InstanceType<typeof LogSearchBar> | null>(null)
const autoScroll = ref(true)
const newLinesCount = ref(0)
const wrapLines = ref(false)
const levelFilter = ref<'all' | 'error' | 'warn' | 'info' | 'debug'>('all')

// Search State
const searchOpen = ref(false)
const searchQuery = ref('')
const caseSensitive = ref(false)
const isRegex = ref(false)
const regexError = ref<string | null>(null)
const activeMatchIndex = ref(0)

// Parsed Lines Cache with Line Numbers
interface ParsedItem {
  originalIndex: number
  text: string
  level: LogLevel
}

const parsedLines = computed<ParsedItem[]>(() => {
  const raw = lines.value
  return raw.map((text, idx) => ({
    originalIndex: idx,
    text,
    level: parseLogLevel(text)
  }))
})

// Counts per level
const levelCounts = computed(() => {
  let errors = 0
  let warns = 0
  let infos = 0
  let debugs = 0
  for (const item of parsedLines.value) {
    if (item.level === 'error') errors++
    else if (item.level === 'warn') warns++
    else if (item.level === 'info') infos++
    else if (item.level === 'debug') debugs++
  }
  return { errors, warns, infos, debugs }
})

// Filtered Lines according to selected level filter
const filteredLines = computed<ParsedItem[]>(() => {
  const all = parsedLines.value
  switch (levelFilter.value) {
    case 'error':
      return all.filter((l) => l.level === 'error')
    case 'warn':
      return all.filter((l) => l.level === 'error' || l.level === 'warn')
    case 'info':
      return all.filter((l) => l.level !== 'debug')
    case 'debug':
      return all.filter((l) => l.level === 'debug')
    default:
      return all
  }
})

// Filter pills configuration
const filterOptions = computed(() => [
  { id: 'all' as const, label: 'All', count: parsedLines.value.length },
  { id: 'error' as const, label: 'Errors', count: levelCounts.value.errors },
  { id: 'warn' as const, label: 'Warnings+', count: levelCounts.value.errors + levelCounts.value.warns },
  { id: 'info' as const, label: 'Info+', count: levelCounts.value.infos },
  { id: 'debug' as const, label: 'Debug', count: levelCounts.value.debugs }
])

// Search Regex Builder
const searchRegex = computed<RegExp | null>(() => {
  if (!searchQuery.value) {
    regexError.value = null
    return null
  }
  try {
    regexError.value = null
    const pattern = isRegex.value
      ? searchQuery.value
      : searchQuery.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(pattern, caseSensitive.value ? 'g' : 'gi')
  } catch (e) {
    regexError.value = e instanceof Error ? e.message : 'Invalid regex'
    return null
  }
})

// Search Matches Index across filtered lines
interface SearchIndex {
  matchCount: number
  matches: Array<{ filteredIndex: number; matchIndexInLine: number }>
  lineMatchStarts: number[]
}

const searchIndex = computed<SearchIndex>(() => {
  const re = searchRegex.value
  if (!re) {
    return { matchCount: 0, matches: [], lineMatchStarts: [] }
  }

  const items = filteredLines.value
  const matches: Array<{ filteredIndex: number; matchIndexInLine: number }> = []
  const lineMatchStarts = new Array<number>(items.length).fill(-1)

  let globalCounter = 0
  let flags = re.flags
  if (!flags.includes('g')) flags += 'g'
  const searchRe = new RegExp(re.source, flags)

  for (let i = 0; i < items.length; i++) {
    const text = items[i].text
    searchRe.lastIndex = 0
    let match: RegExpExecArray | null
    let lineHasMatch = false
    let matchInLine = 0

    while ((match = searchRe.exec(text)) !== null) {
      if (match[0].length === 0) {
        searchRe.lastIndex++
        continue
      }
      if (!lineHasMatch) {
        lineMatchStarts[i] = globalCounter
        lineHasMatch = true
      }
      matches.push({ filteredIndex: i, matchIndexInLine: matchInLine })
      matchInLine++
      globalCounter++
    }
  }

  return {
    matchCount: matches.length,
    matches,
    lineMatchStarts
  }
})

// Keep active match index in bounds when matches count changes
watch(
  () => searchIndex.value.matchCount,
  (newCount) => {
    if (newCount === 0) {
      activeMatchIndex.value = 0
    } else if (activeMatchIndex.value >= newCount) {
      activeMatchIndex.value = newCount - 1
    }
  }
)

function jumpToActiveMatch(): void {
  const match = searchIndex.value.matches[activeMatchIndex.value]
  if (!match) return
  autoScroll.value = false
  rowVirtualizer.value.scrollToIndex(match.filteredIndex, { align: 'center' })
}

function nextMatch(): void {
  if (searchIndex.value.matchCount === 0) return
  activeMatchIndex.value = (activeMatchIndex.value + 1) % searchIndex.value.matchCount
  jumpToActiveMatch()
}

function prevMatch(): void {
  if (searchIndex.value.matchCount === 0) return
  activeMatchIndex.value =
    (activeMatchIndex.value - 1 + searchIndex.value.matchCount) % searchIndex.value.matchCount
  jumpToActiveMatch()
}

function toggleSearch(): void {
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) {
    void nextTick(() => searchBarRef.value?.focusInput())
  }
}

function closeSearch(): void {
  searchOpen.value = false
  scrollEl.value?.focus()
}

// TanStack Virtualizer for ultra-smooth 60fps rendering
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: filteredLines.value.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => 22,
    overscan: 20,
    getItemKey: (index: number) => filteredLines.value[index]?.originalIndex ?? index
  }))
)

const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems())
const totalSize = computed(() => rowVirtualizer.value.getTotalSize())

function measureRow(el: Element | ComponentPublicInstance | null): void {
  if (el instanceof Element) {
    rowVirtualizer.value.measureElement(el)
  }
}

// Scroll & Auto-Scroll Management
function isNearBottom(): boolean {
  const el = scrollEl.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

function onScroll(): void {
  const near = isNearBottom()
  if (near) {
    autoScroll.value = true
    newLinesCount.value = 0
  } else {
    autoScroll.value = false
  }
}

function scrollToBottom(): void {
  const el = scrollEl.value
  if (!el) return
  autoScroll.value = true
  newLinesCount.value = 0
  if (filteredLines.value.length > 0) {
    rowVirtualizer.value.scrollToIndex(filteredLines.value.length - 1, { align: 'end' })
  }
}

watch(lines, (nextLines, prevLines) => {
  const added = nextLines.length - (prevLines?.length || 0)
  if (autoScroll.value) {
    void nextTick(scrollToBottom)
  } else if (added > 0) {
    newLinesCount.value += added
  }
})

// Clear view
function onClear(): void {
  tailStreams.clear(props.tailId)
  newLinesCount.value = 0
}

// Copy to clipboard
async function onCopy(): Promise<void> {
  const text = filteredLines.value.map((l) => l.text).join('\n')
  if (!text) {
    notify.error('Nothing to copy', 'Log view is empty')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    notify.success('Copied to clipboard', `${filteredLines.value.length} lines copied`)
  } catch (e) {
    notify.error('Copy failed', e instanceof Error ? e.message : String(e))
  }
}

// Keyboard shortcut listener for Ctrl+F
function onWindowKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLElement && e.target.isContentEditable)
    ) {
      if (!scrollEl.value?.contains(e.target) && !searchBarRef.value) {
        return
      }
    }
    const el = scrollEl.value
    if (el && (el.contains(document.activeElement) || document.activeElement === document.body)) {
      e.preventDefault()
      searchOpen.value = true
      void nextTick(() => searchBarRef.value?.focusInput())
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  void nextTick(scrollToBottom)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKeydown)
})
</script>

<template>
  <div class="relative flex h-full flex-col overflow-hidden bg-default">
    <!-- Top Toolbar -->
    <div
      class="flex h-8 shrink-0 items-center justify-between border-b border-muted bg-muted/40 px-2 text-xs select-none"
    >
      <!-- Left: Status Indicator, Line Count, and Filter Pills -->
      <div class="flex items-center gap-2 overflow-x-auto scrollbar-none py-1">
        <!-- Live status indicator -->
        <div class="flex items-center gap-1.5 px-1 font-mono text-[11px]">
          <span v-if="!ended && !error" class="relative flex size-2">
            <span
              class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
            />
            <span class="relative inline-flex rounded-full size-2 bg-emerald-500" />
          </span>
          <span v-else-if="error" class="inline-flex rounded-full size-2 bg-rose-500" />
          <span v-else class="inline-flex rounded-full size-2 bg-neutral-400" />

          <span
            class="font-semibold uppercase tracking-wider text-[10px]"
            :class="
              !ended && !error
                ? 'text-emerald-500'
                : error
                  ? 'text-rose-500'
                  : 'text-muted'
            "
          >
            {{ !ended && !error ? 'Live' : error ? 'Error' : 'Ended' }}
          </span>
        </div>

        <div class="h-3.5 w-px bg-muted" />

        <!-- Line Count -->
        <span class="font-mono text-[11px] text-muted whitespace-nowrap">
          {{ filteredLines.length.toLocaleString() }}
          <span v-if="filteredLines.length !== lines.length" class="text-dimmed">
            / {{ lines.length.toLocaleString() }}
          </span>
          lines
        </span>

        <div class="h-3.5 w-px bg-muted" />

        <!-- Log Level Filters -->
        <div class="flex items-center rounded-md bg-muted/60 p-0.5 text-xs">
          <button
            v-for="opt in filterOptions"
            :key="opt.id"
            class="rounded px-1.5 py-0.5 text-[11px] font-mono transition-colors"
            :class="
              levelFilter === opt.id
                ? 'bg-default font-medium text-default shadow-xs'
                : 'text-muted hover:text-default'
            "
            @click="levelFilter = opt.id"
          >
            {{ opt.label }}
            <span
              v-if="opt.count > 0 && opt.id !== 'all'"
              class="ml-0.5 text-[10px] opacity-75"
            >
              {{ opt.count }}
            </span>
          </button>
        </div>
      </div>

      <!-- Right: Action Buttons -->
      <div class="flex items-center gap-1 shrink-0 ml-2">
        <UTooltip :text="wrapLines ? 'Disable line wrap' : 'Wrap long lines'">
          <UButton
            icon="i-lucide-wrap-text"
            size="xs"
            :color="wrapLines ? 'primary' : 'neutral'"
            :variant="wrapLines ? 'soft' : 'ghost'"
            @click="wrapLines = !wrapLines"
          />
        </UTooltip>

        <UTooltip :text="autoScroll ? 'Following output (auto-scroll)' : 'Resume auto-scroll'">
          <UButton
            icon="i-lucide-arrow-down-to-line"
            size="xs"
            :color="autoScroll ? 'primary' : 'neutral'"
            :variant="autoScroll ? 'soft' : 'ghost'"
            @click="scrollToBottom"
          />
        </UTooltip>

        <UTooltip text="Copy lines (Ctrl+C)">
          <UButton
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="onCopy"
          />
        </UTooltip>

        <UTooltip text="Clear log view">
          <UButton
            icon="i-lucide-trash-2"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="onClear"
          />
        </UTooltip>

        <UTooltip text="Find in log (Ctrl+F)">
          <UButton
            icon="i-lucide-search"
            size="xs"
            :color="searchOpen ? 'primary' : 'neutral'"
            :variant="searchOpen ? 'soft' : 'ghost'"
            @click="toggleSearch"
          />
        </UTooltip>
      </div>
    </div>

    <!-- Collapsible Search Bar -->
    <Transition name="fade">
      <LogSearchBar
        v-if="searchOpen"
        ref="searchBarRef"
        v-model="searchQuery"
        v-model:case-sensitive="caseSensitive"
        v-model:is-regex="isRegex"
        :match-count="searchIndex.matchCount"
        :current-match="searchIndex.matchCount > 0 ? activeMatchIndex + 1 : 0"
        :regex-error="regexError"
        @next="nextMatch"
        @prev="prevMatch"
        @close="closeSearch"
      />
    </Transition>

    <!-- Virtualized Log Line Viewer -->
    <div
      ref="scrollEl"
      tabindex="0"
      class="min-h-0 flex-1 overflow-auto bg-default font-mono text-[11px] leading-relaxed outline-none"
      @scroll="onScroll"
    >
      <div
        :style="{
          height: `${totalSize}px`,
          minWidth: '100%',
          width: wrapLines ? '100%' : 'max-content',
          position: 'relative'
        }"
      >
        <div
          v-for="virtualRow in virtualRows"
          :key="String(virtualRow.key)"
          :ref="measureRow"
          :data-index="virtualRow.index"
          :style="{
            position: 'absolute',
            top: 0,
            left: 0,
            width: wrapLines ? '100%' : 'max-content',
            minWidth: '100%',
            transform: `translateY(${virtualRow.start}px)`
          }"
          class="flex items-start hover:bg-muted/30 transition-colors"
          :class="getLogLevelStyles(filteredLines[virtualRow.index].level).bgClass"
        >
          <!-- Left border color accent -->
          <div
            class="self-stretch w-1 shrink-0"
            :class="getLogLevelStyles(filteredLines[virtualRow.index].level).borderClass"
          />

          <!-- Line number gutter -->
          <div
            class="w-12 shrink-0 select-none pr-2.5 text-right font-mono text-[10px] text-muted/60"
          >
            {{ filteredLines[virtualRow.index].originalIndex + 1 }}
          </div>

          <!-- Log Level Tag / Badge if not default -->
          <div class="w-10 shrink-0 select-none text-center">
            <span
              v-if="getLogLevelStyles(filteredLines[virtualRow.index].level).badgeText"
              class="inline-block rounded px-1 text-[9px] font-bold leading-tight"
              :class="getLogLevelStyles(filteredLines[virtualRow.index].level).badgeClass"
            >
              {{ getLogLevelStyles(filteredLines[virtualRow.index].level).badgeText }}
            </span>
          </div>

          <!-- Log line text with search highlights -->
          <div
            class="flex-1 px-1.5"
            :class="[
              wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
              getLogLevelStyles(filteredLines[virtualRow.index].level).textClass
            ]"
          >
            <template
              v-for="(chunk, cIdx) in splitLineMatches(
                filteredLines[virtualRow.index].text,
                searchIndex.lineMatchStarts[virtualRow.index] >= 0 ? searchRegex : null,
                searchIndex.lineMatchStarts[virtualRow.index],
                activeMatchIndex
              )"
              :key="cIdx"
            >
              <mark
                v-if="chunk.isMatch"
                :class="
                  chunk.isActiveMatch
                    ? 'bg-amber-500 text-neutral-950 font-bold rounded-xs px-0.5 shadow-sm ring-1 ring-amber-300'
                    : 'bg-amber-400/35 text-amber-900 dark:text-amber-100 rounded-xs px-0.5'
                "
              >{{ chunk.text }}</mark>
              <span v-else>{{ chunk.text }}</span>
            </template>
          </div>
        </div>
      </div>

      <!-- Empty / Waiting State -->
      <div
        v-if="filteredLines.length === 0"
        class="flex h-full flex-col items-center justify-center gap-1.5 py-12 text-center select-none"
      >
        <UIcon name="i-lucide-scroll-text" class="size-6 text-muted" />
        <p class="text-xs text-muted">
          {{ lines.length === 0 ? 'Waiting for output…' : 'No logs match the current filter' }}
        </p>
      </div>
    </div>

    <!-- Error Banner if Stream Failed -->
    <div
      v-if="error"
      class="flex items-center gap-2 border-t border-muted bg-rose-500/10 px-3 py-1.5 text-xs text-error"
    >
      <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0 text-error" />
      <span class="truncate">{{ error }}</span>
    </div>

    <!-- Stream Ended Banner -->
    <div
      v-else-if="ended"
      class="border-t border-muted bg-muted/20 px-3 py-1 text-[11px] text-muted text-center"
    >
      Stream ended
    </div>

    <!-- Floating Jump to Latest Button -->
    <Transition name="fade">
      <UButton
        v-if="!autoScroll && lines.length > 0"
        :label="newLinesCount > 0 ? `Jump to latest (+${newLinesCount})` : 'Jump to latest'"
        icon="i-lucide-arrow-down"
        size="xs"
        color="primary"
        variant="solid"
        class="absolute bottom-3 right-4 shadow-md transition-transform active:scale-95"
        @click="scrollToBottom"
      />
    </Transition>
  </div>
</template>

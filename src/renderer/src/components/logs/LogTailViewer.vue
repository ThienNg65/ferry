<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useTailStreamsStore } from '../../stores/tailStreams.store'
import { useNotify } from '../../composables/useNotify'
import { useDockState } from '../../composables/useDockState'
import {
  getLogLevelStyles,
  parseLogLevel,
  parseTimestampPrefix,
  splitLineMatches,
  type LogLevel
} from '../../utils/logParser'
import LogSearchBar from './LogSearchBar.vue'

const props = defineProps<{ tailId: string }>()

const tailStreams = useTailStreamsStore()
const notify = useNotify()
const { isMaximized, toggleMaximize } = useDockState()

const lines = computed(() => tailStreams.linesMap[props.tailId] || [])
const ended = computed(() => tailStreams.endedMap[props.tailId] || false)
const error = computed(() => tailStreams.errorMap[props.tailId])

// UI & Controls State
const scrollEl = ref<HTMLDivElement | null>(null)
const searchBarRef = ref<InstanceType<typeof LogSearchBar> | null>(null)
const autoScroll = ref(true)
const newLinesCount = ref(0)
const levelFilter = ref<'all' | 'error' | 'warn' | 'info' | 'debug'>('all')

// Font size & line wrap preferences stored in localStorage
const FONT_SIZE_KEY = 'ferry:tail:fontSize'
const WRAP_LINES_KEY = 'ferry:tail:wrapLines'
type TailFontSize = 'sm' | 'md' | 'lg'
const fontSize = ref<TailFontSize>((localStorage.getItem(FONT_SIZE_KEY) as TailFontSize) || 'md')
const wrapLines = ref(localStorage.getItem(WRAP_LINES_KEY) === 'true')

function cycleFontSize(): void {
  const next: Record<TailFontSize, TailFontSize> = { sm: 'md', md: 'lg', lg: 'sm' }
  fontSize.value = next[fontSize.value]
  localStorage.setItem(FONT_SIZE_KEY, fontSize.value)
}

function toggleWrap(): void {
  wrapLines.value = !wrapLines.value
  localStorage.setItem(WRAP_LINES_KEY, String(wrapLines.value))
}

const fontSizeClass = computed(() => {
  switch (fontSize.value) {
    case 'sm':
      return 'text-[10px]'
    case 'lg':
      return 'text-[13px]'
    default:
      return 'text-[11px]'
  }
})

const rowEstimateSize = computed(() => {
  switch (fontSize.value) {
    case 'sm':
      return 19
    case 'lg':
      return 25
    default:
      return 22
  }
})

// Search State
const searchOpen = ref(false)
const searchQuery = ref('')
const caseSensitive = ref(false)
const isRegex = ref(false)
const filterOnly = ref(false)
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

// Filtered Lines according to selected level filter and search filter mode
const filteredLines = computed<ParsedItem[]>(() => {
  let all = parsedLines.value
  switch (levelFilter.value) {
    case 'error':
      all = all.filter((l) => l.level === 'error')
      break
    case 'warn':
      all = all.filter((l) => l.level === 'error' || l.level === 'warn')
      break
    case 'info':
      all = all.filter((l) => l.level !== 'debug')
      break
    case 'debug':
      all = all.filter((l) => l.level === 'debug')
      break
  }

  if (filterOnly.value && searchRegex.value) {
    const re = searchRegex.value
    all = all.filter((l) => {
      re.lastIndex = 0
      return re.test(l.text)
    })
  }

  return all
})

// Filter pills configuration
const filterOptions = computed(() => [
  { id: 'all' as const, label: 'All', count: parsedLines.value.length },
  { id: 'error' as const, label: 'Errors', count: levelCounts.value.errors },
  { id: 'warn' as const, label: 'Warnings+', count: levelCounts.value.errors + levelCounts.value.warns },
  { id: 'info' as const, label: 'Info+', count: levelCounts.value.infos },
  { id: 'debug' as const, label: 'Debug', count: levelCounts.value.debugs }
])

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
    estimateSize: () => rowEstimateSize.value,
    overscan: 25,
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
    notify.success('Copied to clipboard', `${filteredLines.value.length.toLocaleString()} lines copied`)
  } catch (e) {
    notify.error('Copy failed', e instanceof Error ? e.message : String(e))
  }
}

// Export log buffer to a downloaded file
function onExport(): void {
  const text = filteredLines.value.map((l) => l.text).join('\n')
  if (!text) {
    notify.error('Nothing to export', 'Log view is empty')
    return
  }
  const tabInfo = tailStreams.tabs.find((t) => t.tailId === props.tailId)
  const filename = tabInfo ? tabInfo.remotePath.split(/[\\/]/).pop() || 'log' : 'tail'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${timestamp}.log`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  notify.success('Log exported', `${filteredLines.value.length.toLocaleString()} lines saved`)
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
        <!-- Interactive Live / Paused status indicator -->
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px] transition-all cursor-pointer border select-none"
          :class="
            !ended && !error
              ? autoScroll
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-semibold'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold hover:bg-amber-500/20'
              : error
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400 font-semibold'
                : 'bg-muted border-default text-muted'
          "
          :title="!ended && !error && !autoScroll ? 'Click to resume live following' : undefined"
          @click="!ended && !error && !autoScroll ? scrollToBottom() : undefined"
        >
          <!-- Pulsing dot when live following -->
          <span v-if="!ended && !error && autoScroll" class="relative flex size-2">
            <span
              class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
            />
            <span class="relative inline-flex rounded-full size-2 bg-emerald-500" />
          </span>
          <!-- Paused dot -->
          <span v-else-if="!ended && !error && !autoScroll" class="inline-flex rounded-full size-2 bg-amber-500" />
          <span v-else-if="error" class="inline-flex rounded-full size-2 bg-rose-500" />
          <span v-else class="inline-flex rounded-full size-2 bg-neutral-400" />

          <span class="uppercase tracking-wider text-[10px]">
            {{
              !ended && !error
                ? autoScroll
                  ? 'Live'
                  : newLinesCount > 0
                    ? `Paused (+${newLinesCount})`
                    : 'Paused'
                : error
                  ? 'Error'
                  : 'Ended'
            }}
          </span>
        </button>

        <div class="h-3.5 w-px bg-muted" />

        <!-- Line Count Summary -->
        <span class="font-mono text-[11px] text-muted whitespace-nowrap">
          <span class="font-semibold text-default">{{ filteredLines.length.toLocaleString() }}</span>
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
            type="button"
            class="rounded px-2 py-0.5 text-[11px] font-mono transition-colors flex items-center gap-1 cursor-pointer"
            :class="
              levelFilter === opt.id
                ? 'bg-default font-semibold text-default shadow-xs border border-default/30'
                : 'text-muted hover:text-default hover:bg-muted/40'
            "
            @click="levelFilter = opt.id"
          >
            <span>{{ opt.label }}</span>
            <span
              v-if="opt.count > 0 && opt.id !== 'all'"
              class="rounded-full px-1 text-[9px] font-bold leading-tight"
              :class="
                opt.id === 'error'
                  ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                  : opt.id === 'warn'
                    ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
                    : 'bg-muted text-dimmed'
              "
            >
              {{ opt.count }}
            </span>
          </button>
        </div>
      </div>

      <!-- Right: Action Buttons -->
      <div class="flex items-center gap-1 shrink-0 ml-2">
        <UTooltip :text="`Font size: ${fontSize.toUpperCase()} (Click to cycle)`">
          <UButton
            :aria-label="`Font size: ${fontSize.toUpperCase()} (Click to cycle)`"
            icon="i-lucide-type"
            size="xs"
            color="neutral"
            variant="ghost"
            class="font-mono text-[11px]"
            @click="cycleFontSize"
          />
        </UTooltip>

        <UTooltip :text="wrapLines ? 'Disable line wrap' : 'Wrap long lines'">
          <UButton
            :aria-label="wrapLines ? 'Disable line wrap' : 'Wrap long lines'"
            icon="i-lucide-wrap-text"
            size="xs"
            :color="wrapLines ? 'primary' : 'neutral'"
            :variant="wrapLines ? 'soft' : 'ghost'"
            @click="toggleWrap"
          />
        </UTooltip>

        <UTooltip :text="autoScroll ? 'Following output (auto-scroll)' : 'Resume auto-scroll'">
          <UButton
            :aria-label="autoScroll ? 'Following output (auto-scroll)' : 'Resume auto-scroll'"
            icon="i-lucide-arrow-down-to-line"
            size="xs"
            :color="autoScroll ? 'primary' : 'neutral'"
            :variant="autoScroll ? 'soft' : 'ghost'"
            @click="scrollToBottom"
          />
        </UTooltip>

        <UTooltip text="Export log to file">
          <UButton
            aria-label="Export log to file"
            icon="i-lucide-download"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="onExport"
          />
        </UTooltip>

        <UTooltip text="Copy lines (Ctrl+C)">
          <UButton
            aria-label="Copy lines (Ctrl+C)"
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="onCopy"
          />
        </UTooltip>

        <UTooltip text="Clear log view">
          <UButton
            aria-label="Clear log view"
            icon="i-lucide-trash-2"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="onClear"
          />
        </UTooltip>

        <UTooltip text="Find & Filter in log (Ctrl+F)">
          <UButton
            aria-label="Find & Filter in log (Ctrl+F)"
            icon="i-lucide-search"
            size="xs"
            :color="searchOpen ? 'primary' : 'neutral'"
            :variant="searchOpen ? 'soft' : 'ghost'"
            @click="toggleSearch"
          />
        </UTooltip>

        <div class="h-3.5 w-px bg-muted mx-0.5" />

        <UTooltip :text="isMaximized ? 'Restore dock height' : 'Maximize log viewer'">
          <UButton
            :aria-label="isMaximized ? 'Restore dock height' : 'Maximize log viewer'"
            :icon="isMaximized ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
            size="xs"
            :color="isMaximized ? 'primary' : 'neutral'"
            :variant="isMaximized ? 'soft' : 'ghost'"
            @click="toggleMaximize"
          />
        </UTooltip>
      </div>
    </div>

    <!-- Collapsible Search & Filter Bar -->
    <Transition name="fade">
      <LogSearchBar
        v-if="searchOpen"
        ref="searchBarRef"
        v-model="searchQuery"
        v-model:case-sensitive="caseSensitive"
        v-model:is-regex="isRegex"
        v-model:filter-only="filterOnly"
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
      class="min-h-0 flex-1 overflow-auto bg-default font-mono leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      :class="fontSizeClass"
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
          class="flex items-start hover:bg-muted/40 transition-colors"
          :class="getLogLevelStyles(filteredLines[virtualRow.index].level).bgClass"
        >
          <!-- Left border color accent bar -->
          <div
            class="self-stretch w-1 shrink-0"
            :class="getLogLevelStyles(filteredLines[virtualRow.index].level).borderClass"
          />

          <!-- Line number gutter with vertical divider -->
          <div
            class="w-12 shrink-0 select-none pr-2.5 text-right font-mono text-[10px] tabular-nums text-muted border-r border-default/20"
          >
            {{ filteredLines[virtualRow.index].originalIndex + 1 }}
          </div>

          <!-- Log line content area: compact badge (no blank space) + formatted text -->
          <div
            class="flex-1 min-w-0 pl-2 pr-2"
            :class="[
              wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
              getLogLevelStyles(filteredLines[virtualRow.index].level).textClass
            ]"
          >
            <!-- Log Level Tag / Badge if not default -->
            <span
              v-if="getLogLevelStyles(filteredLines[virtualRow.index].level).badgeText"
              class="inline-block rounded px-1 py-0.2 mr-1.5 text-[9px] font-bold leading-none align-middle select-none"
              :class="getLogLevelStyles(filteredLines[virtualRow.index].level).badgeClass"
            >
              {{ getLogLevelStyles(filteredLines[virtualRow.index].level).badgeText }}
            </span>

            <!-- Search Highlight rendering -->
            <template v-if="searchRegex">
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
                      ? 'bg-amber-400 text-neutral-950 font-bold rounded-xs px-0.5 shadow-sm ring-2 ring-primary'
                      : 'bg-amber-300/80 dark:bg-amber-500/40 text-neutral-950 dark:text-neutral-100 rounded-xs px-0.5 ring-1 ring-amber-400/40'
                  "
                >{{ chunk.text }}</mark>
                <span v-else>{{ chunk.text }}</span>
              </template>
            </template>

            <!-- Normal rendering: subtle timestamp styling for easy message scanning -->
            <template v-else>
              <span
                v-if="parseTimestampPrefix(filteredLines[virtualRow.index].text).timestamp"
                class="text-muted text-[10px] font-mono mr-1.5 select-text tracking-tight inline-block"
              >{{ parseTimestampPrefix(filteredLines[virtualRow.index].text).timestamp }}</span>
              <span>{{ parseTimestampPrefix(filteredLines[virtualRow.index].text).rest }}</span>
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
      role="alert"
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
      <button
        v-if="!autoScroll && lines.length > 0"
        type="button"
        class="absolute bottom-3 right-5 z-20 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg backdrop-blur-md ring-1 ring-primary/40 bg-primary text-primary-foreground transition-all hover:scale-105 active:scale-95 cursor-pointer"
        @click="scrollToBottom"
      >
        <UIcon name="i-lucide-arrow-down" class="size-3.5" />
        <span>{{ newLinesCount > 0 ? `Jump to latest (+${newLinesCount})` : 'Jump to latest' }}</span>
      </button>
    </Transition>
  </div>
</template>

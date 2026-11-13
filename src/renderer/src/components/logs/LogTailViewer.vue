<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { MAX_TAIL_LINES, useTailStreamsStore } from '../../stores/tailStreams.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useNotify } from '../../composables/useNotify'
import { useDockState } from '../../composables/useDockState'
import {
  extractJsonPayload,
  getLogLevelStyles,
  tokenizeLogLine
} from '../../utils/logParser'
import { reconcileTailLines, type TailLineCache } from '../../utils/tailLineCache'
import LogSearchBar from './LogSearchBar.vue'
import LogLineInspector from './LogLineInspector.vue'
import { KEYWORD_CLASSES, buildKeywordRegex } from '../../utils/keywordHighlight'

const props = defineProps<{ tailId: string }>()

const tailStreams = useTailStreamsStore()
const sessions = useSessionsStore()
const notify = useNotify()
const { isMaximized, toggleMaximize } = useDockState()

const lines = computed(() => tailStreams.linesMap[props.tailId] || [])
const ended = computed(() => tailStreams.endedMap[props.tailId] || false)
const error = computed(() => tailStreams.errorMap[props.tailId])
const currentTab = computed(() => tailStreams.tabs.find((t) => t.tailId === props.tailId))
const sessionLabel = computed(() => {
  const sid = currentTab.value?.sessionId
  if (!sid) return null
  const tab = sessions.tabs.find((t) => t.sessionId === sid)
  return tab?.label ?? tab?.hostLabel ?? null
})
const bufferPct = computed(() => Math.min(100, Math.round((lines.value.length / MAX_TAIL_LINES) * 100)))

// UI & Controls State
const scrollEl = ref<HTMLDivElement | null>(null)
const searchBarRef = ref<InstanceType<typeof LogSearchBar> | null>(null)
const autoScroll = ref(true)
const newLinesCount = ref(0)
const restarting = ref(false)
const levelFilter = ref<'all' | 'error' | 'warn' | 'info' | 'debug'>('all')
const pinnedOnly = ref(false)
const selectedOriginalIndex = ref<number | null>(null)

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
      return 'text-2xs'
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

// Search & Keyword Highlight State
const searchOpen = ref(false)
const searchQuery = ref('')
const caseSensitive = ref(false)
const isRegex = ref(false)
const filterOnly = ref(false)
const regexError = ref<string | null>(null)
const activeMatchIndex = ref(0)
const keywords = ref<string[]>([])
const keywordRegex = computed(() => buildKeywordRegex(keywords.value))

function addKeyword(value: string): void {
  const trimmed = value.trim()
  if (trimmed && !keywords.value.includes(trimmed) && keywords.value.length < KEYWORD_CLASSES.length) {
    keywords.value = [...keywords.value, trimmed]
  }
}

function removeKeyword(index: number): void {
  keywords.value = keywords.value.filter((_, i) => i !== index)
}

function clearKeywords(): void {
  keywords.value = []
}

// Pinned Lines
const pinnedSet = computed(() => new Set(tailStreams.pinnedLinesMap[props.tailId] || []))
const pinnedCount = computed(() => pinnedSet.value.size)

watch(pinnedCount, (count) => {
  if (count === 0) {
    pinnedOnly.value = false
  }
})

// Reuse parsed entries across updates instead of reclassifying the entire 5,000-line window.
let parsedCache: TailLineCache | null = null
let cachedTailId: string | null = null
const parsedLines = computed(() => {
  const tailId = props.tailId
  parsedCache = reconcileTailLines(
    lines.value,
    tailStreams.droppedCountMap[tailId] || 0,
    cachedTailId === tailId ? parsedCache : null
  )
  cachedTailId = tailId
  return parsedCache.items
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

// Filtered Lines according to selected level, pins, and search filter mode
const filteredLines = computed(() => {
  let all = parsedLines.value
  switch (levelFilter.value) {
    case 'error':
      all = all.filter((l) => l.level === 'error')
      break
    case 'warn':
      all = all.filter((l) => l.level === 'error' || l.level === 'warn')
      break
    case 'info':
      all = all.filter((l) => l.level === 'info')
      break
    case 'debug':
      all = all.filter((l) => l.level === 'debug')
      break
  }

  if (pinnedOnly.value && pinnedSet.value.size > 0) {
    all = all.filter((l) => pinnedSet.value.has(l.originalIndex))
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

// Filter pills configuration (every count matches its exact filter predicate)
const filterOptions = computed(() => [
  { id: 'all' as const, label: 'All', count: parsedLines.value.length },
  { id: 'error' as const, label: 'Errors', count: levelCounts.value.errors },
  { id: 'warn' as const, label: 'Warn+', count: levelCounts.value.errors + levelCounts.value.warns },
  { id: 'info' as const, label: 'Info', count: levelCounts.value.infos },
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

// TanStack Virtualizer for 60fps rendering
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: filteredLines.value.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => rowEstimateSize.value,
    overscan: 12,
    getItemKey: (index: number) => filteredLines.value[index]?.sequence ?? index
  }))
)

const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems())
const totalSize = computed(() => rowVirtualizer.value.getTotalSize())

function measureRow(el: Element | ComponentPublicInstance | null): void {
  if (el instanceof Element) {
    rowVirtualizer.value.measureElement(el)
  }
}

// Wrapped lines and font changes invalidate TanStack's cached measurements.
watch([fontSize, wrapLines], async () => {
  await nextTick()
  rowVirtualizer.value.measure()
  if (autoScroll.value) scrollToBottom()
})

// Selected Line & Inspector
const selectedFilteredIndex = computed(() =>
  selectedOriginalIndex.value === null
    ? -1
    : filteredLines.value.findIndex((l) => l.originalIndex === selectedOriginalIndex.value)
)
const selectedItem = computed(() =>
  selectedFilteredIndex.value >= 0 ? filteredLines.value[selectedFilteredIndex.value] : null
)

function selectLine(originalIndex: number): void {
  selectedOriginalIndex.value = selectedOriginalIndex.value === originalIndex ? null : originalIndex
  if (selectedOriginalIndex.value !== null) autoScroll.value = false
}

function stepSelectedLine(delta: -1 | 1): void {
  const idx = selectedFilteredIndex.value
  if (idx === -1) return
  const nextIdx = idx + delta
  if (nextIdx < 0 || nextIdx >= filteredLines.value.length) return
  selectedOriginalIndex.value = filteredLines.value[nextIdx].originalIndex
  autoScroll.value = false
  rowVirtualizer.value.scrollToIndex(nextIdx, { align: 'auto' })
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

function toggleAutoScroll(): void {
  if (ended.value || error.value) return
  if (autoScroll.value) {
    autoScroll.value = false
  } else {
    scrollToBottom()
  }
}

// The rolling buffer length stays capped; count actual arrivals rather than growth.
watch(
  () => tailStreams.receivedCountMap[props.tailId] || 0,
  (received, previous = 0) => {
    const added = received - previous
    if (added < 0) {
      newLinesCount.value = 0
    } else if (added > 0 && autoScroll.value) {
      void nextTick(() => {
        if (autoScroll.value) scrollToBottom()
      })
    } else if (added > 0) {
      newLinesCount.value += added
    }
  }
)

watch(
  () => tailStreams.droppedCountMap[props.tailId] || 0,
  (nextDropped, prevDropped = 0) => {
    const delta = nextDropped - prevDropped
    if (delta > 0 && selectedOriginalIndex.value !== null) {
      const shifted = selectedOriginalIndex.value - delta
      selectedOriginalIndex.value = shifted >= 0 ? shifted : null
    }
  }
)

// Stream & Line Actions
function onClear(): void {
  tailStreams.clear(props.tailId)
  newLinesCount.value = 0
  selectedOriginalIndex.value = null
  rowVirtualizer.value.measure()
}

async function onRestart(): Promise<void> {
  if (restarting.value) return
  restarting.value = true
  try {
    await tailStreams.restart(props.tailId)
    autoScroll.value = true
    newLinesCount.value = 0
    selectedOriginalIndex.value = null
    notify.success('Stream restarted')
  } catch (e) {
    notify.error('Failed to restart stream', e instanceof Error ? e.message : String(e))
  } finally {
    restarting.value = false
  }
}

async function copyText(text: string, title: string, description?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    notify.success(title, description)
  } catch (e) {
    notify.error('Copy failed', e instanceof Error ? e.message : String(e))
  }
}

async function onCopyAll(): Promise<void> {
  const text = filteredLines.value.map((l) => l.text).join('\n')
  if (!text) {
    notify.error('Nothing to copy', 'Log view is empty')
    return
  }
  await copyText(text, 'Copied to clipboard', `${filteredLines.value.length.toLocaleString()} lines copied`)
}

async function onCopyPath(): Promise<void> {
  const path = currentTab.value?.remotePath
  if (!path) return
  await copyText(path, 'Path copied', path)
}

function onExport(): void {
  const text = filteredLines.value.map((l) => l.text).join('\n')
  if (!text) {
    notify.error('Nothing to export', 'Log view is empty')
    return
  }
  const filename = currentTab.value ? currentTab.value.remotePath.split(/[\\/]/).pop() || 'log' : 'tail'
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

function hasJsonLine(text: string): boolean {
  if (!text.includes('{') && !text.trimStart().startsWith('[')) return false
  return extractJsonPayload(text) !== null
}

// Keyboard shortcuts
function onViewerKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (selectedOriginalIndex.value !== null) {
      e.preventDefault()
      selectedOriginalIndex.value = null
      return
    }
    if (searchOpen.value) {
      e.preventDefault()
      closeSearch()
      return
    }
  }
  if (e.target instanceof HTMLElement && e.target.closest('button, input, textarea')) {
    return
  }
  if (e.key === 'ArrowUp' && selectedItem.value) {
    e.preventDefault()
    stepSelectedLine(-1)
  } else if (e.key === 'ArrowDown' && selectedItem.value) {
    e.preventDefault()
    stepSelectedLine(1)
  } else if ((e.key === ' ' || e.key.toLowerCase() === 'p') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    toggleAutoScroll()
  } else if (e.key === 'End' || (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey)) {
    e.preventDefault()
    scrollToBottom()
  } else if (e.key === 'Home') {
    e.preventDefault()
    autoScroll.value = false
    if (filteredLines.value.length > 0) {
      rowVirtualizer.value.scrollToIndex(0, { align: 'start' })
    }
  }
}

function onWindowKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    const inSearchBar = searchBarRef.value?.contains(e.target) ?? false
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLElement && e.target.isContentEditable)
    ) {
      if (!scrollEl.value?.contains(e.target) && !inSearchBar) {
        return
      }
    }
    const el = scrollEl.value
    if (
      inSearchBar ||
      (el && (el.contains(document.activeElement) || document.activeElement === document.body))
    ) {
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
    <!-- Tier 1: Stream Context & Health Strip -->
    <div
      v-if="currentTab"
      class="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-muted bg-muted/20 px-2.5 text-2xs select-none"
    >
      <div class="flex items-center gap-2 min-w-0">
        <span
          v-if="sessionLabel"
          class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-default shrink-0"
        >
          <UIcon name="i-lucide-server" class="size-2.5 text-muted" />
          {{ sessionLabel }}
        </span>
        <UTooltip :text="`Click to copy: ${currentTab.remotePath}`">
          <button
            type="button"
            class="flex items-center gap-1 min-w-0 truncate font-mono text-muted hover:text-default transition-colors cursor-pointer"
            @click="onCopyPath"
          >
            <span class="truncate">{{ currentTab.remotePath }}</span>
            <UIcon name="i-lucide-copy" class="size-2.5 shrink-0 opacity-60" />
          </button>
        </UTooltip>
      </div>

      <div class="flex items-center gap-2.5 shrink-0">
        <UTooltip :text="`Rolling buffer: ${lines.length.toLocaleString()} / ${MAX_TAIL_LINES.toLocaleString()} lines (${bufferPct}%)`">
          <div class="flex items-center gap-1.5 font-mono text-[10px] text-muted tabular-nums">
            <span>{{ lines.length.toLocaleString() }} / {{ MAX_TAIL_LINES.toLocaleString() }}</span>
            <div class="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="bufferPct >= 90 ? 'bg-warning' : 'bg-primary/70'"
                :style="{ width: `${bufferPct}%` }"
              />
            </div>
          </div>
        </UTooltip>

        <UButton
          v-if="ended || error"
          label="Restart"
          icon="i-lucide-rotate-cw"
          size="xs"
          color="primary"
          variant="soft"
          :loading="restarting"
          @click="onRestart"
        />
      </div>
    </div>

    <!-- Tier 2: Action & Filter Toolbar -->
    <div
      class="flex h-8 shrink-0 items-center justify-between border-b border-muted bg-muted/40 px-2 text-xs select-none"
    >
      <!-- Left: Status Indicator, Line Count, and Filter Pills -->
      <div class="flex items-center gap-2 overflow-x-auto scrollbar-none py-1">
        <UTooltip
          :text="
            !ended && !error
              ? autoScroll
                ? 'Click to pause auto-scroll (Space)'
                : 'Click to resume live following (Space)'
              : undefined
          "
        >
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-2xs transition-all cursor-pointer border select-none"
            :class="
              !ended && !error
                ? autoScroll
                  ? 'bg-success/10 border-success/30 text-success font-semibold hover:bg-success/15'
                  : 'bg-warning/10 border-warning/30 text-warning font-semibold hover:bg-warning/20'
                : error
                  ? 'bg-error/10 border-error/30 text-error font-semibold'
                  : 'bg-muted border-default text-muted'
            "
            @click="toggleAutoScroll"
          >
            <span v-if="!ended && !error && autoScroll" class="relative flex size-2">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
              <span class="relative inline-flex rounded-full size-2 bg-success" />
            </span>
            <span v-else-if="!ended && !error && !autoScroll" class="inline-flex rounded-full size-2 bg-warning" />
            <span v-else-if="error" class="inline-flex rounded-full size-2 bg-error" />
            <span v-else class="inline-flex rounded-full size-2 bg-accented" />

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
        </UTooltip>

        <div class="h-3.5 w-px bg-muted" />

        <!-- Line Count Summary -->
        <span class="font-mono text-2xs text-muted whitespace-nowrap tabular-nums">
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
            class="rounded px-2 py-0.5 text-2xs font-mono transition-colors flex items-center gap-1 cursor-pointer"
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
              class="rounded-full px-1 text-2xs font-bold leading-tight tabular-nums"
              :class="
                opt.id === 'error'
                  ? 'bg-error/20 text-error'
                  : opt.id === 'warn'
                    ? 'bg-warning/20 text-warning'
                    : 'bg-muted text-dimmed'
              "
            >
              {{ opt.count }}
            </span>
          </button>
        </div>

        <!-- Pinned Lines Filter Pill -->
        <button
          v-if="pinnedCount > 0"
          type="button"
          class="flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-2xs border transition-colors cursor-pointer"
          :class="
            pinnedOnly
              ? 'bg-primary/15 border-primary/40 text-primary font-semibold'
              : 'bg-muted/50 border-muted text-muted hover:text-default'
          "
          @click="pinnedOnly = !pinnedOnly"
        >
          <UIcon name="i-lucide-bookmark" class="size-3" />
          <span>Pinned</span>
          <span class="font-bold tabular-nums">{{ pinnedCount }}</span>
        </button>
      </div>

      <!-- Right: Grouped Action Buttons -->
      <div class="flex items-center gap-1 shrink-0 ml-2">
        <UTooltip :text="`Font size: ${fontSize.toUpperCase()} (Click to cycle)`">
          <UButton
            :aria-label="`Font size: ${fontSize.toUpperCase()} (Click to cycle)`"
            icon="i-lucide-type"
            size="xs"
            color="neutral"
            variant="ghost"
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

        <UTooltip :text="autoScroll ? 'Following output (auto-scroll)' : 'Jump to latest (End)'">
          <UButton
            :aria-label="autoScroll ? 'Following output (auto-scroll)' : 'Jump to latest (End)'"
            icon="i-lucide-arrow-down-to-line"
            size="xs"
            :color="autoScroll ? 'primary' : 'neutral'"
            :variant="autoScroll ? 'soft' : 'ghost'"
            @click="scrollToBottom"
          />
        </UTooltip>

        <div class="h-3.5 w-px bg-muted mx-0.5" />

        <UTooltip text="Find & Highlight (Ctrl+F)">
          <UButton
            aria-label="Find & Highlight (Ctrl+F)"
            icon="i-lucide-search"
            size="xs"
            :color="searchOpen || keywords.length > 0 ? 'primary' : 'neutral'"
            :variant="searchOpen || keywords.length > 0 ? 'soft' : 'ghost'"
            @click="toggleSearch"
          />
        </UTooltip>

        <UTooltip text="Copy visible lines">
          <UButton
            aria-label="Copy visible lines"
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="onCopyAll"
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

    <!-- Collapsible Unified Search & Keyword Highlight Bar -->
    <Transition name="slide-down">
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
        :keywords="keywords"
        @add-keyword="addKeyword"
        @remove-keyword="removeKeyword"
        @clear-keywords="clearKeywords"
        @next="nextMatch"
        @prev="prevMatch"
        @close="closeSearch"
      />
    </Transition>

    <!-- Tier 3: Main Split Body (Virtualized Stream + Slide-over Inspector) -->
    <div class="relative flex min-h-0 flex-1 overflow-hidden">
      <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <!-- Virtualized Log Line Viewer -->
        <div
          ref="scrollEl"
          tabindex="0"
          class="relative min-h-0 flex-1 overflow-auto bg-default font-mono leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          :class="fontSizeClass"
          @scroll="onScroll"
          @keydown="onViewerKeydown"
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
            class="group flex items-start cursor-pointer transition-colors"
            :class="[
              selectedOriginalIndex === filteredLines[virtualRow.index].originalIndex
                ? 'bg-primary/10 ring-1 ring-inset ring-primary/30'
                : [getLogLevelStyles(filteredLines[virtualRow.index].level).bgClass, 'hover:bg-muted/40']
            ]"
            @click="selectLine(filteredLines[virtualRow.index].originalIndex)"
          >
            <!-- Left border color accent bar -->
            <div
              class="self-stretch w-1 shrink-0"
              :class="getLogLevelStyles(filteredLines[virtualRow.index].level).borderClass"
            />

            <!-- Line number gutter -->
            <div
              class="w-12 shrink-0 select-none pr-2.5 text-right font-mono text-[10px] tabular-nums text-muted border-r border-default/20"
            >
              {{ filteredLines[virtualRow.index].originalIndex + 1 }}
            </div>

            <!-- Log line content area -->
            <div
              class="flex-1 min-w-0 pl-2 pr-14"
              :class="[
                wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
                getLogLevelStyles(filteredLines[virtualRow.index].level).textClass
              ]"
            >
              <!-- Log Level Badge -->
              <span
                v-if="getLogLevelStyles(filteredLines[virtualRow.index].level).badgeText"
                class="inline-block rounded px-1 py-0.2 mr-1.5 text-2xs font-bold leading-none align-middle select-none"
                :class="getLogLevelStyles(filteredLines[virtualRow.index].level).badgeClass"
              >
                {{ getLogLevelStyles(filteredLines[virtualRow.index].level).badgeText }}
              </span>

              <!-- JSON Indicator Chip -->
              <span
                v-if="hasJsonLine(filteredLines[virtualRow.index].text)"
                class="inline-block rounded bg-primary/10 px-1 py-0.2 mr-1.5 font-mono text-[9px] font-semibold text-primary ring-1 ring-primary/20 align-middle select-none"
              >
                JSON
              </span>

              <!-- Composed Timestamp + Search + Keyword Tokens -->
              <template
                v-for="tokenized in [
                  tokenizeLogLine(
                    filteredLines[virtualRow.index].text,
                    searchIndex.lineMatchStarts[virtualRow.index] >= 0 ? searchRegex : null,
                    keywordRegex,
                    searchIndex.lineMatchStarts[virtualRow.index],
                    activeMatchIndex
                  )
                ]"
                :key="'tok'"
              >
                <span v-if="tokenized.timestamp" class="text-muted text-[10px] font-mono mr-1.5 select-text tracking-tight inline-block">
                  <template v-for="(tTok, tIdx) in tokenized.timestampTokens" :key="tIdx">
                    <mark
                      v-if="tTok.isMatch"
                      :class="
                        tTok.isActiveMatch
                          ? 'bg-warning text-inverted font-bold rounded-xs px-0.5 shadow-sm ring-2 ring-primary'
                          : 'bg-warning/40 text-default rounded-xs px-0.5 ring-1 ring-warning/40'
                      "
                    >{{ tTok.text }}</mark>
                    <span v-else>{{ tTok.text }}</span>
                  </template>
                </span>

                <template v-for="(rTok, rIdx) in tokenized.restTokens" :key="rIdx">
                  <mark
                    v-if="rTok.isMatch"
                    :class="
                      rTok.isActiveMatch
                        ? 'bg-warning text-inverted font-bold rounded-xs px-0.5 shadow-sm ring-2 ring-primary'
                        : 'bg-warning/40 text-default rounded-xs px-0.5 ring-1 ring-warning/40'
                    "
                  >{{ rTok.text }}</mark>
                  <mark
                    v-else-if="rTok.keywordGroup !== null"
                    class="rounded-xs px-0.5 text-inherit"
                    :class="KEYWORD_CLASSES[rTok.keywordGroup]"
                  >{{ rTok.text }}</mark>
                  <span v-else>{{ rTok.text }}</span>
                </template>
              </template>
            </div>

            <!-- Row Quick Hover Actions (sticky right) -->
            <div
              class="sticky right-1.5 ml-auto flex items-center gap-0.5 self-center rounded bg-default/90 px-1 py-0.5 shadow-xs ring-1 ring-muted backdrop-blur-xs transition-opacity"
              :class="
                pinnedSet.has(filteredLines[virtualRow.index].originalIndex)
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
              "
              @click.stop
            >
              <UTooltip :text="pinnedSet.has(filteredLines[virtualRow.index].originalIndex) ? 'Unpin line' : 'Pin line'">
                <button
                  type="button"
                  :aria-label="pinnedSet.has(filteredLines[virtualRow.index].originalIndex) ? 'Unpin line' : 'Pin line'"
                  class="rounded p-0.5 transition-colors cursor-pointer"
                  :class="
                    pinnedSet.has(filteredLines[virtualRow.index].originalIndex)
                      ? 'text-primary hover:bg-primary/10'
                      : 'text-muted hover:text-default hover:bg-muted'
                  "
                  @click="tailStreams.togglePin(tailId, filteredLines[virtualRow.index].originalIndex)"
                >
                  <UIcon name="i-lucide-bookmark" class="size-3" />
                </button>
              </UTooltip>
              <UTooltip text="Copy line">
                <button
                  type="button"
                  aria-label="Copy line"
                  class="rounded p-0.5 text-muted hover:text-default hover:bg-muted transition-colors cursor-pointer"
                  @click="copyText(filteredLines[virtualRow.index].text, 'Line copied')"
                >
                  <UIcon name="i-lucide-copy" class="size-3" />
                </button>
              </UTooltip>
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

        <!-- Floating Jump to Latest Button -->
        <Transition name="slide-up">
          <button
            v-if="!autoScroll && lines.length > 0"
            type="button"
            class="absolute bottom-3 right-5 z-20 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg backdrop-blur-md ring-1 ring-primary/40 bg-primary text-inverted transition-all hover:scale-105 active:scale-95 cursor-pointer"
            @click="scrollToBottom"
          >
            <UIcon name="i-lucide-arrow-down" class="size-3.5" />
            <span>{{ newLinesCount > 0 ? `Jump to latest (+${newLinesCount})` : 'Jump to latest' }}</span>
          </button>
        </Transition>
      </div>

      <!-- Slide-over Line Inspector Drawer -->
      <Transition name="slide-right">
        <LogLineInspector
          v-if="selectedItem"
          :line-number="selectedItem.originalIndex + 1"
          :text="selectedItem.text"
          :level="selectedItem.level"
          :pinned="pinnedSet.has(selectedItem.originalIndex)"
          :has-prev="selectedFilteredIndex > 0"
          :has-next="selectedFilteredIndex < filteredLines.length - 1"
          @prev="stepSelectedLine(-1)"
          @next="stepSelectedLine(1)"
          @toggle-pin="tailStreams.togglePin(tailId, selectedItem.originalIndex)"
          @close="selectedOriginalIndex = null"
        />
      </Transition>
    </div>

    <!-- Error Banner if Stream Failed -->
    <div
      v-if="error"
      role="alert"
      class="flex items-center justify-between gap-2 border-t border-muted bg-error/10 px-3 py-1.5 text-xs text-error"
    >
      <div class="flex items-center gap-2 min-w-0">
        <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0 text-error" />
        <span class="truncate">{{ error }}</span>
      </div>
      <UButton
        label="Restart stream"
        icon="i-lucide-rotate-cw"
        size="xs"
        color="error"
        variant="soft"
        :loading="restarting"
        @click="onRestart"
      />
    </div>

    <!-- Stream Ended Banner -->
    <div
      v-else-if="ended"
      class="flex items-center justify-center gap-2 border-t border-muted bg-muted/20 px-3 py-1 text-2xs text-muted"
    >
      <span>Stream ended</span>
      <UButton
        label="Restart"
        icon="i-lucide-rotate-cw"
        size="xs"
        color="neutral"
        variant="ghost"
        :loading="restarting"
        @click="onRestart"
      />
    </div>
  </div>
</template>

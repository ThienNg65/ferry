<script lang="ts">
import { ref as moduleRef } from 'vue'

const FONT_SIZE_KEY = 'ferry:tail:fontSize'
const WRAP_LINES_KEY = 'ferry:tail:wrapLines'
type TailFontSize = 'sm' | 'md' | 'lg'

function loadFontSize(): TailFontSize {
  try {
    const raw = localStorage.getItem(FONT_SIZE_KEY)
    return raw === 'sm' || raw === 'md' || raw === 'lg' ? raw : 'md'
  } catch {
    return 'md'
  }
}

function loadWrapLines(): boolean {
  try {
    return localStorage.getItem(WRAP_LINES_KEY) === 'true'
  } catch {
    return false
  }
}

const fontSize = moduleRef<TailFontSize>(loadFontSize())
const wrapLines = moduleRef<boolean>(loadWrapLines())
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { MAX_TAIL_LINES, useTailStreamsStore } from '../../stores/tailStreams.store'
import { useCompanionStore } from '../../stores/companion.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useNotify } from '../../composables/useNotify'
import {
  buildSafeSearchRegex,
  extractJsonPayload,
  getLogLevelStyles,
  tokenizeLogLine
} from '../../utils/logParser'
import { reconcileTailLines, type TailLineCache } from '../../utils/tailLineCache'
import LogSearchBar from './LogSearchBar.vue'
import LogLineInspector from './LogLineInspector.vue'
import LogRail from './LogRail.vue'
import { tailControls } from '../../composables/useTailControls'
import { useDebouncedRef } from '../../composables/useDebouncedRef'
import { KEYWORD_CLASSES, buildKeywordRegex } from '../../utils/keywordHighlight'

const MAX_REGEX_LINE_LENGTH = 16_384
const MAX_MATCHES_PER_LINE = 200
const MAX_JSON_LINE_LENGTH = 32_768

const props = withDefaults(defineProps<{ tailId: string; active?: boolean }>(), { active: true })
const isActive = computed(() => props.active)

const tailStreams = useTailStreamsStore()
const companion = useCompanionStore()
const sessions = useSessionsStore()
const notify = useNotify()

const lines = computed(() => tailStreams.linesMap[props.tailId] || [])
const ended = computed(() => tailStreams.endedMap[props.tailId] || false)
const error = computed(() => tailStreams.errorMap[props.tailId])
const streamStatus = computed<'connecting' | 'streaming' | 'ended' | 'error'>(() => {
  if (error.value) return 'error'
  if (ended.value) return 'ended'
  return tailStreams.statusMap?.[props.tailId] ?? (lines.value.length > 0 ? 'streaming' : 'connecting')
})
const currentTab = computed(() => tailStreams.tabs.find((t) => t.tailId === props.tailId))
const sessionLabel = computed(() => {
  const sid = currentTab.value?.sessionId
  if (!sid) return null
  const tab = sessions.tabs.find((t) => t.sessionId === sid)
  return tab?.label ?? tab?.hostLabel ?? null
})
const bufferPct = computed(() => Math.min(100, Math.round((lines.value.length / MAX_TAIL_LINES) * 100)))

// UI & Controls State
const rootEl = ref<HTMLDivElement | null>(null)
const scrollEl = ref<HTMLDivElement | null>(null)
const searchBarRef = ref<InstanceType<typeof LogSearchBar> | null>(null)
const autoScroll = ref(true)
const newLinesCount = ref(0)
const restarting = ref(false)
const levelFilter = ref<'all' | 'error' | 'warn' | 'info' | 'debug'>('all')
const pinnedOnly = ref(false)
const selectedOriginalIndex = ref<number | null>(null)

function setFontSize(size: TailFontSize): void {
  fontSize.value = size
  try {
    localStorage.setItem(FONT_SIZE_KEY, size)
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

function toggleWrap(): void {
  wrapLines.value = !wrapLines.value
  try {
    localStorage.setItem(WRAP_LINES_KEY, String(wrapLines.value))
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

const fontSizeClass = computed(() => {
  switch (fontSize.value) {
    case 'sm':
      return 'text-3xs'
    case 'lg':
      return 'text-row'
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
const searchQuery = ref('')
const { debounced: debouncedSearchQuery, flush: flushSearchQuery } = useDebouncedRef(searchQuery, 150)
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
  // Hidden tabs skip re-parsing (and don't track the line buffer); they catch up on activation.
  if (!isActive.value && parsedCache && cachedTailId === tailId) return parsedCache.items
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
  const { regex, error } = buildSafeSearchRegex(debouncedSearchQuery.value, isRegex.value, caseSensitive.value)
  regexError.value = error
  return regex
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
      if (l.text.length > MAX_REGEX_LINE_LENGTH) return false
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
    if (text.length > MAX_REGEX_LINE_LENGTH) continue
    searchRe.lastIndex = 0
    let match: RegExpExecArray | null
    let lineHasMatch = false
    let matchInLine = 0

    while (matchInLine < MAX_MATCHES_PER_LINE && (match = searchRe.exec(text)) !== null) {
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
  if (!wrapLines.value) {
    void nextTick(() => {
      const el = scrollEl.value?.querySelector<HTMLElement>('[data-active-match="true"]')
      el?.scrollIntoView({ block: 'nearest', inline: 'center' })
    })
  }
}

function stepMatch(delta: 1 | -1): void {
  const flushed = searchQuery.value !== debouncedSearchQuery.value
  flushSearchQuery()
  if (searchIndex.value.matchCount === 0) return
  activeMatchIndex.value =
    (activeMatchIndex.value + delta + searchIndex.value.matchCount) % searchIndex.value.matchCount
  if (filterOnly.value && flushed) {
    // Wait for Vue to propagate filteredLines.length to rowVirtualizer before scrolling.
    void nextTick(jumpToActiveMatch)
  } else {
    jumpToActiveMatch()
  }
}

function nextMatch(): void {
  stepMatch(1)
}

function prevMatch(): void {
  stepMatch(-1)
}

function closeSearch(): void {
  if (searchQuery.value) {
    searchQuery.value = ''
    return
  }
  scrollEl.value?.focus()
}

// Pulse rail: lit cells for search matches, plus the visible window as a thumb.
const matchedIndices = computed(() => new Set(searchIndex.value.matches.map((m) => m.filteredIndex)))
const thumb = ref({ top: 0, height: 1 })

function updateThumb(): void {
  const el = scrollEl.value
  if (!el || el.scrollHeight === 0) return
  thumb.value = { top: el.scrollTop / el.scrollHeight, height: el.clientHeight / el.scrollHeight }
}

function jumpToIndex(index: number): void {
  autoScroll.value = false
  rowVirtualizer.value.scrollToIndex(index, { align: 'center' })
}

// Lines per second, sampled once a second from the arrival counter.
const linesPerSec = ref(0)
let rateTimer: ReturnType<typeof setInterval> | undefined
let lastReceived = 0

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
  updateThumb()
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
  if (streamStatus.value !== 'streaming') return
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
      if (isActive.value) {
        void nextTick(() => {
          if (autoScroll.value && isActive.value) scrollToBottom()
        })
      }
    } else if (added > 0) {
      newLinesCount.value += added
    }
  }
)

watch(isActive, async (active) => {
  if (!active) return
  await nextTick()
  rowVirtualizer.value.measure()
  if (autoScroll.value) {
    scrollToBottom()
  }
  updateThumb()
})

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

function explainLogEntry(originalIndex: number, lineText: string): void {
  const contextLines = parsedLines.value
    .filter((l) => Math.abs(l.originalIndex - originalIndex) <= 3)
    .map((l) => l.text)
  void companion.explainLogLine({
    remotePath: currentTab.value?.remotePath ?? '',
    lineText,
    lineNumber: originalIndex + 1,
    contextLines
  })
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
  if (text.length > MAX_JSON_LINE_LENGTH) return false
  if (!text.includes('{') && !text.trimStart().startsWith('[')) return false
  return extractJsonPayload(text) !== null
}

// Keyboard shortcuts
function onViewerKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return
  if (e.key === 'Escape') {
    if (selectedOriginalIndex.value !== null) {
      e.preventDefault()
      selectedOriginalIndex.value = null
      scrollEl.value?.focus()
      return
    }
  }
  const target = e.target instanceof HTMLElement ? e.target : null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
    return
  }
  if (e.key === 'ArrowUp' && selectedItem.value) {
    e.preventDefault()
    stepSelectedLine(-1)
    return
  }
  if (e.key === 'ArrowDown' && selectedItem.value) {
    e.preventDefault()
    stepSelectedLine(1)
    return
  }
  if (target?.closest('button, [role="button"], a[href]')) {
    return
  }
  if ((e.key === ' ' || e.key.toLowerCase() === 'p') && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
  // Inactive tail tabs stay mounted (v-show); only the visible viewer may claim Ctrl+F.
  if (!rootEl.value || rootEl.value.getClientRects().length === 0) return
  if (document.querySelector('[role="dialog"]')) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    const inSearchBar = searchBarRef.value?.contains(e.target) ?? false
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLElement && e.target.isContentEditable)
    ) {
      if (!rootEl.value.contains(e.target) && !inSearchBar) {
        return
      }
    }
    if (
      inSearchBar ||
      rootEl.value.contains(document.activeElement) ||
      document.activeElement === document.body
    ) {
      e.preventDefault()
      searchBarRef.value?.focusInput()
    }
  }
}

watch(totalSize, () => void nextTick(updateThumb))

let scrollObserver: ResizeObserver | null = null
let lastScrollWidth = 0
let isUnmounted = false

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  void nextTick(() => {
    if (isUnmounted) return
    scrollToBottom()
    updateThumb()
    const el = scrollEl.value
    if (el) {
      lastScrollWidth = el.clientWidth
      scrollObserver = new ResizeObserver(() => {
        const current = scrollEl.value
        if (!current || (current.clientWidth === 0 && current.clientHeight === 0)) return
        const widthChanged = current.clientWidth !== lastScrollWidth
        lastScrollWidth = current.clientWidth
        if (wrapLines.value && widthChanged) {
          rowVirtualizer.value.measure()
        }
        updateThumb()
        if (autoScroll.value) {
          scrollToBottom()
        }
      })
      scrollObserver.observe(el)
    }
  })
  lastReceived = tailStreams.receivedCountMap[props.tailId] || 0
  let initialSettled = lastReceived > 0
  rateTimer = setInterval(() => {
    const received = tailStreams.receivedCountMap[props.tailId] || 0
    if (!initialSettled) {
      initialSettled = true
      lastReceived = received
      linesPerSec.value = 0
      return
    }
    linesPerSec.value = Math.max(0, received - lastReceived)
    lastReceived = received
  }, 1000)
})

function releaseControls(): void {
  if (tailControls.value?.tailId === props.tailId) tailControls.value = null
}

onUnmounted(() => {
  isUnmounted = true
  window.removeEventListener('keydown', onWindowKeydown)
  scrollObserver?.disconnect()
  clearInterval(rateTimer)
  releaseControls()
})

// Overflow menu: rarely used actions live here instead of a row of icon buttons.
const menuItems = computed(() => [
  (['sm', 'md', 'lg'] as const).map((size) => ({
    label: `Text size: ${{ sm: 'small', md: 'medium', lg: 'large' }[size]}`,
    icon: fontSize.value === size ? 'i-lucide-check' : 'i-lucide-type',
    onSelect: () => setFontSize(size)
  })),
  [
    {
      label: wrapLines.value ? 'Turn off line wrap' : 'Wrap long lines',
      icon: 'i-lucide-wrap-text',
      onSelect: toggleWrap
    },
    { label: 'Copy visible lines', icon: 'i-lucide-copy', onSelect: onCopyAll },
    { label: 'Copy file path', icon: 'i-lucide-link', onSelect: onCopyPath },
    { label: 'Export to file', icon: 'i-lucide-download', onSelect: onExport }
  ],
  [{ label: 'Clear log view', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: onClear }]
])

// Only the visible viewer owns the dock's control strip.
watchEffect(() => {
  if (!isActive.value) {
    releaseControls()
    return
  }
  tailControls.value = {
    tailId: props.tailId,
    status: streamStatus.value,
    ended: ended.value,
    error: error.value,
    autoScroll: autoScroll.value,
    newLinesCount: newLinesCount.value,
    linesPerSec: linesPerSec.value,
    visibleCount: filteredLines.value.length,
    totalCount: lines.value.length,
    bufferPct: bufferPct.value,
    maxLines: MAX_TAIL_LINES,
    restarting: restarting.value,
    menuItems: menuItems.value,
    toggleAutoScroll,
    restart: () => void onRestart()
  }
})
</script>

<template>
  <div ref="rootEl" class="relative flex h-full flex-col overflow-hidden bg-default" @keydown="onViewerKeydown">
    <!-- Row 2: find + level filters, always visible -->
    <LogSearchBar
      ref="searchBarRef"
      v-model="searchQuery"
      v-model:case-sensitive="caseSensitive"
      v-model:is-regex="isRegex"
      v-model:filter-only="filterOnly"
      :match-count="searchIndex.matchCount"
      :current-match="searchIndex.matchCount > 0 ? activeMatchIndex + 1 : 0"
      :regex-error="regexError"
      :keywords="keywords"
      :search-pending="searchQuery !== debouncedSearchQuery"
      @add-keyword="addKeyword"
      @remove-keyword="removeKeyword"
      @clear-keywords="clearKeywords"
      @next="nextMatch"
      @prev="prevMatch"
      @close="closeSearch"
    >
      <div class="ml-auto flex max-w-full flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by log level" class="flex flex-wrap items-center rounded-md bg-muted/60 p-0.5">
          <button
            v-for="opt in filterOptions"
            :key="opt.id"
            type="button"
            :aria-pressed="levelFilter === opt.id"
            class="flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 font-mono text-2xs transition-colors"
            :class="
              levelFilter === opt.id
                ? 'border border-default/30 bg-default font-semibold text-default shadow-xs'
                : 'text-muted hover:bg-muted/40 hover:text-default'
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
                    : 'bg-default/80 text-default/80 ring-1 ring-muted'
              "
            >
              {{ opt.count }}
            </span>
          </button>
        </div>

        <UTooltip v-if="pinnedCount > 0" text="Show pinned lines only">
          <button
            type="button"
            aria-label="Show pinned lines only"
            :aria-pressed="pinnedOnly"
            class="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-2xs transition-colors"
            :class="
              pinnedOnly
                ? 'border-primary/40 bg-primary/15 font-semibold text-primary'
                : 'border-muted bg-muted/50 text-muted hover:text-default'
            "
            @click="pinnedOnly = !pinnedOnly"
          >
            <UIcon name="i-lucide-bookmark" class="size-3" />
            <span class="font-bold tabular-nums">{{ pinnedCount }}</span>
          </button>
        </UTooltip>
      </div>
    </LogSearchBar>

    <!-- Tier 3: Main Split Body (Virtualized Stream + Slide-over Inspector) -->
    <div class="relative flex min-h-0 flex-1 overflow-hidden">
      <div class="relative flex min-h-0 flex-1 overflow-hidden">
        <!-- Virtualized Log Line Viewer -->
        <div
          ref="scrollEl"
          role="listbox"
          aria-label="Log output"
          tabindex="0"
          class="relative min-h-0 min-w-0 flex-1 overflow-auto bg-transparent font-mono leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
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
            v-memo="[
              virtualRow.start,
              virtualRow.index,
              filteredLines[virtualRow.index],
              selectedOriginalIndex === filteredLines[virtualRow.index].originalIndex,
              pinnedSet.has(filteredLines[virtualRow.index].originalIndex),
              searchIndex.lineMatchStarts[virtualRow.index],
              searchIndex.lineMatchStarts[virtualRow.index] >= 0 ? activeMatchIndex : -1,
              searchIndex.lineMatchStarts[virtualRow.index] >= 0 ? searchRegex : null,
              keywordRegex,
              wrapLines
            ]"
            role="option"
            :aria-selected="selectedOriginalIndex === filteredLines[virtualRow.index].originalIndex"
            :data-index="virtualRow.index"
            :style="{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
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
              class="w-12 shrink-0 select-none pr-2.5 text-right font-mono text-3xs tabular-nums text-muted border-r border-default/20"
            >
              {{ filteredLines[virtualRow.index].originalIndex + 1 }}
            </div>

            <!-- Log line content area -->
            <div
              class="flex-1 min-w-0 pl-2 pr-14"
              :class="[
                wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
                getLogLevelStyles(filteredLines[virtualRow.index].level).textClass
              ]"
            >
              <!-- Log Level Badge -->
              <span
                v-if="getLogLevelStyles(filteredLines[virtualRow.index].level).badgeText"
                class="rounded px-1 py-0.2 mr-1.5 text-2xs font-bold leading-none align-middle select-none"
                :class="[
                  getLogLevelStyles(filteredLines[virtualRow.index].level).badgeClass,
                  // Only errors and warnings carry a permanent badge; info/debug reveal it on hover.
                  ['error', 'warn'].includes(filteredLines[virtualRow.index].level)
                    ? 'inline-block'
                    : 'hidden group-hover:inline-block'
                ]"
              >
                {{ getLogLevelStyles(filteredLines[virtualRow.index].level).badgeText }}
              </span>

              <!-- JSON Indicator Chip -->
              <span
                v-if="hasJsonLine(filteredLines[virtualRow.index].text)"
                class="inline-block rounded bg-primary/10 px-1 py-0.2 mr-1.5 font-mono text-3xs leading-none font-semibold text-primary ring-1 ring-primary/20 align-middle select-none"
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
                <span v-if="tokenized.timestamp" class="text-muted text-3xs font-mono mr-1.5 select-text tracking-tight inline-block">
                  <template v-for="(tTok, tIdx) in tokenized.timestampTokens" :key="tIdx">
                    <mark
                      v-if="tTok.isMatch"
                      :data-active-match="tTok.isActiveMatch ? 'true' : undefined"
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
                    :data-active-match="rTok.isActiveMatch ? 'true' : undefined"
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
              class="sticky right-1.5 ml-auto flex items-center gap-0.5 self-center rounded bg-default/90 px-1 py-0.5 shadow-xs ring-1 ring-muted transition-opacity"
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
              <UTooltip text="Explain with Companion">
                <button
                  type="button"
                  aria-label="Explain log line with Companion"
                  class="rounded p-0.5 text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                  @click="explainLogEntry(filteredLines[virtualRow.index].originalIndex, filteredLines[virtualRow.index].text)"
                >
                  <UIcon name="i-lucide-sparkles" class="size-3" />
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

        <!-- Empty / Connecting / Terminal State -->
        <div
          v-if="filteredLines.length === 0"
          role="status"
          aria-live="polite"
          class="flex h-full flex-col items-center justify-center gap-1.5 px-4 py-12 text-center select-none"
        >
          <template v-if="lines.length === 0">
            <UIcon v-if="error" name="i-lucide-alert-circle" class="size-6 text-error" />
            <UIcon v-else-if="ended" name="i-lucide-circle-slash" class="size-6 text-muted" />
            <UIcon v-else-if="streamStatus === 'connecting'" name="i-lucide-loader-2" class="size-6 animate-spin text-primary" />
            <UIcon v-else name="i-lucide-scroll-text" class="size-6 text-muted" />
            <p class="text-xs text-muted">
              <template v-if="error">Unable to stream this file — see error below</template>
              <template v-else-if="ended">Stream ended with no output</template>
              <template v-else-if="streamStatus === 'connecting'">Connecting to remote log stream…</template>
              <template v-else>Waiting for output…</template>
            </p>
          </template>
          <template v-else>
            <UIcon name="i-lucide-filter-x" class="size-6 text-muted" />
            <p class="text-xs text-muted">No logs match the current filter</p>
          </template>
        </div>
        </div>

        <LogRail
          :items="filteredLines"
          :matched-indices="matchedIndices"
          :pinned="pinnedSet"
          :thumb-top="thumb.top"
          :thumb-height="thumb.height"
          @jump="jumpToIndex"
        />

        <!-- Floating Jump to Latest Button -->
        <Transition name="slide-up">
          <button
            v-if="!autoScroll && lines.length > 0 && !selectedItem"
            type="button"
            class="absolute bottom-3 right-5 z-20 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg ring-1 ring-primary/40 bg-primary text-inverted transition-all hover:scale-105 active:scale-95 cursor-pointer"
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
          @explain="explainLogEntry(selectedItem.originalIndex, selectedItem.text)"
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
        <span class="truncate" :title="error">{{ error }}</span>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <UTooltip text="Copy error">
          <UButton
            aria-label="Copy error"
            icon="i-lucide-copy"
            size="xs"
            color="error"
            variant="ghost"
            @click="copyText(error, 'Error copied')"
          />
        </UTooltip>
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
    </div>

    <!-- Stream Ended Banner -->
    <div
      v-else-if="ended"
      role="status"
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

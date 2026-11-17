<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import '@xterm/xterm/css/xterm.css'
import { useSessionsStore } from '../../stores/sessions.store'
import { useTerminalStreamsStore } from '../../stores/terminalStreams.store'
import { useUiStore } from '../../stores/ui.store'
import { TERMINAL_SEARCH_EVENT } from '../../stores/terminalStreams.store'
import LogSearchBar from '../logs/LogSearchBar.vue'

/**
 * `active` is true only when the Terminal dock tab is the one currently
 * selected AND the dock isn't collapsed — this component itself stays
 * mounted regardless (see BottomDock.vue), so switching away/back never
 * destroys the underlying xterm instances or their scrollback.
 */
const props = defineProps<{ active: boolean }>()

const sessions = useSessionsStore()
const terminalStreams = useTerminalStreamsStore()
const ui = useUiStore()

watch(
  () => JSON.stringify(ui.terminalAppearance),
  () => {
    terminalStreams.applyAppearance()
    const sessionId = sessions.activeSessionId
    if (props.active && sessionId) {
      void nextTick(() => fitAndResize(sessionId))
    }
  }
)

watch(
  () => ui.terminalPredictiveEcho,
  () => {
    terminalStreams.syncPredictiveEchoSetting()
  }
)

/** Session ids whose container `<div>` has already had `term.open()` called on it — never call it twice. */
const attachedSessions = new Set<string>()

function attachContainer(sessionId: string, el: Element | null): void {
  if (!el || attachedSessions.has(sessionId)) {
    return
  }
  const inst = terminalStreams.getInstance(sessionId)
  if (!inst) {
    return
  }
  inst.term.open(el as HTMLElement)
  attachedSessions.add(sessionId)
  if (inst.WebglAddonCtor) {
    try {
      const webgl = new inst.WebglAddonCtor()
      webgl.onContextLoss(() => webgl.dispose())
      inst.term.loadAddon(webgl)
    } catch {
      // Fall back to default DOM renderer when WebGL context creation fails.
    }
  } else {
    void import('@xterm/addon-webgl')
      .then(({ WebglAddon }) => {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => webgl.dispose())
        inst.term.loadAddon(webgl)
      })
      .catch(() => undefined)
  }
  // Terminal convention: right-click copies the selection if there is one,
  // otherwise pastes. The listener lives exactly as long as the container div.
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    void terminalStreams.copyOrPaste(sessionId)
  })
}

async function fitAndResize(sessionId: string): Promise<void> {
  const inst = terminalStreams.getInstance(sessionId)
  const container = containerRef.value
  if (!inst || !container || container.clientWidth === 0 || container.clientHeight === 0) {
    return
  }
  await terminalStreams.flushPredictions(sessionId)
  const latestInst = terminalStreams.getInstance(sessionId)
  const latestContainer = containerRef.value
  if (
    unmounted ||
    isStale(sessionId) ||
    latestInst !== inst ||
    !latestContainer ||
    latestContainer.clientWidth === 0 ||
    latestContainer.clientHeight === 0
  ) {
    return
  }
  inst.fit.fit()
  terminalStreams.resize(sessionId, inst.term.cols, inst.term.rows)
}

/** True once the active session/tab-visibility has changed since `sessionId` was captured — an
 * overlapping call for a session the user has since switched away from must not touch it. */
function isStale(sessionId: string): boolean {
  return sessionId !== sessions.activeSessionId || !props.active
}

/** Opens (once) and fits the terminal for whichever session is active, but only while this tab is actually visible. */
async function syncActiveTerminal(): Promise<void> {
  if (!props.active) {
    return
  }
  const sessionId = sessions.activeSessionId
  if (!sessionId || sessions.status !== 'connected') {
    return
  }
  await terminalStreams.ensureTerminal(sessionId)
  if (isStale(sessionId)) {
    return
  }
  // A freshly-created terminal's v-for container hasn't rendered yet at this
  // point (ensureTerminal only just pushed to knownSessionIds) — wait a tick so
  // attachContainer's term.open() has run before fitting.
  await nextTick()
  if (isStale(sessionId)) {
    return
  }
  await fitAndResize(sessionId)
  // Focus so keystrokes land in the shell immediately — without this the user
  // has to click inside the terminal before any key (incl. Ctrl+C) works.
  if (!isStale(sessionId)) {
    terminalStreams.focus(sessionId)
  }
}

watch(() => [props.active, sessions.activeSessionId] as const, () => void syncActiveTerminal(), {
  immediate: true
})

let resizeTimer: ReturnType<typeof setTimeout> | null = null
let remoteResizeTimer: ReturnType<typeof setTimeout> | null = null
let unmounted = false

function onWindowResize(): void {
  if (resizeTimer !== null) {
    clearTimeout(resizeTimer)
  }
  if (remoteResizeTimer !== null) {
    clearTimeout(remoteResizeTimer)
  }
  resizeTimer = setTimeout(() => {
    resizeTimer = null
    const sessionId = sessions.activeSessionId
    const inst = sessionId ? terminalStreams.getInstance(sessionId) : undefined
    const container = containerRef.value
    if (!props.active || !sessionId || !inst || !container || container.clientWidth === 0 || container.clientHeight === 0) {
      return
    }
    void terminalStreams.flushPredictions(sessionId).then(() => {
      const latestInst = terminalStreams.getInstance(sessionId)
      const latestContainer = containerRef.value
      if (
        unmounted ||
        !props.active ||
        sessionId !== sessions.activeSessionId ||
        latestInst !== inst ||
        !latestContainer ||
        latestContainer.clientWidth === 0 ||
        latestContainer.clientHeight === 0
      ) {
        return
      }
      inst.fit.fit()
      if (remoteResizeTimer !== null) {
        clearTimeout(remoteResizeTimer)
      }
      remoteResizeTimer = setTimeout(() => {
        remoteResizeTimer = null
        const activeId = sessions.activeSessionId
        const activeInst = activeId ? terminalStreams.getInstance(activeId) : undefined
        if (!unmounted && props.active && activeId && activeInst) {
          terminalStreams.resize(activeId, activeInst.term.cols, activeInst.term.rows)
        }
      }, 150)
    })
  }, 50)
}

const searchOpen = ref(false)
const searchQuery = ref('')
const caseSensitive = ref(false)
const isRegex = ref(false)
const matchCount = ref(0)
const currentMatch = ref(0)
let resultsSub: { dispose: () => void } | null = null

const SEARCH_DECORATIONS = {
  matchOverviewRuler: '#d29922',
  activeMatchColorOverviewRuler: '#f2cc60',
  matchBackground: '#5a4a1a',
  activeMatchBackground: '#9e6a03'
}

function activeInstance(): ReturnType<typeof terminalStreams.getInstance> {
  const sessionId = sessions.activeSessionId
  return sessionId ? terminalStreams.getInstance(sessionId) : undefined
}

function runSearch(forward: boolean): void {
  const inst = activeInstance()
  if (!inst) {
    return
  }
  if (!searchQuery.value) {
    inst.search.clearDecorations()
    matchCount.value = 0
    currentMatch.value = 0
    return
  }
  const options = { caseSensitive: caseSensitive.value, regex: isRegex.value, decorations: SEARCH_DECORATIONS }
  if (forward) {
    inst.search.findNext(searchQuery.value, options)
  } else {
    inst.search.findPrevious(searchQuery.value, options)
  }
}

function openSearch(): void {
  if (!props.active) {
    return
  }
  const inst = activeInstance()
  if (!inst) {
    return
  }
  searchOpen.value = true
  resultsSub?.dispose()
  resultsSub = inst.search.onDidChangeResults(({ resultIndex, resultCount }) => {
    matchCount.value = resultCount
    currentMatch.value = resultIndex + 1
  })
  runSearch(true)
}

function closeSearch(): void {
  searchOpen.value = false
  resultsSub?.dispose()
  resultsSub = null
  activeInstance()?.search.clearDecorations()
  const sessionId = sessions.activeSessionId
  if (sessionId) {
    terminalStreams.focus(sessionId)
  }
}

watch([searchQuery, caseSensitive, isRegex], () => {
  if (searchOpen.value) {
    runSearch(true)
  }
})

const containerRef = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null
let resizeRaf = 0

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener(TERMINAL_SEARCH_EVENT, openSearch)
  
  resizeObserver = new ResizeObserver(() => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf)
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0
      onWindowResize()
    })
  })
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value)
  }
})

onBeforeUnmount(() => {
  unmounted = true
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener(TERMINAL_SEARCH_EVENT, openSearch)
  resultsSub?.dispose()
  resizeObserver?.disconnect()
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf)
    resizeRaf = 0
  }
  if (resizeTimer !== null) {
    clearTimeout(resizeTimer)
  }
  if (remoteResizeTimer !== null) {
    clearTimeout(remoteResizeTimer)
  }
})
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <div ref="containerRef" class="relative min-h-0 flex-1">
      <div
        v-if="sessions.activeSessionId && terminalStreams.exitedSessionIds.includes(sessions.activeSessionId)"
        class="absolute bottom-3 right-3 z-10"
      >
        <UButton icon="i-lucide-rotate-cw" size="sm" @click="terminalStreams.restart(sessions.activeSessionId)">
          Restart shell
        </UButton>
      </div>
      <div v-if="searchOpen" class="absolute right-3 top-1 z-10 rounded-md border border-muted bg-default shadow-md">
        <LogSearchBar
          v-model="searchQuery"
          v-model:case-sensitive="caseSensitive"
          v-model:is-regex="isRegex"
          :match-count="matchCount"
          :current-match="currentMatch"
          placeholder="Find in terminal…"
          @next="runSearch(true)"
          @prev="runSearch(false)"
          @close="closeSearch"
        />
      </div>
      <p v-if="!sessions.activeSessionId" class="px-3 py-6 text-center text-xs text-muted">
        No active site connection
      </p>
      <p
        v-else-if="!terminalStreams.knownSessionIds.includes(sessions.activeSessionId)"
        class="px-3 py-6 text-center text-xs text-muted"
      >
        Opening terminal…
      </p>
      <div
        v-for="sessionId in terminalStreams.knownSessionIds"
        :key="sessionId"
        v-show="sessionId === sessions.activeSessionId"
        class="h-full w-full px-1.5 py-0.5"
        :style="{ backgroundColor: ui.terminalAppearance.theme.background }"
        :ref="(el) => attachContainer(sessionId, el as Element | null)"
      />
    </div>
  </div>
</template>

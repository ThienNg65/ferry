<script setup lang="ts">
import { nextTick, onBeforeUnmount, watch } from 'vue'
import '@xterm/xterm/css/xterm.css'
import { useSessionsStore } from '../../stores/sessions.store'
import { useTerminalStreamsStore } from '../../stores/terminalStreams.store'

/**
 * `active` is true only when the Terminal dock tab is the one currently
 * selected AND the dock isn't collapsed — this component itself stays
 * mounted regardless (see BottomDock.vue), so switching away/back never
 * destroys the underlying xterm instances or their scrollback.
 */
const props = defineProps<{ active: boolean }>()

const sessions = useSessionsStore()
const terminalStreams = useTerminalStreamsStore()

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
  // Terminal convention: right-click copies the selection if there is one,
  // otherwise pastes. The listener lives exactly as long as the container div.
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    void terminalStreams.copyOrPaste(sessionId)
  })
}

async function fitAndResize(sessionId: string): Promise<void> {
  const inst = terminalStreams.getInstance(sessionId)
  if (!inst) {
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

function onWindowResize(): void {
  const sessionId = sessions.activeSessionId
  if (props.active && sessionId) {
    void fitAndResize(sessionId)
  }
}
window.addEventListener('resize', onWindowResize)
onBeforeUnmount(() => window.removeEventListener('resize', onWindowResize))
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <div
      v-if="sessions.activeTab.hostLabel"
      class="shrink-0 border-b border-muted px-3 py-1 text-xs text-muted"
    >
      {{ sessions.activeTab.hostLabel }}
    </div>
    <div class="relative min-h-0 flex-1">
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
        class="h-full w-full px-1"
        :ref="(el) => attachContainer(sessionId, el as Element | null)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
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
}

async function fitAndResize(sessionId: string): Promise<void> {
  const inst = terminalStreams.getInstance(sessionId)
  if (!inst) {
    return
  }
  inst.fit.fit()
  terminalStreams.resize(sessionId, inst.term.cols, inst.term.rows)
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
  await fitAndResize(sessionId)
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
  <div class="relative h-full w-full">
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
</template>

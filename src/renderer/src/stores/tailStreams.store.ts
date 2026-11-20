import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { TailEndEvent, TailLineEvent, TailNoticeEvent, TailReadyEvent, TailStartResult } from '@shared/contract'
import { invoke, onEvent } from '../api'

export interface OpenTail {
  tailId: string
  sessionId: string
  remotePath: string
}

export type TailStreamStatus = 'connecting' | 'streaming' | 'ended' | 'error'

export const MAX_TAIL_LINES = 5000
// Coalesce SSH events into roughly 20 updates/second, including background windows.
const TAIL_FLUSH_MS = 50
const MAX_CLOSED_TOMBSTONES = 500

/** Tracks which remote files currently have an open `tail -F` tab in the dock. */
export const useTailStreamsStore = defineStore('tailStreams', () => {
  const tabs = ref<OpenTail[]>([])
  const activeTailId = ref<string | null>(null)

  // Stream state
  const linesMap = shallowRef<Record<string, string[]>>({})
  const statusMap = ref<Record<string, TailStreamStatus>>({})
  const endedMap = ref<Record<string, boolean>>({})
  const errorMap = ref<Record<string, string | undefined>>({})
  const unreadMap = ref<Record<string, number>>({})
  const pinnedLinesMap = ref<Record<string, number[]>>({})
  const startedAtMap = ref<Record<string, number>>({})
  const droppedCountMap = ref<Record<string, number>>({})
  const receivedCountMap = ref<Record<string, number>>({})
  const openingCount = ref(0)

  // Reset unread count whenever active tab changes
  watch(activeTailId, (newId) => {
    if (newId && unreadMap.value[newId]) {
      unreadMap.value = { ...unreadMap.value, [newId]: 0 }
    }
  })

  // Unlike rAF, timers continue draining pending events while the window is hidden.
  const buffers = new Map<string, string[]>()
  const flushHandles = new Map<string, ReturnType<typeof setTimeout>>()
  const openingPromises = new Map<string, Promise<void>>()
  const closedIds = new Set<string>()
  const sessionCloseCounts = new Map<string, number>()

  function markClosed(tailId: string): void {
    closedIds.add(tailId)
    if (closedIds.size > MAX_CLOSED_TOMBSTONES) {
      const oldest = closedIds.values().next().value
      if (oldest !== undefined) {
        closedIds.delete(oldest)
      }
    }
  }

  function clearFlushTimer(tailId: string): void {
    const handle = flushHandles.get(tailId)
    if (handle !== undefined) {
      clearTimeout(handle)
      flushHandles.delete(tailId)
    }
  }

  function flushNow(tailId: string): void {
    clearFlushTimer(tailId)
    if (closedIds.has(tailId)) {
      buffers.delete(tailId)
      return
    }
    const buffer = buffers.get(tailId)
    if (!buffer || buffer.length === 0) {
      return
    }
    const addedCount = buffer.length
    const current = linesMap.value[tailId] || []
    const next = current.concat(buffer)
    buffers.set(tailId, [])

    const dropped = next.length > MAX_TAIL_LINES ? next.length - MAX_TAIL_LINES : 0
    linesMap.value = {
      ...linesMap.value,
      [tailId]: dropped > 0 ? next.slice(dropped) : next
    }
    receivedCountMap.value = {
      ...receivedCountMap.value,
      [tailId]: (receivedCountMap.value[tailId] || 0) + addedCount
    }

    if (dropped > 0) {
      droppedCountMap.value = {
        ...droppedCountMap.value,
        [tailId]: (droppedCountMap.value[tailId] || 0) + dropped
      }
      if (pinnedLinesMap.value[tailId]?.length) {
        pinnedLinesMap.value = {
          ...pinnedLinesMap.value,
          [tailId]: pinnedLinesMap.value[tailId].map((idx) => idx - dropped).filter((idx) => idx >= 0)
        }
      }
    }

    if (activeTailId.value !== tailId) {
      unreadMap.value = {
        ...unreadMap.value,
        [tailId]: (unreadMap.value[tailId] || 0) + addedCount
      }
    }
  }

  function scheduleFlush(tailId: string): void {
    if (closedIds.has(tailId) || flushHandles.has(tailId)) {
      return
    }
    const handle = setTimeout(() => {
      flushHandles.delete(tailId)
      flushNow(tailId)
    }, TAIL_FLUSH_MS)
    flushHandles.set(tailId, handle)
  }

  function markStreaming(tailId: string): void {
    const current = statusMap.value[tailId]
    if (current !== 'ended' && current !== 'error') {
      statusMap.value[tailId] = 'streaming'
    }
  }

  // Setup global listeners once
  onEvent<TailReadyEvent>(EVENT_CHANNELS.tailReady, (evt) => {
    if (closedIds.has(evt.tailId)) return
    markStreaming(evt.tailId)
  })

  onEvent<TailLineEvent>(EVENT_CHANNELS.tailLine, (evt) => {
    if (closedIds.has(evt.tailId)) return
    let buf = buffers.get(evt.tailId)
    if (!buf) {
      buf = []
      buffers.set(evt.tailId, buf)
    }
    buf.push(evt.line)
    markStreaming(evt.tailId)
    scheduleFlush(evt.tailId)
  })

  onEvent<TailNoticeEvent>(EVENT_CHANNELS.tailNotice, (evt) => {
    if (closedIds.has(evt.tailId)) return
    let buf = buffers.get(evt.tailId)
    if (!buf) {
      buf = []
      buffers.set(evt.tailId, buf)
    }
    buf.push(`⚠ ${evt.message}`)
    markStreaming(evt.tailId)
    scheduleFlush(evt.tailId)
  })

  onEvent<TailEndEvent>(EVENT_CHANNELS.tailEnd, (evt) => {
    if (closedIds.has(evt.tailId)) return
    flushNow(evt.tailId)
    endedMap.value[evt.tailId] = true
    if (evt.error) {
      errorMap.value[evt.tailId] = evt.error
      statusMap.value[evt.tailId] = 'error'
    } else {
      statusMap.value[evt.tailId] = 'ended'
    }
  })

  function initTailState(tailId: string): void {
    closedIds.delete(tailId)
    const preEnded = endedMap.value[tailId] === true
    const preError = errorMap.value[tailId]
    const preStatus = statusMap.value[tailId]

    linesMap.value = { ...linesMap.value, [tailId]: linesMap.value[tailId] ?? [] }
    endedMap.value[tailId] = preEnded
    errorMap.value[tailId] = preError
    statusMap.value[tailId] = preEnded
      ? preError
        ? 'error'
        : 'ended'
      : preStatus === 'streaming'
        ? 'streaming'
        : 'connecting'
    unreadMap.value = { ...unreadMap.value, [tailId]: unreadMap.value[tailId] ?? 0 }
    pinnedLinesMap.value = { ...pinnedLinesMap.value, [tailId]: pinnedLinesMap.value[tailId] ?? [] }
    startedAtMap.value = { ...startedAtMap.value, [tailId]: startedAtMap.value[tailId] ?? Date.now() }
    droppedCountMap.value = { ...droppedCountMap.value, [tailId]: droppedCountMap.value[tailId] ?? 0 }
    receivedCountMap.value = { ...receivedCountMap.value, [tailId]: receivedCountMap.value[tailId] ?? 0 }
    if (!buffers.has(tailId)) {
      buffers.set(tailId, [])
    }
  }

  function cleanupTailState(tailId: string): void {
    const newLinesMap = { ...linesMap.value }
    delete newLinesMap[tailId]
    linesMap.value = newLinesMap

    delete statusMap.value[tailId]
    delete endedMap.value[tailId]
    delete errorMap.value[tailId]

    const newUnreadMap = { ...unreadMap.value }
    delete newUnreadMap[tailId]
    unreadMap.value = newUnreadMap

    const newPinnedMap = { ...pinnedLinesMap.value }
    delete newPinnedMap[tailId]
    pinnedLinesMap.value = newPinnedMap

    const newStartedMap = { ...startedAtMap.value }
    delete newStartedMap[tailId]
    startedAtMap.value = newStartedMap

    const newDroppedMap = { ...droppedCountMap.value }
    delete newDroppedMap[tailId]
    droppedCountMap.value = newDroppedMap

    const newReceivedMap = { ...receivedCountMap.value }
    delete newReceivedMap[tailId]
    receivedCountMap.value = newReceivedMap

    buffers.delete(tailId)
    clearFlushTimer(tailId)
  }

  async function open(sessionId: string, remotePath: string): Promise<void> {
    const existing = tabs.value.find((t) => t.sessionId === sessionId && t.remotePath === remotePath)
    if (existing) {
      activeTailId.value = existing.tailId
      unreadMap.value = { ...unreadMap.value, [existing.tailId]: 0 }
      return
    }

    const key = `${sessionId}\0${remotePath}`
    const inFlight = openingPromises.get(key)
    if (inFlight) {
      return inFlight
    }

    const closeCountAtStart = sessionCloseCounts.get(sessionId) ?? 0
    const attempt = (async () => {
      openingCount.value += 1
      try {
        const result = await invoke<TailStartResult>(INVOKE_CHANNELS.tailStart, { sessionId, remotePath })
        if ((sessionCloseCounts.get(sessionId) ?? 0) !== closeCountAtStart) {
          markClosed(result.tailId)
          cleanupTailState(result.tailId)
          await invoke<void>(INVOKE_CHANNELS.tailStop, result.tailId).catch(() => {})
          return
        }
        initTailState(result.tailId)
        tabs.value.push({ tailId: result.tailId, sessionId, remotePath })
        activeTailId.value = result.tailId
        unreadMap.value = { ...unreadMap.value, [result.tailId]: 0 }
      } finally {
        openingCount.value = Math.max(0, openingCount.value - 1)
        openingPromises.delete(key)
      }
    })()

    openingPromises.set(key, attempt)
    return attempt
  }

  async function restart(tailId: string): Promise<void> {
    const tab = tabs.value.find((t) => t.tailId === tailId)
    if (!tab) return

    const wasEnded = endedMap.value[tailId] === true
    statusMap.value[tailId] = 'connecting'
    endedMap.value[tailId] = false
    errorMap.value[tailId] = undefined

    if (!wasEnded) {
      markClosed(tailId)
      try {
        await invoke<void>(INVOKE_CHANNELS.tailStop, tailId)
      } catch {
        // Stream may have already ended
      }
    }

    if (!tabs.value.some((t) => t.tailId === tailId)) {
      return
    }
    statusMap.value[tailId] = 'connecting'
    endedMap.value[tailId] = false
    errorMap.value[tailId] = undefined

    let result: TailStartResult
    try {
      result = await invoke<TailStartResult>(INVOKE_CHANNELS.tailStart, {
        sessionId: tab.sessionId,
        remotePath: tab.remotePath
      })
    } catch (e) {
      if (tabs.value.some((t) => t.tailId === tailId)) {
        const msg = e instanceof Error ? e.message : String(e)
        endedMap.value[tailId] = true
        errorMap.value[tailId] = msg
        statusMap.value[tailId] = 'error'
      }
      throw e
    }

    const currentIndex = tabs.value.findIndex((t) => t.tailId === tailId)
    if (currentIndex === -1) {
      // Tab was closed while tailStart was in-flight; stop the new stream to avoid leaking it.
      markClosed(result.tailId)
      cleanupTailState(result.tailId)
      await invoke<void>(INVOKE_CHANNELS.tailStop, result.tailId).catch(() => {})
      return
    }
    initTailState(result.tailId)
    const nextTabs = [...tabs.value]
    nextTabs[currentIndex] = { tailId: result.tailId, sessionId: tab.sessionId, remotePath: tab.remotePath }
    tabs.value = nextTabs
    if (activeTailId.value === tailId) {
      activeTailId.value = result.tailId
      unreadMap.value = { ...unreadMap.value, [result.tailId]: 0 }
    }
    markClosed(tailId)
    cleanupTailState(tailId)
  }

  function clear(tailId: string): void {
    clearFlushTimer(tailId)
    linesMap.value = { ...linesMap.value, [tailId]: [] }
    buffers.set(tailId, [])
    unreadMap.value = { ...unreadMap.value, [tailId]: 0 }
    pinnedLinesMap.value = { ...pinnedLinesMap.value, [tailId]: [] }
    droppedCountMap.value = { ...droppedCountMap.value, [tailId]: 0 }
    receivedCountMap.value = { ...receivedCountMap.value, [tailId]: 0 }
  }

  function togglePin(tailId: string, originalIndex: number): void {
    const current = pinnedLinesMap.value[tailId] || []
    const exists = current.includes(originalIndex)
    pinnedLinesMap.value = {
      ...pinnedLinesMap.value,
      [tailId]: exists ? current.filter((i) => i !== originalIndex) : [...current, originalIndex]
    }
  }

  function clearPins(tailId: string): void {
    pinnedLinesMap.value = { ...pinnedLinesMap.value, [tailId]: [] }
  }

  async function close(tailId: string): Promise<void> {
    markClosed(tailId)
    tabs.value = tabs.value.filter((t) => t.tailId !== tailId)
    if (activeTailId.value === tailId) {
      activeTailId.value = tabs.value[0]?.tailId ?? null
    }
    cleanupTailState(tailId)
    try {
      await invoke<void>(INVOKE_CHANNELS.tailStop, tailId)
    } catch {
      // Stream may have already ended or session closed
    }
  }

  async function closeAll(): Promise<void> {
    const all = [...tabs.value]
    await Promise.all(all.map((t) => close(t.tailId)))
  }

  async function closeOthers(keepTailId: string): Promise<void> {
    const targets = tabs.value.filter((t) => t.tailId !== keepTailId)
    await Promise.all(targets.map((t) => close(t.tailId)))
  }

  /** Closes every tail tab belonging to a session — called when that session's tab closes, so a
   * stale entry can never be matched against a later, unrelated session (see `open`'s dedup). */
  async function closeForSession(sessionId: string): Promise<void> {
    sessionCloseCounts.set(sessionId, (sessionCloseCounts.get(sessionId) ?? 0) + 1)
    if (sessionCloseCounts.size > MAX_CLOSED_TOMBSTONES) {
      const oldest = sessionCloseCounts.keys().next().value
      if (oldest !== undefined) {
        sessionCloseCounts.delete(oldest)
      }
    }
    const targets = tabs.value.filter((t) => t.sessionId === sessionId)
    await Promise.all(targets.map((t) => close(t.tailId)))
  }

  /** Updates open tail tabs from a previous sessionId to a newly reconnected sessionId so
   * `restart()` and `closeForSession()` remain bound to the live tab. */
  function rebindSession(oldSessionId: string, newSessionId: string): void {
    if (!oldSessionId || oldSessionId === newSessionId) return
    let changed = false
    const nextTabs = tabs.value.map((t) => {
      if (t.sessionId === oldSessionId) {
        changed = true
        return { ...t, sessionId: newSessionId }
      }
      return t
    })
    if (changed) {
      tabs.value = nextTabs
    }
  }

  return {
    tabs,
    activeTailId,
    linesMap,
    statusMap,
    endedMap,
    errorMap,
    unreadMap,
    pinnedLinesMap,
    startedAtMap,
    droppedCountMap,
    receivedCountMap,
    openingCount,
    open,
    restart,
    clear,
    togglePin,
    clearPins,
    close,
    closeAll,
    closeOthers,
    closeForSession,
    rebindSession
  }
})

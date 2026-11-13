import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { TailEndEvent, TailLineEvent, TailNoticeEvent } from '@shared/contract'
import { invoke, onEvent } from '../api'

export interface OpenTail {
  tailId: string
  sessionId: string
  remotePath: string
}

interface TailStartResult {
  tailId: string
}

export const MAX_TAIL_LINES = 5000

/** Tracks which remote files currently have an open `tail -F` tab in the dock. */
export const useTailStreamsStore = defineStore('tailStreams', () => {
  const tabs = ref<OpenTail[]>([])
  const activeTailId = ref<string | null>(null)

  // Stream state
  const linesMap = shallowRef<Record<string, string[]>>({})
  const endedMap = ref<Record<string, boolean>>({})
  const errorMap = ref<Record<string, string | undefined>>({})
  const unreadMap = ref<Record<string, number>>({})
  const pinnedLinesMap = ref<Record<string, number[]>>({})
  const startedAtMap = ref<Record<string, number>>({})
  const droppedCountMap = ref<Record<string, number>>({})

  // Reset unread count whenever active tab changes
  watch(activeTailId, (newId) => {
    if (newId && unreadMap.value[newId]) {
      unreadMap.value = { ...unreadMap.value, [newId]: 0 }
    }
  })

  // Buffers for batching
  const buffers = new Map<string, string[]>()
  const rafHandles = new Map<string, number>()

  function scheduleFlush(tailId: string): void {
    if (rafHandles.has(tailId)) {
      return
    }
    const handle = requestAnimationFrame(() => {
      rafHandles.delete(tailId)
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
    })
    rafHandles.set(tailId, handle)
  }

  // Setup global listeners once
  onEvent<TailLineEvent>(EVENT_CHANNELS.tailLine, (evt) => {
    let buf = buffers.get(evt.tailId)
    if (!buf) {
      buf = []
      buffers.set(evt.tailId, buf)
    }
    buf.push(evt.line)
    scheduleFlush(evt.tailId)
  })

  onEvent<TailNoticeEvent>(EVENT_CHANNELS.tailNotice, (evt) => {
    let buf = buffers.get(evt.tailId)
    if (!buf) {
      buf = []
      buffers.set(evt.tailId, buf)
    }
    buf.push(`⚠ ${evt.message}`)
    scheduleFlush(evt.tailId)
  })

  onEvent<TailEndEvent>(EVENT_CHANNELS.tailEnd, (evt) => {
    endedMap.value[evt.tailId] = true
    if (evt.error) {
      errorMap.value[evt.tailId] = evt.error
    }
  })

  function initTailState(tailId: string): void {
    linesMap.value = { ...linesMap.value, [tailId]: [] }
    endedMap.value[tailId] = false
    errorMap.value[tailId] = undefined
    unreadMap.value = { ...unreadMap.value, [tailId]: 0 }
    pinnedLinesMap.value = { ...pinnedLinesMap.value, [tailId]: [] }
    startedAtMap.value = { ...startedAtMap.value, [tailId]: Date.now() }
    droppedCountMap.value = { ...droppedCountMap.value, [tailId]: 0 }
    buffers.set(tailId, [])
  }

  function cleanupTailState(tailId: string): void {
    const newLinesMap = { ...linesMap.value }
    delete newLinesMap[tailId]
    linesMap.value = newLinesMap

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

    buffers.delete(tailId)
    const handle = rafHandles.get(tailId)
    if (handle !== undefined) {
      cancelAnimationFrame(handle)
      rafHandles.delete(tailId)
    }
  }

  async function open(sessionId: string, remotePath: string): Promise<void> {
    const existing = tabs.value.find((t) => t.sessionId === sessionId && t.remotePath === remotePath)
    if (existing) {
      activeTailId.value = existing.tailId
      unreadMap.value = { ...unreadMap.value, [existing.tailId]: 0 }
      return
    }
    const result = await invoke<TailStartResult>(INVOKE_CHANNELS.tailStart, { sessionId, remotePath })
    initTailState(result.tailId)

    tabs.value.push({ tailId: result.tailId, sessionId, remotePath })
    activeTailId.value = result.tailId
  }

  async function restart(tailId: string): Promise<void> {
    const tab = tabs.value.find((t) => t.tailId === tailId)
    if (!tab) return
    if (!endedMap.value[tailId]) {
      try {
        await invoke<void>(INVOKE_CHANNELS.tailStop, tailId)
      } catch {
        // Stream may have already ended
      }
    }
    const result = await invoke<TailStartResult>(INVOKE_CHANNELS.tailStart, {
      sessionId: tab.sessionId,
      remotePath: tab.remotePath
    })
    const currentIndex = tabs.value.findIndex((t) => t.tailId === tailId)
    if (currentIndex === -1) {
      // Tab was closed while tailStart was in-flight; stop the new stream to avoid leaking it.
      await invoke<void>(INVOKE_CHANNELS.tailStop, result.tailId).catch(() => {})
      return
    }
    initTailState(result.tailId)
    const nextTabs = [...tabs.value]
    nextTabs[currentIndex] = { tailId: result.tailId, sessionId: tab.sessionId, remotePath: tab.remotePath }
    tabs.value = nextTabs
    if (activeTailId.value === tailId) {
      activeTailId.value = result.tailId
    }
    cleanupTailState(tailId)
  }

  function clear(tailId: string): void {
    linesMap.value = { ...linesMap.value, [tailId]: [] }
    buffers.set(tailId, [])
    unreadMap.value = { ...unreadMap.value, [tailId]: 0 }
    pinnedLinesMap.value = { ...pinnedLinesMap.value, [tailId]: [] }
    droppedCountMap.value = { ...droppedCountMap.value, [tailId]: 0 }
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
    await invoke<void>(INVOKE_CHANNELS.tailStop, tailId)
    tabs.value = tabs.value.filter((t) => t.tailId !== tailId)
    if (activeTailId.value === tailId) {
      activeTailId.value = tabs.value[0]?.tailId ?? null
    }
    cleanupTailState(tailId)
  }

  async function closeAll(): Promise<void> {
    const all = [...tabs.value]
    for (const t of all) {
      await close(t.tailId)
    }
  }

  async function closeOthers(keepTailId: string): Promise<void> {
    const targets = tabs.value.filter((t) => t.tailId !== keepTailId)
    for (const t of targets) {
      await close(t.tailId)
    }
  }

  /** Closes every tail tab belonging to a session — called when that session's tab closes, so a
   * stale entry can never be matched against a later, unrelated session (see `open`'s dedup). */
  async function closeForSession(sessionId: string): Promise<void> {
    const targets = tabs.value.filter((t) => t.sessionId === sessionId)
    for (const t of targets) {
      await close(t.tailId)
    }
  }

  return {
    tabs,
    activeTailId,
    linesMap,
    endedMap,
    errorMap,
    unreadMap,
    pinnedLinesMap,
    startedAtMap,
    droppedCountMap,
    open,
    restart,
    clear,
    togglePin,
    clearPins,
    close,
    closeAll,
    closeOthers,
    closeForSession
  }
})

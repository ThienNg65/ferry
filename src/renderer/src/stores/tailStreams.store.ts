import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
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

/** Tracks which remote files currently have an open `tail -F` tab in the dock. */
export const useTailStreamsStore = defineStore('tailStreams', () => {
  const tabs = ref<OpenTail[]>([])
  const activeTailId = ref<string | null>(null)

  // Stream state
  const linesMap = shallowRef<Record<string, string[]>>({})
  const endedMap = ref<Record<string, boolean>>({})
  const errorMap = ref<Record<string, string | undefined>>({})

  // Buffers for batching
  const buffers = new Map<string, string[]>()
  const rafHandles = new Map<string, number>()
  const MAX_LINES = 5000

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
      const current = linesMap.value[tailId] || []
      const next = current.concat(buffer)
      buffers.set(tailId, [])
      
      linesMap.value = {
        ...linesMap.value,
        [tailId]: next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
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

  async function open(sessionId: string, remotePath: string): Promise<void> {
    const existing = tabs.value.find((t) => t.sessionId === sessionId && t.remotePath === remotePath)
    if (existing) {
      activeTailId.value = existing.tailId
      return
    }
    const result = await invoke<TailStartResult>(INVOKE_CHANNELS.tailStart, { sessionId, remotePath })
    
    linesMap.value = { ...linesMap.value, [result.tailId]: [] }
    endedMap.value[result.tailId] = false
    errorMap.value[result.tailId] = undefined
    buffers.set(result.tailId, [])
    
    tabs.value.push({ tailId: result.tailId, sessionId, remotePath })
    activeTailId.value = result.tailId
  }

  async function close(tailId: string): Promise<void> {
    await invoke<void>(INVOKE_CHANNELS.tailStop, tailId)
    tabs.value = tabs.value.filter((t) => t.tailId !== tailId)
    if (activeTailId.value === tailId) {
      activeTailId.value = tabs.value[0]?.tailId ?? null
    }
    
    const newLinesMap = { ...linesMap.value }
    delete newLinesMap[tailId]
    linesMap.value = newLinesMap
    
    delete endedMap.value[tailId]
    delete errorMap.value[tailId]
    buffers.delete(tailId)
    const handle = rafHandles.get(tailId)
    if (handle !== undefined) {
      cancelAnimationFrame(handle)
      rafHandles.delete(tailId)
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
    open,
    close,
    closeForSession
  }
})

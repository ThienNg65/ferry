import { onBeforeUnmount, shallowRef } from 'vue'
import { EVENT_CHANNELS } from '@shared/contract'
import type { TailEndEvent, TailLineEvent, TailNoticeEvent } from '@shared/contract'
import { onEvent } from '../api'

/** Lines beyond this count are dropped from the front, oldest first. */
const MAX_LINES = 5000

/**
 * Subscribes to one tail stream's line/notice/end events, batching incoming
 * lines into a single reactive update per animation frame instead of
 * triggering Vue reactivity once per line — the key to staying smooth when a
 * remote file is writing many lines per second.
 */
export function useLogTail(tailId: string) {
  const lines = shallowRef<string[]>([])
  const ended = shallowRef(false)
  const error = shallowRef<string | undefined>(undefined)

  let buffer: string[] = []
  let rafHandle: number | null = null

  function scheduleFlush(): void {
    if (rafHandle !== null) {
      return
    }
    rafHandle = requestAnimationFrame(() => {
      rafHandle = null
      if (buffer.length === 0) {
        return
      }
      const next = lines.value.concat(buffer)
      buffer = []
      lines.value = next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
    })
  }

  const offLine = onEvent<TailLineEvent>(EVENT_CHANNELS.tailLine, (evt) => {
    if (evt.tailId !== tailId) {
      return
    }
    buffer.push(evt.line)
    scheduleFlush()
  })
  const offNotice = onEvent<TailNoticeEvent>(EVENT_CHANNELS.tailNotice, (evt) => {
    if (evt.tailId !== tailId) {
      return
    }
    buffer.push(`⚠ ${evt.message}`)
    scheduleFlush()
  })
  const offEnd = onEvent<TailEndEvent>(EVENT_CHANNELS.tailEnd, (evt) => {
    if (evt.tailId !== tailId) {
      return
    }
    ended.value = true
    error.value = evt.error
  })

  onBeforeUnmount(() => {
    offLine()
    offNotice()
    offEnd()
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle)
    }
  })

  return { lines, ended, error }
}

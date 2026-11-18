import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import * as api from '../api'

const eventHandlers = new Map<string, Set<(payload: unknown) => void>>()

vi.mock('../api', () => ({
  invoke: vi.fn(),
  onEvent: vi.fn((channel: string, cb: (payload: unknown) => void) => {
    let set = eventHandlers.get(channel)
    if (!set) {
      set = new Set()
      eventHandlers.set(channel, set)
    }
    set.add(cb)
    return () => {
      set?.delete(cb)
    }
  })
}))

function emitEvent(channel: string, payload: unknown): void {
  const handlers = eventHandlers.get(channel)
  if (!handlers) return
  for (const cb of handlers) {
    cb(payload)
  }
}

describe('tailStreams.store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    eventHandlers.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tracks openingCount, deduplicates open() in-flight and existing tabs, and transitions connecting -> streaming -> ended/error', async () => {
    let resolveStart!: (val: { tailId: string }) => void
    vi.mocked(api.invoke).mockImplementation((channel) => {
      if (channel === INVOKE_CHANNELS.tailStart) {
        return new Promise((resolve) => {
          resolveStart = resolve as typeof resolveStart
        })
      }
      return Promise.resolve(undefined)
    })

    const { useTailStreamsStore } = await import('./tailStreams.store')
    const store = useTailStreamsStore()

    const p1 = store.open('sess-1', '/var/log/app.log')
    const p2 = store.open('sess-1', '/var/log/app.log')
    expect(store.openingCount).toBe(1)

    resolveStart({ tailId: 'tail-1' })
    await Promise.all([p1, p2])

    expect(store.openingCount).toBe(0)
    expect(store.tabs).toHaveLength(1)
    expect(store.activeTailId).toBe('tail-1')
    expect(store.statusMap['tail-1']).toBe('connecting')
    expect(vi.mocked(api.invoke)).toHaveBeenCalledTimes(1)

    // tail:ready transitions connecting -> streaming even with empty file
    emitEvent(EVENT_CHANNELS.tailReady, { tailId: 'tail-1' })
    expect(store.statusMap['tail-1']).toBe('streaming')

    // Re-opening same path activates tab without calling tail:start again
    await store.open('sess-1', '/var/log/app.log')
    expect(vi.mocked(api.invoke)).toHaveBeenCalledTimes(1)

    // tail:end without error -> ended
    emitEvent(EVENT_CHANNELS.tailEnd, { tailId: 'tail-1' })
    expect(store.statusMap['tail-1']).toBe('ended')
    expect(store.endedMap['tail-1']).toBe(true)
    expect(store.errorMap['tail-1']).toBeUndefined()
  })

  it('preserves lines and errors emitted before tail:start resolves', async () => {
    let resolveStart!: (val: { tailId: string }) => void
    vi.mocked(api.invoke).mockImplementation((channel) => {
      if (channel === INVOKE_CHANNELS.tailStart) {
        return new Promise((resolve) => {
          resolveStart = resolve as typeof resolveStart
        })
      }
      return Promise.resolve(undefined)
    })

    const { useTailStreamsStore } = await import('./tailStreams.store')
    const store = useTailStreamsStore()

    const opening = store.open('sess-1', '/var/log/fast.log')
    emitEvent(EVENT_CHANNELS.tailLine, { tailId: 'tail-fast', line: 'early line 1' })
    emitEvent(EVENT_CHANNELS.tailNotice, { tailId: 'tail-fast', message: 'rotated' })
    emitEvent(EVENT_CHANNELS.tailEnd, { tailId: 'tail-fast', error: 'permission denied' })

    resolveStart({ tailId: 'tail-fast' })
    await opening

    expect(store.linesMap['tail-fast']).toEqual(['early line 1', '⚠ rotated'])
    expect(store.endedMap['tail-fast']).toBe(true)
    expect(store.errorMap['tail-fast']).toBe('permission denied')
    expect(store.statusMap['tail-fast']).toBe('error')
  })

  it('coalesces lines in 50ms batches, synchronously flushes on tail:end, and shifts/evicts pins at MAX_TAIL_LINES', async () => {
    vi.mocked(api.invoke).mockResolvedValue({ tailId: 'tail-buf' })
    const { MAX_TAIL_LINES, useTailStreamsStore } = await import('./tailStreams.store')
    const store = useTailStreamsStore()

    await store.open('sess-1', '/var/log/big.log')

    for (let i = 0; i < MAX_TAIL_LINES; i++) {
      emitEvent(EVENT_CHANNELS.tailLine, { tailId: 'tail-buf', line: `line-${i}` })
    }
    // Still buffered until 50ms timer fires
    expect(store.linesMap['tail-buf']).toEqual([])
    expect(store.statusMap['tail-buf']).toBe('streaming')

    vi.advanceTimersByTime(50)
    expect(store.linesMap['tail-buf']).toHaveLength(MAX_TAIL_LINES)
    expect(store.receivedCountMap['tail-buf']).toBe(MAX_TAIL_LINES)

    store.togglePin('tail-buf', 0)
    store.togglePin('tail-buf', 5)
    expect(store.pinnedLinesMap['tail-buf']).toEqual([0, 5])

    // Push 2 more lines and end immediately without advancing timers: tail:end must flush synchronously
    emitEvent(EVENT_CHANNELS.tailLine, { tailId: 'tail-buf', line: 'tail-a' })
    emitEvent(EVENT_CHANNELS.tailLine, { tailId: 'tail-buf', line: 'tail-b' })
    emitEvent(EVENT_CHANNELS.tailEnd, { tailId: 'tail-buf' })

    expect(store.linesMap['tail-buf']).toHaveLength(MAX_TAIL_LINES)
    expect(store.linesMap['tail-buf'][MAX_TAIL_LINES - 1]).toBe('tail-b')
    expect(store.droppedCountMap['tail-buf']).toBe(2)
    expect(store.pinnedLinesMap['tail-buf']).toEqual([3])
    expect(store.statusMap['tail-buf']).toBe('ended')
  })

  it('ignores post-close events and cleans up even when tailStop rejects', async () => {
    let counter = 0
    vi.mocked(api.invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.tailStart) {
        counter += 1
        return { tailId: `tail-${counter}` }
      }
      if (channel === INVOKE_CHANNELS.tailStop) {
        throw new Error('ipc closed')
      }
      return undefined
    })

    const { useTailStreamsStore } = await import('./tailStreams.store')
    const store = useTailStreamsStore()

    await store.open('sess-1', '/var/log/1.log')
    await store.open('sess-1', '/var/log/2.log')
    expect(store.tabs).toHaveLength(2)

    await expect(store.closeForSession('sess-1')).resolves.toBeUndefined()
    expect(store.tabs).toHaveLength(0)
    expect(store.activeTailId).toBeNull()

    // Late events for closed tailIds must not recreate state or buffers
    emitEvent(EVENT_CHANNELS.tailLine, { tailId: 'tail-1', line: 'late line' })
    emitEvent(EVENT_CHANNELS.tailEnd, { tailId: 'tail-1', error: 'late err' })
    vi.advanceTimersByTime(100)

    expect(store.linesMap['tail-1']).toBeUndefined()
    expect(store.statusMap['tail-1']).toBeUndefined()
    expect(store.errorMap['tail-1']).toBeUndefined()
  })

  it('handles restart() success, tailStart failure, and tab closed mid-restart', async () => {
    let call = 0
    let resolveSecondStart!: (v: { tailId: string }) => void
    vi.mocked(api.invoke).mockImplementation((channel) => {
      if (channel === INVOKE_CHANNELS.tailStart) {
        call += 1
        if (call === 1) return Promise.resolve({ tailId: 'tail-a' })
        if (call === 2) return Promise.reject(new Error('ssh disconnected'))
        return new Promise((resolve) => {
          resolveSecondStart = resolve as typeof resolveSecondStart
        })
      }
      return Promise.resolve(undefined)
    })

    const { useTailStreamsStore } = await import('./tailStreams.store')
    const store = useTailStreamsStore()

    await store.open('sess-1', '/var/log/a.log')
    // Failure preserves tab with error status
    await expect(store.restart('tail-a')).rejects.toThrow('ssh disconnected')
    expect(store.statusMap['tail-a']).toBe('error')
    expect(store.errorMap['tail-a']).toBe('ssh disconnected')
    expect(store.endedMap['tail-a']).toBe(true)

    // Tab closed while restart tailStart is in-flight stops the newly returned tailId
    const restartPromise = store.restart('tail-a')
    await Promise.resolve()
    expect(store.statusMap['tail-a']).toBe('connecting')
    await store.close('tail-a')
    resolveSecondStart({ tailId: 'tail-orphan' })
    await restartPromise

    expect(vi.mocked(api.invoke)).toHaveBeenCalledWith(INVOKE_CHANNELS.tailStop, 'tail-orphan')
    expect(store.tabs).toHaveLength(0)
  })

  it('tracks unread counts per inactive tab, clears buffers/timers on clear(), and rebinds sessions', async () => {
    let n = 0
    vi.mocked(api.invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.tailStart) {
        n += 1
        return { tailId: `t-${n}` }
      }
      return undefined
    })

    const { useTailStreamsStore } = await import('./tailStreams.store')
    const store = useTailStreamsStore()

    await store.open('s-old', '/a.log')
    await store.open('s-old', '/b.log')
    expect(store.activeTailId).toBe('t-2')

    emitEvent(EVENT_CHANNELS.tailLine, { tailId: 't-1', line: 'bg line' })
    vi.advanceTimersByTime(50)
    expect(store.unreadMap['t-1']).toBe(1)

    store.activeTailId = 't-1'
    await Promise.resolve()
    expect(store.unreadMap['t-1']).toBe(0)

    emitEvent(EVENT_CHANNELS.tailLine, { tailId: 't-1', line: 'pending' })
    store.clear('t-1')
    vi.advanceTimersByTime(50)
    expect(store.linesMap['t-1']).toEqual([])

    store.rebindSession('s-old', 's-new')
    expect(store.tabs.every((t) => t.sessionId === 's-new')).toBe(true)
  })
})

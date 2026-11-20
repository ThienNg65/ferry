import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useDebouncedRef } from './useDebouncedRef'

describe('useDebouncedRef', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces non-empty updates and flushes empty string immediately', async () => {
    const scope = effectScope()
    const source = ref('')
    let debounced!: ReturnType<typeof useDebouncedRef<string>>['debounced']
    let flush!: ReturnType<typeof useDebouncedRef<string>>['flush']

    scope.run(() => {
      const res = useDebouncedRef(source, 150)
      debounced = res.debounced
      flush = res.flush
    })

    source.value = 'err'
    await nextTick()
    expect(debounced.value).toBe('')

    vi.advanceTimersByTime(100)
    source.value = 'error'
    await nextTick()
    expect(debounced.value).toBe('')

    vi.advanceTimersByTime(149)
    expect(debounced.value).toBe('')

    vi.advanceTimersByTime(1)
    expect(debounced.value).toBe('error')

    // Clearing flushes immediately without waiting for timer
    source.value = ''
    await nextTick()
    expect(debounced.value).toBe('')

    // Manual flush applies pending value immediately
    source.value = 'warn'
    await nextTick()
    expect(debounced.value).toBe('')
    flush()
    expect(debounced.value).toBe('warn')

    scope.stop()
  })

  it('cancels pending timer when effect scope is disposed', async () => {
    const scope = effectScope()
    const source = ref('')
    let debounced!: ReturnType<typeof useDebouncedRef<string>>['debounced']

    scope.run(() => {
      debounced = useDebouncedRef(source, 150).debounced
    })

    source.value = 'pending'
    await nextTick()
    scope.stop()

    vi.advanceTimersByTime(200)
    expect(debounced.value).toBe('')
  })
})

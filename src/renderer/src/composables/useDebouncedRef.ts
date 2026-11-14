import { onScopeDispose, ref, watch, type Ref } from 'vue'

/**
 * Mirrors `source` into a debounced ref for expensive downstream filters/scans
 * while letting text inputs stay immediately responsive. Empty/nullish values
 * flush immediately so clearing a filter never lags.
 */
export function useDebouncedRef<T>(source: Ref<T>, delayMs = 150): {
  debounced: Ref<T>
  flush: (value?: T) => void
} {
  const debounced = ref(source.value) as Ref<T>
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const flush = (value: T = source.value): void => {
    clear()
    debounced.value = value
  }

  watch(source, (val) => {
    if (val === '' || val === null || val === undefined) {
      flush(val)
      return
    }
    clear()
    timer = setTimeout(() => {
      timer = null
      debounced.value = val
    }, delayMs)
  })

  onScopeDispose(clear)
  return { debounced, flush }
}

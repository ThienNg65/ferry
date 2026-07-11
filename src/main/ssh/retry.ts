import { SshError, isTransient } from './errors'

/** Options controlling {@link withRetry} behaviour. */
export interface RetryOptions {
  /** Maximum number of attempts (1 = no retry). Default 1. */
  attempts?: number
  /** Base delay in ms; doubles each attempt (300, 600, 1200…). Default 300. */
  baseDelayMs?: number
  /** Abort signal — when aborted, retrying stops immediately. */
  signal?: AbortSignal
}

/** Resolves after `ms`, or rejects early if the signal aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SshError('CANCELLED', 'Operation cancelled'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new SshError('CANCELLED', 'Operation cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Runs `fn` with bounded exponential-backoff retry.
 *
 * Only **transient** failures (see {@link isTransient}) are retried — a remote
 * command exiting non-zero, a validation error, or a cancellation propagates
 * immediately so we never re-run a mutating operation that already took effect.
 *
 * @param fn   - the operation to attempt; receives the current attempt index
 * @param opts - retry tuning + abort signal
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 1)
  const baseDelayMs = opts.baseDelayMs ?? 300

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (opts.signal?.aborted) {
      throw new SshError('CANCELLED', 'Operation cancelled')
    }
    try {
      return await fn(attempt)
    } catch (e) {
      lastError = e
      const canRetry = attempt < attempts - 1 && isTransient(e) && !opts.signal?.aborted
      if (!canRetry) {
        throw e
      }
      await delay(baseDelayMs * Math.pow(2, attempt), opts.signal)
    }
  }

  throw lastError
}

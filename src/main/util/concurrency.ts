/**
 * Runs `items` through `worker` with at most `concurrency` in flight at once.
 * If any worker throws, no new items are started and the first error is
 * rethrown once every already-in-flight worker has settled — a bounded-parallel
 * "stop on first failure" pool. (For collect-all-failures semantics, catch
 * inside the worker so it never throws.)
 *
 * Extracted from TransferQueue so other bounded fan-outs (e.g. the batch
 * remote delete) reuse it instead of growing private copies.
 */
export async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0
  let stopped = false
  let firstError: unknown

  const runNext = async (): Promise<void> => {
    while (!stopped) {
      const i = nextIndex++
      if (i >= items.length) {
        return
      }
      try {
        await worker(items[i])
      } catch (e) {
        if (!stopped) {
          stopped = true
          firstError = e
        }
        return
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()))
  if (stopped) {
    throw firstError
  }
}

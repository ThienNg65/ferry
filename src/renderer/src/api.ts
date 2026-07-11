import type { IpcResult } from '@shared/contract'

/**
 * Normalises an argument into a plain, structured-cloneable value before it
 * crosses the IPC boundary.
 *
 * Vue wraps `reactive`/`ref` state in Proxies, and Electron's structured-clone
 * algorithm cannot clone a Proxy — attempting to send one fails with
 * "An object could not be cloned." A JSON round-trip strips the proxy
 * wrappers, leaving a clean object. All IPC payloads here are JSON-safe by
 * design, so this is a lossless normalisation.
 */
function toCloneable(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value
  }
  return JSON.parse(JSON.stringify(value))
}

/**
 * Calls a contract invoke channel and unwraps the {@link IpcResult} envelope.
 *
 * Resolves with `data` on success and THROWS on `{ ok: false }` so stores can
 * use plain try/catch.
 *
 * @param channel - a contract invoke channel string
 * @param args    - handler arguments (normalised to cloneable plain objects)
 */
export async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await window.api.invoke(channel, ...args.map(toCloneable))) as IpcResult<T>
  if (!res.ok) {
    throw new Error(res.message)
  }
  return res.data
}

/**
 * Subscribes to a main-process push event. Returns an unsubscribe function.
 *
 * @param channel - a contract event channel string
 * @param cb      - typed callback for the event payload
 */
export function onEvent<T>(channel: string, cb: (payload: T) => void): () => void {
  return window.api.on(channel, (payload: unknown) => cb(payload as T))
}

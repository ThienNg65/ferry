import { INVOKE_CHANNELS, type IpcErrorCode, type IpcResult } from '@shared/contract'
import { useIpcActivityStore } from './stores/ipcActivity.store'

/** Thrown by {@link invoke} on `{ ok: false }` — carries the stable {@link IpcErrorCode} alongside the message, so callers can branch on failure kind instead of parsing text. */
export class IpcError extends Error {
  readonly code: IpcErrorCode
  /** Set only for `HOST_KEY_MISMATCH` — the specific hop/target host:port that mismatched. */
  readonly hostKey?: { host: string; port: number }
  constructor(code: IpcErrorCode, message: string, hostKey?: { host: string; port: number }) {
    super(message)
    this.name = 'IpcError'
    this.code = code
    this.hostKey = hostKey
  }
}

/** Channels excluded from the global busy tracker — high-frequency (per-keystroke/resize) or semantically unrelated to "SSH/SFTP work is happening". */
const QUIET_CHANNELS = new Set<string>([
  INVOKE_CHANNELS.terminalWrite,
  INVOKE_CHANNELS.terminalResize,
  INVOKE_CHANNELS.windowMinimize,
  INVOKE_CHANNELS.windowMaximizeToggle,
  INVOKE_CHANNELS.windowClose,
  INVOKE_CHANNELS.windowIsMaximized
])

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

/** Checks whether the app is currently running inside a Tauri container. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Calls a contract invoke channel and unwraps the {@link IpcResult} envelope.
 *
 * Resolves with `data` on success and THROWS on `{ ok: false }` so stores can
 * use plain try/catch. Supports both Tauri 2.x and Electron backends seamlessly.
 *
 * @param channel - a contract invoke channel string
 * @param args    - handler arguments (normalised to cloneable plain objects)
 */
export async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const tracked = !QUIET_CHANNELS.has(channel)
  const activity = tracked ? useIpcActivityStore() : null
  activity?.increment()
  try {
    let res: IpcResult<T>
    if (isTauri()) {
      const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
      res = await tauriInvoke<IpcResult<T>>(channel, { args: args.map(toCloneable) })
    } else if (typeof window !== 'undefined' && window.api) {
      res = (await window.api.invoke(channel, ...args.map(toCloneable))) as IpcResult<T>
    } else {
      throw new IpcError('UNKNOWN', `IPC bridge unavailable for channel "${channel}"`)
    }

    if (!res.ok) {
      throw new IpcError(res.code, res.message, res.hostKey)
    }
    return res.data
  } finally {
    activity?.decrement()
  }
}

/**
 * Subscribes to a main-process push event. Returns an unsubscribe function.
 * Supports both Tauri 2.x events and Electron IPC events seamlessly.
 *
 * @param channel - a contract event channel string
 * @param cb      - typed callback for the event payload
 */
export function onEvent<T>(channel: string, cb: (payload: T) => void): () => void {
  if (isTauri()) {
    let unlistenFn: (() => void) | undefined
    let cancelled = false
    import('@tauri-apps/api/event').then(({ listen }) => {
      if (cancelled) return
      listen<T>(channel, (event) => cb(event.payload)).then((fn) => {
        if (cancelled) {
          fn()
        } else {
          unlistenFn = fn
        }
      })
    })
    return () => {
      cancelled = true
      if (unlistenFn) unlistenFn()
    }
  }
  return typeof window !== 'undefined' && window.api ? window.api.on(channel, (payload: unknown) => cb(payload as T)) : () => {}
}

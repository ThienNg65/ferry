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
  INVOKE_CHANNELS.windowMinimize,
  INVOKE_CHANNELS.windowMaximizeToggle,
  INVOKE_CHANNELS.windowFullScreenToggle,
  INVOKE_CHANNELS.windowClose,
  INVOKE_CHANNELS.windowShow,
  INVOKE_CHANNELS.windowSetTitle,
  INVOKE_CHANNELS.windowIsMaximized,
  INVOKE_CHANNELS.windowGetState,
  INVOKE_CHANNELS.windowSyncTheme,
  INVOKE_CHANNELS.windowGetDisplays,
  INVOKE_CHANNELS.updateGetStatus,
  INVOKE_CHANNELS.settingsSetUiPref,
  INVOKE_CHANNELS.companionGetReleases,
  INVOKE_CHANNELS.companionAiGetConfig,
  INVOKE_CHANNELS.companionAiSetConfig,
  INVOKE_CHANNELS.companionAiTest,
  INVOKE_CHANNELS.companionAiChat
])

/**
 * Normalises an argument into a plain, JSON-safe value before it
 * crosses the IPC boundary.
 *
 * Vue wraps `reactive`/`ref` state in Proxies; stripping the proxy
 * wrappers leaves a clean object. All IPC payloads here are JSON-safe by
 * design, so this is a lossless normalisation.
 */
function toCloneable(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value)
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0)
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (Array.isArray(value)) {
    return value.map(toCloneable)
  }
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== undefined && typeof entry !== 'function' && typeof entry !== 'symbol') {
      out[key] = toCloneable(entry)
    }
  }
  return out
}

const MAX_PERF_SAMPLES = 100
const SLOW_IPC_THRESHOLD_MS = 100

export interface IpcPerfSample {
  channel: string
  durationMs: number
  ok: boolean
  timestamp: number
}

function recordIpcPerf(sample: IpcPerfSample): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as {
    __FERRY_PERF__?: { recent: IpcPerfSample[]; slow: IpcPerfSample[] }
  }
  const store = (w.__FERRY_PERF__ ??= { recent: [], slow: [] })
  store.recent.push(sample)
  if (store.recent.length > MAX_PERF_SAMPLES) store.recent.shift()
  if (sample.durationMs >= SLOW_IPC_THRESHOLD_MS) {
    store.slow.push(sample)
    if (store.slow.length > MAX_PERF_SAMPLES) store.slow.shift()
  }
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
  const tracked = !QUIET_CHANNELS.has(channel)
  const activity = tracked ? useIpcActivityStore() : null
  activity?.increment()
  const start = performance.now()
  let ok = false
  try {
    const res = (await window.api.invoke(channel, ...args.map(toCloneable))) as IpcResult<T>
    if (!res.ok) {
      throw new IpcError(res.code, res.message, res.hostKey)
    }
    ok = true
    return res.data
  } finally {
    recordIpcPerf({
      channel,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
      ok,
      timestamp: Date.now()
    })
    activity?.decrement()
  }
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

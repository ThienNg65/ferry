import {
  app,
  clipboard,
  debug,
  events,
  extensions,
  init as neutralinoInit,
  os as nlOs,
  window as nlWindow
} from '@neutralinojs/lib'
import {
  EVENT_CHANNELS,
  HOST_INVOKE_CHANNELS,
  INVOKE_CHANNELS,
  SEND_CHANNELS,
  err,
  ok,
  type IpcResult
} from '../../../shared/contract'

declare const __FERRY_APP_VERSION__: string | undefined

const BUNDLED_APP_VERSION =
  typeof __FERRY_APP_VERSION__ === 'string' && __FERRY_APP_VERSION__.length > 0 ? __FERRY_APP_VERSION__ : '0.0.0'

const SIDECAR_EXTENSION_ID = 'js.ferry.sidecar'
const SIDECAR_READY_EVENT = 'sidecar:ready'
const RPC_INVOKE_EVENT = 'rpc_invoke'
const RPC_REPLY_EVENT = 'rpc_reply'
const RPC_SEND_EVENT = 'rpc_send'
const RPC_EVENT = 'rpc_event'

const ALLOWED_INVOKE_CHANNELS = new Set<string>(Object.values(INVOKE_CHANNELS))
const ALLOWED_SEND_CHANNELS = new Set<string>(Object.values(SEND_CHANNELS))
const ALLOWED_ON_CHANNELS = new Set<string>(Object.values(EVENT_CHANNELS))
const HOST_CHANNEL_SET = new Set<string>(HOST_INVOKE_CHANNELS)
const PLAIN_SEND_CHANNELS = new Set<string>([
  SEND_CHANNELS.terminalInput,
  SEND_CHANNELS.terminalResize,
  SEND_CHANNELS.terminalAck
])

export interface NeutralinoTransport {
  init: () => void
  onEvent: (event: string, handler: (detail: unknown) => void) => () => void
  dispatchExtension: (extensionId: string, event: string, data?: unknown) => Promise<void>
  getExtensionStats: () => Promise<{ loaded: string[]; connected: string[] }>
  minimizeWindow: () => Promise<void>
  isWindowMinimized: () => Promise<boolean>
  maximizeWindow: () => Promise<void>
  unmaximizeWindow: () => Promise<void>
  isWindowMaximized: () => Promise<boolean>
  setFullScreen: () => Promise<void>
  exitFullScreen: () => Promise<void>
  isWindowFullScreen: () => Promise<boolean>
  showWindow: () => Promise<void>
  setWindowTitle: (title: string) => Promise<void>
  getWindowPosition: () => Promise<{ x: number; y: number }>
  getWindowSize: () => Promise<{ width?: number; height?: number }>
  setWindowSize: (options: { width?: number; height?: number }) => Promise<void>
  moveWindow: (x: number, y: number) => Promise<void>
  exitApp: () => Promise<void>
  showOpenDialog: (
    title: string,
    options?: { multiSelections?: boolean; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }
  ) => Promise<string[]>
  showFolderDialog: (title: string, options?: { defaultPath?: string }) => Promise<string>
  showSaveDialog: (title: string, options?: { defaultPath?: string }) => Promise<string>
  readClipboardText: () => Promise<string>
  getKnownPath: (name: 'downloads') => Promise<string>
  logDebug: (message: string) => Promise<void>
  getAppVersion: () => string
  waitForDirectEndpoint?: (timeoutMs?: number) => Promise<{ port: number; token: string } | null>
}

function createDefaultTransport(): NeutralinoTransport {
  const directListeners = new Map<string, Set<(detail: unknown) => void>>()
  let directWs: WebSocket | null = null
  let directOpen = false
  let helloSent = false
  let directEndpoint: { port: number; token: string } | null = null
  let directEndpointWaiters: Array<(endpoint: { port: number; token: string } | null) => void> = []
  let connectQueue: Array<{
    event: string
    data: unknown
    resolve: () => void
    reject: (err: unknown) => void
  }> = []

  const flushQueueViaNeutralino = (): void => {
    if (connectQueue.length === 0) {
      return
    }
    const queued = connectQueue
    connectQueue = []
    for (const item of queued) {
      extensions.dispatch(SIDECAR_EXTENSION_ID, item.event, item.data).then(item.resolve, item.reject)
    }
  }

  const requestDirectInfo = (): void => {
    if (directWs || helloSent) {
      return
    }
    helloSent = true
    void extensions.dispatch(SIDECAR_EXTENSION_ID, 'sidecar:hello', {}).catch(() => {
      helloSent = false
    })
  }

  const emitDirect = (event: string, detail: unknown): void => {
    const handlers = directListeners.get(event)
    if (!handlers) {
      return
    }
    for (const h of [...handlers]) {
      h(detail)
    }
  }

  const connectDirect = (detail: unknown): void => {
    if (!detail || typeof detail !== 'object' || typeof WebSocket === 'undefined') {
      return
    }
    const { directPort, directToken } = detail as { directPort?: unknown; directToken?: unknown }
    if (typeof directPort !== 'number' || directPort <= 0 || typeof directToken !== 'string' || !directToken) {
      return
    }
    directEndpoint = { port: directPort, token: directToken }
    if (directEndpointWaiters.length > 0) {
      const waiters = directEndpointWaiters
      directEndpointWaiters = []
      for (const resolve of waiters) {
        resolve(directEndpoint)
      }
    }
    if (directWs && (directWs.readyState === WebSocket.OPEN || directWs.readyState === WebSocket.CONNECTING)) {
      return
    }
    const sock = new WebSocket(`ws://127.0.0.1:${directPort}?token=${encodeURIComponent(directToken)}`)
    directWs = sock
    sock.addEventListener('open', () => {
      if (directWs !== sock) {
        return
      }
      directOpen = true
      const queued = connectQueue
      connectQueue = []
      for (const item of queued) {
        try {
          sock.send(JSON.stringify({ event: item.event, data: item.data }))
          item.resolve()
        } catch (err) {
          item.reject(err)
        }
      }
    })
    sock.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') {
        return
      }
      let msg: { event?: unknown; data?: unknown }
      try {
        msg = JSON.parse(ev.data) as { event?: unknown; data?: unknown }
      } catch {
        return
      }
      if (msg.event === RPC_EVENT || msg.event === RPC_REPLY_EVENT) {
        emitDirect(msg.event, msg.data)
      }
    })
    sock.addEventListener('close', () => {
      if (directWs === sock) {
        directWs = null
        directOpen = false
        helloSent = false
        directEndpoint = null
        flushQueueViaNeutralino()
      }
    })
    sock.addEventListener('error', () => {
      if (directWs === sock) {
        directOpen = false
        flushQueueViaNeutralino()
      }
    })
  }

  return {
    init: () => neutralinoInit(),
    onEvent: (event, handler) => {
      const wrapped =
        event === SIDECAR_READY_EVENT
          ? (detail: unknown) => {
              connectDirect(detail)
              handler(detail)
            }
          : event === 'extensionReady'
            ? (detail: unknown) => {
                if (detail === SIDECAR_EXTENSION_ID) {
                  requestDirectInfo()
                }
                handler(detail)
              }
            : handler
      const listener = (ev: CustomEvent) => wrapped(ev.detail)
      void events.on(event, listener)
      const trackDirect = event === RPC_EVENT || event === RPC_REPLY_EVENT
      if (trackDirect) {
        let set = directListeners.get(event)
        if (!set) {
          set = new Set()
          directListeners.set(event, set)
        }
        set.add(handler)
      }
      return () => {
        void events.off(event, listener)
        if (trackDirect) {
          directListeners.get(event)?.delete(handler)
        }
      }
    },
    dispatchExtension: (extensionId, event, data) => {
      if (extensionId === SIDECAR_EXTENSION_ID) {
        if (directOpen && directWs?.readyState === WebSocket.OPEN) {
          try {
            directWs.send(JSON.stringify({ event, data }))
            return Promise.resolve()
          } catch (e) {
            return Promise.reject(e)
          }
        }
        if (directWs && directWs.readyState === WebSocket.CONNECTING) {
          return new Promise<void>((resolve, reject) => {
            connectQueue.push({ event, data, resolve, reject })
          })
        }
      }
      return extensions.dispatch(extensionId, event, data)
    },
    getExtensionStats: async () => {
      const stats = await extensions.getStats()
      if (stats.connected.includes(SIDECAR_EXTENSION_ID)) {
        requestDirectInfo()
      }
      return stats
    },
    minimizeWindow: () => nlWindow.minimize(),
    isWindowMinimized: () => nlWindow.isMinimized(),
    maximizeWindow: () => nlWindow.maximize(),
    unmaximizeWindow: () => nlWindow.unmaximize(),
    isWindowMaximized: () => nlWindow.isMaximized(),
    setFullScreen: () => nlWindow.setFullScreen(),
    exitFullScreen: () => nlWindow.exitFullScreen(),
    isWindowFullScreen: () => nlWindow.isFullScreen(),
    showWindow: () => nlWindow.show(),
    setWindowTitle: (title: string) => nlWindow.setTitle(title),
    getWindowPosition: async () => {
      const pos = await nlWindow.getPosition()
      return { x: pos.x ?? 0, y: pos.y ?? 0 }
    },
    getWindowSize: () => nlWindow.getSize(),
    setWindowSize: (options) => nlWindow.setSize(options),
    moveWindow: (x, y) => nlWindow.move(x, y),
    exitApp: () => app.exit(),
    showOpenDialog: (title, options) => nlOs.showOpenDialog(title, options),
    showFolderDialog: (title, options) => nlOs.showFolderDialog(title, options),
    showSaveDialog: (title, options) => nlOs.showSaveDialog(title, options),
    readClipboardText: () => clipboard.readText(),
    getKnownPath: (name) => nlOs.getPath(name),
    logDebug: (message) => debug.log(message),
    getAppVersion: () => (window as unknown as { NL_APPVERSION?: string }).NL_APPVERSION || BUNDLED_APP_VERSION,
    waitForDirectEndpoint: (timeoutMs = 3000) => {
      if (directEndpoint) {
        return Promise.resolve(directEndpoint)
      }
      requestDirectInfo()
      return new Promise((resolve) => {
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          directEndpointWaiters = directEndpointWaiters.filter((w) => w !== onReady)
          resolve(directEndpoint)
        }, timeoutMs)
        const onReady = (endpoint: { port: number; token: string } | null): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(endpoint)
        }
        directEndpointWaiters.push(onReady)
      })
    }
  }
}

/** Reconstructs Uint8Arrays from `{ __b64 }` markers emitted by the sidecar wire protocol. */
export function decodeB64Deep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(decodeB64Deep)
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length === 1 && keys[0] === '__b64' && typeof record.__b64 === 'string') {
    const binary = atob(record.__b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    out[key] = decodeB64Deep(record[key])
  }
  return out
}

/** Encodes Uint8Arrays into `{ __b64 }` markers before JSON serialization over Neutralino WebSocket RPC. */
export function encodeB64Deep(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < value.length; i += chunkSize) {
      binary += String.fromCharCode(...value.subarray(i, i + chunkSize))
    }
    return { __b64: btoa(binary) }
  }
  if (Array.isArray(value)) {
    return value.map(encodeB64Deep)
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = encodeB64Deep(val)
    }
    return out
  }
  return value
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

async function runHostCall<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return ok(await fn())
  } catch (error) {
    return err('UNKNOWN', errorMessage(error))
  }
}

export interface NeutralinoApiOptions {
  readyTimeoutMs?: number
  rpcTimeoutMs?: number
}

const DEFAULT_READY_TIMEOUT_MS = 15_000
const DEFAULT_RPC_TIMEOUT_MS = 120_000

const beforeCloseHooks = new Set<() => Promise<void> | void>()

/** Registers a cleanup/flush hook executed before the window exits via OS close or `window:close`. */
export function registerBeforeWindowClose(hook: () => Promise<void> | void): () => void {
  beforeCloseHooks.add(hook)
  return () => {
    beforeCloseHooks.delete(hook)
  }
}

export function createNeutralinoApi(
  transport: NeutralinoTransport = createDefaultTransport(),
  options: NeutralinoApiOptions = {}
): Window['api'] {
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
  const rpcTimeoutMs = options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS
  const apiStartTime = performance.now()
  const apiTimeOrigin = performance.timeOrigin

  let nextRequestId = 1
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  let sidecarReady = false
  let closing = false
  let closePromise: Promise<void> | null = null
  let lastWindowState = { isMaximized: false, isMinimized: false, isFullScreen: false }
  const readyWaiters: Array<{
    resolve: () => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  const markReady = (): void => {
    if (sidecarReady) {
      return
    }
    sidecarReady = true
    while (readyWaiters.length > 0) {
      const waiter = readyWaiters.shift()
      if (waiter) {
        clearTimeout(waiter.timer)
        waiter.resolve()
      }
    }
  }

  const emitLocal = (channel: string, payload: unknown): void => {
    const channelListeners = listeners.get(channel)
    if (!channelListeners) {
      return
    }
    for (const listener of [...channelListeners]) {
      listener(payload)
    }
  }

  const failAllPending = (reason: string): void => {
    sidecarReady = false
    const errObj = new Error(reason)
    while (readyWaiters.length > 0) {
      const waiter = readyWaiters.shift()
      if (waiter) {
        clearTimeout(waiter.timer)
        waiter.reject(errObj)
      }
    }
    for (const [id, entry] of pending) {
      pending.delete(id)
      clearTimeout(entry.timer)
      entry.reject(errObj)
    }
  }

  const emitWindowState = (patch: Partial<typeof lastWindowState>): void => {
    lastWindowState = { ...lastWindowState, ...patch }
    emitLocal(EVENT_CHANNELS.windowStateChange, { ...lastWindowState })
  }

  const closeWindowGracefully = (): Promise<void> => {
    if (closePromise) {
      return closePromise
    }
    closing = true
    closePromise = (async () => {
      if (beforeCloseHooks.size > 0) {
        const hooks = [...beforeCloseHooks].map((fn) =>
          Promise.resolve()
            .then(() => fn())
            .catch(() => {})
        )
        await Promise.race([
          Promise.allSettled(hooks),
          new Promise<void>((resolve) => setTimeout(resolve, 500))
        ])
      }
      await transport.exitApp()
    })()
    return closePromise
  }

  transport.onEvent(SIDECAR_READY_EVENT, () => {
    markReady()
  })

  transport.onEvent('extensionReady', (detail) => {
    if (detail === SIDECAR_EXTENSION_ID) {
      markReady()
    }
  })

  transport.onEvent('extClientDisconnect', (detail) => {
    if (!closing && detail === SIDECAR_EXTENSION_ID) {
      failAllPending('Sidecar disconnected before replying')
    }
  })

  transport.onEvent('serverOffline', () => {
    if (!closing) {
      failAllPending('Neutralino server went offline')
    }
  })

  transport.onEvent('windowMaximize', () => {
    emitWindowState({ isMaximized: true, isMinimized: false })
  })

  transport.onEvent('windowRestore', () => {
    emitWindowState({ isMaximized: false, isMinimized: false })
  })

  transport.onEvent('windowMinimize', () => {
    emitWindowState({ isMinimized: true })
  })

  transport.onEvent('windowFullScreenEnter', () => {
    emitWindowState({ isFullScreen: true, isMinimized: false })
  })

  transport.onEvent('windowFullScreenExit', () => {
    emitWindowState({ isFullScreen: false })
  })

  transport.onEvent('windowClose', () => {
    void closeWindowGracefully()
  })

  transport.onEvent(RPC_REPLY_EVENT, (detail) => {
    if (!detail || typeof detail !== 'object') {
      return
    }
    const { id, result } = detail as { id?: unknown; result?: unknown }
    if (typeof id !== 'string') {
      return
    }
    const entry = pending.get(id)
    if (!entry) {
      return
    }
    pending.delete(id)
    clearTimeout(entry.timer)
    entry.resolve(decodeB64Deep(result))
  })

  transport.onEvent(RPC_EVENT, (detail) => {
    if (!detail || typeof detail !== 'object') {
      return
    }
    const { channel, payload } = detail as { channel?: unknown; payload?: unknown }
    if (typeof channel === 'string' && ALLOWED_ON_CHANNELS.has(channel)) {
      // UTF-8 terminal output strings carry no { __b64 } markers; skip recursive object walk.
      if (channel === EVENT_CHANNELS.terminalData && payload && typeof (payload as { data?: unknown }).data === 'string') {
        emitLocal(channel, payload)
      } else {
        emitLocal(channel, decodeB64Deep(payload))
      }
    }
  })

  // Guard against missing the early `sidecar:ready` broadcast if extension connected before init.
  const ensureSidecarReady = async (): Promise<void> => {
    if (sidecarReady) {
      return
    }
    try {
      const stats = await transport.getExtensionStats()
      if (stats.connected.includes(SIDECAR_EXTENSION_ID)) {
        markReady()
        return
      }
    } catch {
      // Transport not ready yet; fall through to wait for the ready event.
    }
    if (sidecarReady) {
      return
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const idx = readyWaiters.indexOf(waiter)
          if (idx !== -1) {
            readyWaiters.splice(idx, 1)
          }
          reject(new Error(`Sidecar did not become ready within ${readyTimeoutMs}ms`))
        }, readyTimeoutMs)
      }
      readyWaiters.push(waiter)
    })
  }

  const invokeHostChannel = async (channel: string, args: unknown[]): Promise<unknown> => {
    switch (channel) {
      case INVOKE_CHANNELS.windowMinimize:
        return runHostCall(async () => {
          await transport.minimizeWindow()
          emitWindowState({ isMinimized: true })
        })
      case INVOKE_CHANNELS.windowMaximizeToggle:
        return runHostCall(async () => {
          const wasMaximized = await transport.isWindowMaximized()
          if (wasMaximized) {
            await transport.unmaximizeWindow()
          } else {
            await transport.maximizeWindow()
          }
          emitWindowState({ isMaximized: !wasMaximized, isMinimized: false })
        })
      case INVOKE_CHANNELS.windowFullScreenToggle:
        return runHostCall(async () => {
          const wasFullScreen = await transport.isWindowFullScreen()
          if (wasFullScreen) {
            await transport.exitFullScreen()
          } else {
            await transport.setFullScreen()
          }
          emitWindowState({ isFullScreen: !wasFullScreen, isMinimized: false })
        })
      case INVOKE_CHANNELS.windowShow:
        return runHostCall(() => transport.showWindow())
      case INVOKE_CHANNELS.windowSetTitle:
        return runHostCall(() => transport.setWindowTitle(typeof args[0] === 'string' && args[0] ? args[0] : 'Ferry'))
      case INVOKE_CHANNELS.windowClose:
        return runHostCall(() => closeWindowGracefully())
      case INVOKE_CHANNELS.windowIsMaximized:
        return runHostCall(async () => {
          const isMaximized = await transport.isWindowMaximized()
          lastWindowState = { ...lastWindowState, isMaximized }
          return { isMaximized }
        })
      case INVOKE_CHANNELS.windowGetState:
        return runHostCall(async () => {
          const [isMaximized, isMinimized, isFullScreen] = await Promise.all([
            transport.isWindowMaximized(),
            transport.isWindowMinimized(),
            transport.isWindowFullScreen()
          ])
          lastWindowState = { isMaximized, isMinimized, isFullScreen }
          return { ...lastWindowState }
        })
      case INVOKE_CHANNELS.dialogPickFile:
        return runHostCall(async () => {
          const entries = await transport.showOpenDialog('Select file', { multiSelections: false })
          return entries.length > 0 ? entries[0] : null
        })
      case INVOKE_CHANNELS.dialogPickFolder:
        return runHostCall(async () => {
          const selected = await transport.showFolderDialog('Select folder')
          return selected || null
        })
      case INVOKE_CHANNELS.dialogPickSaveFile:
        return runHostCall(async () => {
          const defaultPath = typeof args[0] === 'string' && args[0].length > 0 ? args[0] : undefined
          const selected = await transport.showSaveDialog('Save file', defaultPath ? { defaultPath } : undefined)
          return selected || null
        })
      case INVOKE_CHANNELS.systemGetDownloadsPath:
        return runHostCall(async () => ({ path: await transport.getKnownPath('downloads') }))
      case INVOKE_CHANNELS.systemGetAppVersion:
        return ok({ version: transport.getAppVersion() })
      case INVOKE_CHANNELS.systemClipboardReadText:
        return runHostCall(async () => ({ text: await transport.readClipboardText() }))
      case INVOKE_CHANNELS.systemStartDrag:
        // OS-level drag-out is not supported in Neutralino/WebView2; in-app pane drag uses HTML5 drag events.
        return ok(undefined)
      case INVOKE_CHANNELS.profileReport:
        return runHostCall(() => transport.logDebug(JSON.stringify(args[0] ?? {})))
      default:
        return err('UNKNOWN', `Unhandled host channel: ${channel}`)
    }
  }

  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      throw new Error(`Blocked invoke on non-whitelisted channel: ${channel}`)
    }
    if (HOST_CHANNEL_SET.has(channel)) {
      return invokeHostChannel(channel, args)
    }
    if (channel === INVOKE_CHANNELS.sitesImportJson && (typeof args[0] !== 'string' || args[0].length === 0)) {
      let entries: string[]
      try {
        entries = await transport.showOpenDialog('Import sites backup', {
          multiSelections: false,
          filters: [{ name: 'Ferry sites backup', extensions: ['json'] }]
        })
      } catch (error) {
        return err('UNKNOWN', errorMessage(error))
      }
      if (entries.length === 0 || !entries[0]) {
        return ok(null)
      }
      args = [entries[0]]
    }
    await ensureSidecarReady()
    const id = `nl-${nextRequestId++}`
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.delete(id)) {
          reject(new Error(`Sidecar RPC timed out after ${rpcTimeoutMs}ms: ${channel}`))
        }
      }, rpcTimeoutMs)
      pending.set(id, { resolve, reject, timer })
      transport
        .dispatchExtension(SIDECAR_EXTENSION_ID, RPC_INVOKE_EVENT, {
          id,
          channel,
          args: encodeB64Deep(args)
        })
        .catch((error) => {
        const entry = pending.get(id)
        if (entry) {
          pending.delete(id)
          clearTimeout(entry.timer)
          reject(new Error(errorMessage(error)))
        }
      })
    })
  }

  const send = (channel: string, ...args: unknown[]): void => {
    if (!ALLOWED_SEND_CHANNELS.has(channel)) {
      throw new Error(`Blocked send on non-whitelisted channel: ${channel}`)
    }
    const payload = PLAIN_SEND_CHANNELS.has(channel) ? args[0] : encodeB64Deep(args[0])
    if (sidecarReady) {
      void transport
        .dispatchExtension(SIDECAR_EXTENSION_ID, RPC_SEND_EVENT, {
          channel,
          payload
        })
        .catch(() => {
          // Best-effort fire-and-forget; errors are surfaced through invoke/status channels.
        })
      return
    }
    void ensureSidecarReady()
      .then(() =>
        transport.dispatchExtension(SIDECAR_EXTENSION_ID, RPC_SEND_EVENT, {
          channel,
          payload
        })
      )
      .catch(() => {
        // Best-effort fire-and-forget; errors are surfaced through invoke/status channels.
      })
  }

  const on = (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
    if (!ALLOWED_ON_CHANNELS.has(channel)) {
      throw new Error(`Blocked listener on non-whitelisted channel: ${channel}`)
    }
    let channelListeners = listeners.get(channel)
    if (!channelListeners) {
      channelListeners = new Set()
      listeners.set(channel, channelListeners)
    }
    channelListeners.add(listener)
    return () => {
      off(channel, listener)
    }
  }

  const off = (channel: string, listener: (...args: unknown[]) => void): void => {
    if (!ALLOWED_ON_CHANNELS.has(channel)) {
      return
    }
    listeners.get(channel)?.delete(listener)
  }

  const stageDroppedFile = async (
    stageId: string,
    relativePath: string,
    file: File,
    modifiedAt?: string,
    signal?: AbortSignal
  ): Promise<void> => {
    await ensureSidecarReady()
    const endpoint = await transport.waitForDirectEndpoint?.()
    if (!endpoint) {
      throw new Error('Direct sidecar streaming endpoint is unavailable')
    }
    const params = new URLSearchParams({ stageId, relativePath })
    if (modifiedAt) {
      params.set('modifiedAt', modifiedAt)
    }
    const res = await fetch(`http://127.0.0.1:${endpoint.port}/stage-drop?${params.toString()}`, {
      method: 'POST',
      headers: { 'X-Ferry-Token': endpoint.token },
      body: file,
      signal
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error || `Staging upload failed (${res.status})`)
    }
  }

  return {
    invoke,
    on,
    off,
    send,
    getPathForFile: (file: File) => (file as File & { path?: string }).path ?? '',
    ...(transport.waitForDirectEndpoint ? { stageDroppedFile } : {}),
    getPreloadTime: () => ({ start: apiStartTime, timeOrigin: apiTimeOrigin })
  }
}

/** True when running inside the Neutralinojs native container rather than Electron. */
export function isNeutralinoRuntime(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { NL_PORT?: unknown }).NL_PORT === 'number'
}

/** Opens an external `https://` URL in the user's default browser (Neutralino `os.open`, falling back to `window.open`). */
export async function openExternal(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol !== 'https:') {
    return
  }
  const safeUrl = parsed.toString()
  if (isNeutralinoRuntime()) {
    try {
      await nlOs.open(safeUrl)
      return
    } catch {
      // Fall through to window.open if host does not support os.open
    }
  }
  if (typeof window !== 'undefined') {
    window.open(safeUrl, '_blank', 'noopener,noreferrer')
  }
}

/** Installs the Neutralino-backed `window.api` bridge when Electron's preload script is absent. */
export function installNeutralinoApi(): void {
  if (typeof window === 'undefined' || window.api) {
    return
  }
  const transport = createDefaultTransport()
  transport.init()
  window.api = createNeutralinoApi(transport)
}

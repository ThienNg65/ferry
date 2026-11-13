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

export interface NeutralinoTransport {
  init: () => void
  onEvent: (event: string, handler: (detail: unknown) => void) => () => void
  dispatchExtension: (extensionId: string, event: string, data?: unknown) => Promise<void>
  getExtensionStats: () => Promise<{ loaded: string[]; connected: string[] }>
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  unmaximizeWindow: () => Promise<void>
  isWindowMaximized: () => Promise<boolean>
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
}

function createDefaultTransport(): NeutralinoTransport {
  return {
    init: () => neutralinoInit(),
    onEvent: (event, handler) => {
      const listener = (ev: CustomEvent) => handler(ev.detail)
      void events.on(event, listener)
      return () => {
        void events.off(event, listener)
      }
    },
    dispatchExtension: (extensionId, event, data) => extensions.dispatch(extensionId, event, data),
    getExtensionStats: () => extensions.getStats(),
    minimizeWindow: () => nlWindow.minimize(),
    maximizeWindow: () => nlWindow.maximize(),
    unmaximizeWindow: () => nlWindow.unmaximize(),
    isWindowMaximized: () => nlWindow.isMaximized(),
    exitApp: () => app.exit(),
    showOpenDialog: (title, options) => nlOs.showOpenDialog(title, options),
    showFolderDialog: (title, options) => nlOs.showFolderDialog(title, options),
    showSaveDialog: (title, options) => nlOs.showSaveDialog(title, options),
    readClipboardText: () => clipboard.readText(),
    getKnownPath: (name) => nlOs.getPath(name),
    logDebug: (message) => debug.log(message),
    getAppVersion: () => (window as unknown as { NL_APPVERSION?: string }).NL_APPVERSION || '0.22.0'
  }
}

/** Reconstructs Uint8Arrays from `{ __b64 }` markers emitted by the sidecar wire protocol. */
export function decodeB64Deep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(decodeB64Deep)
  }
  if (value !== null && typeof value === 'object') {
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

export function createNeutralinoApi(transport: NeutralinoTransport = createDefaultTransport()): Window['api'] {
  const apiStartTime = performance.now()
  const apiTimeOrigin = performance.timeOrigin

  let nextRequestId = 1
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  let sidecarReady = false
  const readyWaiters: Array<() => void> = []

  const markReady = (): void => {
    if (sidecarReady) {
      return
    }
    sidecarReady = true
    while (readyWaiters.length > 0) {
      readyWaiters.shift()?.()
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
    for (const [id, entry] of pending) {
      pending.delete(id)
      entry.reject(new Error(reason))
    }
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
    if (detail === SIDECAR_EXTENSION_ID) {
      failAllPending('Sidecar disconnected before replying')
    }
  })

  transport.onEvent('serverOffline', () => {
    failAllPending('Neutralino server went offline')
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
    entry.resolve(decodeB64Deep(result))
  })

  transport.onEvent(RPC_EVENT, (detail) => {
    if (!detail || typeof detail !== 'object') {
      return
    }
    const { channel, payload } = detail as { channel?: unknown; payload?: unknown }
    if (typeof channel === 'string' && ALLOWED_ON_CHANNELS.has(channel)) {
      emitLocal(channel, decodeB64Deep(payload))
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
    await new Promise<void>((resolve) => {
      readyWaiters.push(resolve)
    })
  }

  const invokeHostChannel = async (channel: string, args: unknown[]): Promise<unknown> => {
    switch (channel) {
      case INVOKE_CHANNELS.windowMinimize:
        return runHostCall(() => transport.minimizeWindow())
      case INVOKE_CHANNELS.windowMaximizeToggle:
        return runHostCall(async () => {
          const wasMaximized = await transport.isWindowMaximized()
          if (wasMaximized) {
            await transport.unmaximizeWindow()
          } else {
            await transport.maximizeWindow()
          }
          emitLocal(EVENT_CHANNELS.windowStateChange, { isMaximized: !wasMaximized })
        })
      case INVOKE_CHANNELS.windowClose:
        return runHostCall(() => transport.exitApp())
      case INVOKE_CHANNELS.windowIsMaximized:
        return runHostCall(async () => ({ isMaximized: await transport.isWindowMaximized() }))
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
      case INVOKE_CHANNELS.updateCheck:
        return ok({ status: 'disabled' as const })
      case INVOKE_CHANNELS.updateGetStatus:
        return ok({ status: 'disabled' as const, currentVersion: transport.getAppVersion() })
      case INVOKE_CHANNELS.updateInstallNow:
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
      pending.set(id, { resolve, reject })
      transport.dispatchExtension(SIDECAR_EXTENSION_ID, RPC_INVOKE_EVENT, { id, channel, args }).catch((error) => {
        if (pending.delete(id)) {
          reject(new Error(errorMessage(error)))
        }
      })
    })
  }

  const send = (channel: string, ...args: unknown[]): void => {
    if (!ALLOWED_SEND_CHANNELS.has(channel)) {
      throw new Error(`Blocked send on non-whitelisted channel: ${channel}`)
    }
    void ensureSidecarReady().then(() =>
      transport.dispatchExtension(SIDECAR_EXTENSION_ID, RPC_SEND_EVENT, {
        channel,
        payload: args[0]
      })
    )
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

  return {
    invoke,
    on,
    off,
    send,
    getPathForFile: (file: File) => (file as File & { path?: string }).path ?? '',
    getPreloadTime: () => ({ start: apiStartTime, timeOrigin: apiTimeOrigin })
  }
}

/** True when running inside the Neutralinojs native container rather than Electron. */
export function isNeutralinoRuntime(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { NL_PORT?: unknown }).NL_PORT === 'number'
}

/** Activates Neutralino native window dragging on a borderless titlebar element. */
export function registerTitleBarDragRegion(el: HTMLElement | null): () => void {
  if (!el || !isNeutralinoRuntime()) {
    return () => {}
  }
  void nlWindow.setDraggableRegion(el, { dragMinDistance: 10 })
  return () => {
    void nlWindow.unsetDraggableRegion(el)
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

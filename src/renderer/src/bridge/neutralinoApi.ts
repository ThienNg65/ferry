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

export interface NeutralinoTransport {
  init: () => void
  onEvent: (event: string, handler: (detail: unknown) => void) => () => void
  dispatchExtension: (extensionId: string, event: string, data?: unknown) => Promise<void>
  getExtensionStats: () => Promise<{ loaded: string[]; connected: string[] }>
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  unmaximizeWindow: () => Promise<void>
  isWindowMaximized: () => Promise<boolean>
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
    getWindowPosition: () => nlWindow.getPosition(),
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
    getAppVersion: () => (window as unknown as { NL_APPVERSION?: string }).NL_APPVERSION || BUNDLED_APP_VERSION
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
  let emulatedMaximized = false
  let savedRestoreBounds: { x: number; y: number; width: number; height: number } | null = null
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
    clearTimeout(entry.timer)
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
        return runHostCall(() => transport.minimizeWindow())
      case INVOKE_CHANNELS.windowMaximizeToggle:
        return runHostCall(async () => {
          const wasMaximized = emulatedMaximized || (await transport.isWindowMaximized())
          if (wasMaximized) {
            if (emulatedMaximized && savedRestoreBounds) {
              const { x, y, width, height } = savedRestoreBounds
              await transport.moveWindow(x, y)
              await transport.setWindowSize({ width, height })
            } else {
              await transport.unmaximizeWindow()
            }
            emulatedMaximized = false
            savedRestoreBounds = null
          } else {
            const scr = typeof window !== 'undefined' ? window.screen : undefined
            if (scr && scr.availWidth > 0 && scr.availHeight > 0) {
              // Neutralino's native maximize() on a borderless Windows window covers the taskbar;
              // size and position to the screen's work area (avail*) instead.
              const [pos, size] = await Promise.all([transport.getWindowPosition(), transport.getWindowSize()])
              const scale =
                typeof window.innerWidth === 'number' && window.innerWidth > 0 && size.width
                  ? size.width / window.innerWidth
                  : 1
              const restoreWidth = Math.round((size.width ?? 1280) / scale)
              const restoreHeight = Math.round((size.height ?? 800) / scale)
              savedRestoreBounds = { x: pos.x, y: pos.y, width: restoreWidth, height: restoreHeight }
              const availLeft = (scr as Screen & { availLeft?: number }).availLeft ?? 0
              const availTop = (scr as Screen & { availTop?: number }).availTop ?? 0
              await transport.moveWindow(Math.round(availLeft * scale), Math.round(availTop * scale))
              // Neutralino's setSize() on Windows expects logical (CSS) pixels and applies DPI
              // scaling internally, whereas getSize() returns physical pixels; pass availWidth/Height directly.
              await transport.setWindowSize({
                width: Math.round(scr.availWidth),
                height: Math.round(scr.availHeight)
              })
              emulatedMaximized = true
            } else {
              await transport.maximizeWindow()
            }
          }
          emitLocal(EVENT_CHANNELS.windowStateChange, { isMaximized: !wasMaximized })
        })
      case INVOKE_CHANNELS.windowClose:
        return runHostCall(() => transport.exitApp())
      case INVOKE_CHANNELS.windowIsMaximized:
        return runHostCall(async () => ({ isMaximized: emulatedMaximized || (await transport.isWindowMaximized()) }))
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
    void ensureSidecarReady()
      .then(() =>
        transport.dispatchExtension(SIDECAR_EXTENSION_ID, RPC_SEND_EVENT, {
          channel,
          payload: encodeB64Deep(args[0])
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

/**
 * Activates Neutralino native window dragging on a borderless titlebar element.
 * Waits for initial window bounds before moving (preventing the (0,0) jump race)
 * and unmaximizes automatically when dragging from a maximized window.
 */
export function registerTitleBarDragRegion(
  el: HTMLElement | null,
  options?: {
    isMaximized?: () => boolean
    onUnmaximizeForDrag?: () => Promise<void>
  }
): () => void {
  if (!el || !isNeutralinoRuntime()) {
    return () => {}
  }

  let active = false
  let ready = false
  let dragging = false
  let unmaximizing = false
  let capturedEl: HTMLElement | null = null
  let capturedPointerId: number | null = null
  let startClientX = 0
  let startClientY = 0
  let startScreenX = 0
  let startScreenY = 0
  let startWinX = 0
  let startWinY = 0
  let moveScale = 1
  let moveRaf: number | null = null
  let moveInFlight = false
  let hasPendingMove = false
  let dragGen = 0
  let lastSentX = Number.NaN
  let lastSentY = Number.NaN
  let latestScreenX = 0
  let latestScreenY = 0

  const flushMove = (): void => {
    if (!active || !dragging || !ready) return
    if (moveInFlight) {
      hasPendingMove = true
      return
    }
    const nextX = Math.round(startWinX + (latestScreenX - startScreenX) * moveScale)
    const nextY = Math.round(startWinY + (latestScreenY - startScreenY) * moveScale)
    if (nextX === lastSentX && nextY === lastSentY) return
    lastSentX = nextX
    lastSentY = nextY
    moveInFlight = true
    const gen = dragGen
    void nlWindow.move(nextX, nextY).finally(() => {
      if (gen !== dragGen) return
      moveInFlight = false
      if (hasPendingMove) {
        hasPendingMove = false
        flushMove()
      }
    })
  }

  const stopDrag = (): void => {
    if (!active) return
    const wasDragging = dragging
    active = false
    ready = false
    dragging = false
    unmaximizing = false
    dragGen++
    moveInFlight = false
    hasPendingMove = false
    lastSentX = Number.NaN
    lastSentY = Number.NaN
    if (capturedEl && capturedPointerId !== null) {
      try {
        capturedEl.releasePointerCapture?.(capturedPointerId)
      } catch {
        // Ignore if pointer capture was already released.
      }
    }
    capturedEl = null
    capturedPointerId = null
    if (moveRaf !== null) {
      cancelAnimationFrame(moveRaf)
      moveRaf = null
    }
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', stopDrag)
    window.removeEventListener('pointercancel', stopDrag)
    if (wasDragging) {
      window.dispatchEvent(new CustomEvent('ferry:window-bounds-dirty'))
    }
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (!active) return
    if (unmaximizing) {
      latestScreenX = e.screenX
      latestScreenY = e.screenY
      return
    }
    if (!ready) return
    if (!dragging) {
      const dx = e.clientX - startClientX
      const dy = e.clientY - startClientY
      if (Math.hypot(dx, dy) < 6) return
      if (options?.isMaximized?.() && options.onUnmaximizeForDrag) {
        ready = false
        unmaximizing = true
        const gen = dragGen
        const cursorRatioX = window.innerWidth > 0 ? Math.min(0.9, Math.max(0.1, e.clientX / window.innerWidth)) : 0.5
        const dragScreenX = e.screenX
        const dragScreenY = e.screenY
        latestScreenX = e.screenX
        latestScreenY = e.screenY
        void options
          .onUnmaximizeForDrag()
          .then(() => Promise.all([nlWindow.getPosition(), nlWindow.getSize()]))
          .then(([, size]) => {
            if (!active || gen !== dragGen) return
            // Reuse moveScale captured at pointerdown; window.innerWidth may still
            // reflect the pre-unmaximize layout until the next frame.
            const scale = moveScale
            const width = size.width ?? 1280
            startWinX = Math.round(dragScreenX * scale - width * cursorRatioX)
            startWinY = Math.round(dragScreenY * scale - Math.min(20 * scale, e.clientY * scale))
            startScreenX = dragScreenX
            startScreenY = dragScreenY
            unmaximizing = false
            dragging = true
            ready = true
            flushMove()
          })
          .catch(() => {
            if (gen === dragGen) stopDrag()
          })
        return
      }
      dragging = true
    }
    latestScreenX = e.screenX
    latestScreenY = e.screenY
    if (moveRaf !== null) return
    moveRaf = requestAnimationFrame(() => {
      moveRaf = null
      flushMove()
    })
  }

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement | null
    if (target?.closest('button, a, input, [role="button"]')) return
    if (active) stopDrag()

    active = true
    ready = false
    dragging = false
    unmaximizing = false
    const gen = ++dragGen
    startClientX = e.clientX
    startClientY = e.clientY
    startScreenX = e.screenX
    startScreenY = e.screenY
    latestScreenX = e.screenX
    latestScreenY = e.screenY

    try {
      el.setPointerCapture?.(e.pointerId)
      capturedEl = el
      capturedPointerId = e.pointerId
    } catch {
      // Ignore environments without pointer capture support.
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('pointercancel', stopDrag)

    void Promise.all([nlWindow.getPosition(), nlWindow.getSize()])
      .then(([pos, size]) => {
        if (!active || gen !== dragGen) return
        startWinX = pos.x
        startWinY = pos.y
        moveScale =
          typeof window.innerWidth === 'number' && window.innerWidth > 0 && size.width
            ? size.width / window.innerWidth
            : 1
        ready = true
      })
      .catch(() => {
        if (gen === dragGen) stopDrag()
      })
  }

  el.addEventListener('pointerdown', onPointerDown)
  return () => {
    stopDrag()
    el.removeEventListener('pointerdown', onPointerDown)
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

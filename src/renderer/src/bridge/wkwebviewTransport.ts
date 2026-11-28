import type { NeutralinoTransport } from './neutralinoApi'

/**
 * Transport for the native macOS shell (WKWebView). Everything crosses one
 * `ferry` script message handler; the shell answers calls through
 * `window.__ferryNative.reply` and pushes events through `window.__ferryNative.emit`.
 * The sidecar runs over stdio, so no sockets are involved and there is no direct
 * streaming endpoint.
 */

declare const __FERRY_APP_VERSION__: string | undefined

interface NativeBridge {
  postMessage: (message: unknown) => void
}

interface NativeHook {
  emit: (event: string, detail: unknown) => void
  reply: (id: number, result: unknown, error?: string) => void
  /** Called by the shell when files are dragged over the window, before the drop event fires. */
  setDropFiles: (files: DropFile[]) => void
}

interface DropFile {
  name: string
  path: string
  size: number
  mtime: number
  isDir: boolean
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { ferry?: NativeBridge } }
    __ferryNative?: NativeHook
  }
}

export function isWKWebViewHost(): boolean {
  return typeof window !== 'undefined' && !!window.webkit?.messageHandlers?.ferry
}

export function createWKWebViewTransport(bridge?: NativeBridge): NeutralinoTransport {
  const native = bridge ?? window.webkit?.messageHandlers?.ferry
  if (!native) {
    throw new Error('Native bridge is unavailable')
  }
  const listeners = new Map<string, Set<(detail: unknown) => void>>()
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let nextId = 1

  let dropFiles: DropFile[] = []

  const hook: NativeHook = {
    setDropFiles: (files) => {
      dropFiles = Array.isArray(files) ? files : []
    },
    emit: (event, detail) => {
      for (const handler of [...(listeners.get(event) ?? [])]) {
        handler(detail)
      }
    },
    reply: (id, result, error) => {
      const entry = pending.get(id)
      if (!entry) {
        return
      }
      pending.delete(id)
      if (error) {
        entry.reject(new Error(error))
      } else {
        entry.resolve(result)
      }
    }
  }

  const call = <T>(op: string, args?: unknown): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      try {
        native.postMessage({ id, op, args })
      } catch (e) {
        pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })

  const fire = (op: string, args?: unknown): Promise<void> => call<void>(op, args).then(() => undefined)

  return {
    pathForFile: (file) => {
      const sameName = dropFiles.filter((f) => f.name === file.name)
      const exact = sameName.find((f) => f.size === file.size && f.mtime === file.lastModified)
      return (exact ?? (sameName.length === 1 ? sameName[0] : undefined))?.path ?? ''
    },
    init: () => {
      window.__ferryNative = hook
      void call('init').catch(() => undefined)
    },
    onEvent: (event, handler) => {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(handler)
      return () => {
        set.delete(handler)
      }
    },
    dispatchExtension: (_extensionId, event, data) => fire('sidecar', { event, data }),
    getExtensionStats: () => call('stats'),
    minimizeWindow: () => fire('window.minimize'),
    isWindowMinimized: () => call('window.isMinimized'),
    maximizeWindow: () => fire('window.maximize'),
    unmaximizeWindow: () => fire('window.unmaximize'),
    isWindowMaximized: () => call('window.isMaximized'),
    setFullScreen: () => fire('window.setFullScreen'),
    exitFullScreen: () => fire('window.exitFullScreen'),
    isWindowFullScreen: () => call('window.isFullScreen'),
    showWindow: () => fire('window.show'),
    setWindowTitle: (title) => fire('window.setTitle', { title }),
    getWindowPosition: () => call('window.getPosition'),
    getWindowSize: () => call('window.getSize'),
    setWindowSize: (options) => fire('window.setSize', options),
    moveWindow: (x, y) => fire('window.move', { x, y }),
    exitApp: () => fire('app.exit'),
    showOpenDialog: (title, options) => call('dialog.open', { title, ...options }),
    showFolderDialog: (title, options) => call('dialog.folder', { title, ...options }),
    showSaveDialog: (title, options) => call('dialog.save', { title, ...options }),
    readClipboardText: () => call('clipboard.readText'),
    getKnownPath: (name) => call('path.get', { name }),
    logDebug: (message) => fire('log', { message }),
    getAppVersion: () => (typeof __FERRY_APP_VERSION__ === 'string' && __FERRY_APP_VERSION__ ? __FERRY_APP_VERSION__ : '0.0.0')
  }
}

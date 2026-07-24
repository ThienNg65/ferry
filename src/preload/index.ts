import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { INVOKE_CHANNELS, EVENT_CHANNELS } from '../shared/contract'

const preloadStartTime = performance.now()
const preloadTimeOrigin = performance.timeOrigin

/**
 * The complete IPC whitelist, derived directly from the shared contract — the
 * single source of truth. Any channel not in the contract is rejected by the
 * bridge.
 */
const ALLOWED_INVOKE_CHANNELS = Object.values(INVOKE_CHANNELS)
const ALLOWED_ON_CHANNELS = Object.values(EVENT_CHANNELS)

type InvokeChannel = string
type OnChannel = string

/** Signature of a listener registered via `window.api.on`. */
type IpcListener = (...args: unknown[]) => void

/**
 * The `window.api` surface exposed to the renderer process.
 * All communication with the main process MUST go through these methods.
 */
export interface ElectronAPI {
  /**
   * Invokes a whitelisted IPC channel and awaits the main-process reply.
   *
   * @param channel - One of the whitelisted invoke channels.
   * @param args    - Arbitrary JSON-serialisable arguments.
   * @returns A promise resolving to the handler's return value.
   */
  invoke: (channel: InvokeChannel, ...args: unknown[]) => Promise<unknown>

  /**
   * Registers a listener for a whitelisted push-event channel.
   * Returns a cleanup function that removes the listener.
   *
   * @param channel  - One of the whitelisted `on` channels.
   * @param listener - Callback invoked when the event fires.
   */
  on: (channel: OnChannel, listener: IpcListener) => () => void

  /**
   * Removes a specific listener from a push-event channel.
   *
   * @param channel  - The channel to stop listening on.
   * @param listener - The exact listener reference to remove.
   */
  off: (channel: OnChannel, listener: IpcListener) => void

  /**
   * Resolves the absolute filesystem path of a dropped/selected `File`.
   *
   * Replaces the removed `File.path` DOM extension (dropped in Electron 32+):
   * a sandboxed renderer cannot read the path off the `File` object itself, so
   * the OS-drag-upload flow asks the preload to resolve it via `webUtils`.
   *
   * @param file - a `File` from a drop event or file input.
   * @returns the absolute path, or `''` if it cannot be resolved.
   */
  getPathForFile: (file: File) => string

  /** Returns preload execution timing mark. */
  getPreloadTime: () => { start: number; timeOrigin: number }
}

const listenerRegistry = new Map<
  string,
  Map<IpcListener, (_event: Electron.IpcRendererEvent, ...args: unknown[]) => void>
>()

/**
 * Exposes `window.api` to the renderer through the context bridge.
 * Only whitelisted channels are reachable — all others are blocked at source.
 */
contextBridge.exposeInMainWorld('api', {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const allowed = ALLOWED_INVOKE_CHANNELS as readonly string[]
    if (!allowed.includes(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  on(channel: string, listener: IpcListener): () => void {
    const allowed = ALLOWED_ON_CHANNELS as readonly string[]
    if (!allowed.includes(channel)) {
      return () => undefined
    }
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
      listener(...args)
    }
    if (!listenerRegistry.has(channel)) {
      listenerRegistry.set(channel, new Map())
    }
    listenerRegistry.get(channel)!.set(listener, wrapped)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
      listenerRegistry.get(channel)?.delete(listener)
    }
  },

  off(channel: string, listener: IpcListener): void {
    const allowed = ALLOWED_ON_CHANNELS as readonly string[]
    if (!allowed.includes(channel)) {
      return
    }
    const channelMap = listenerRegistry.get(channel)
    if (!channelMap) {
      return
    }
    const wrapped = channelMap.get(listener)
    if (!wrapped) {
      return
    }
    ipcRenderer.removeListener(channel, wrapped)
    channelMap.delete(listener)
  },

  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },

  getPreloadTime(): { start: number; timeOrigin: number } {
    return { start: preloadStartTime, timeOrigin: preloadTimeOrigin }
  }
} satisfies ElectronAPI)


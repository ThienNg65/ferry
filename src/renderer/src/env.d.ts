/// <reference types="vite/client" />

/**
 * The bridge accepts any channel string. Concrete channel safety is provided
 * by the shared contract (src/shared/contract.ts), which both the preload
 * whitelist and the renderer's `api.ts` helper are derived from.
 */
type InvokeChannel = string
type OnChannel = string

type IpcListener = (...args: unknown[]) => void

/**
 * The contextBridge-exposed `window.api` surface.
 * Declared here so all renderer TypeScript files see the correct types
 * without importing from the preload script (which runs in a different context).
 */
interface ElectronAPI {
  invoke: (channel: InvokeChannel, ...args: unknown[]) => Promise<unknown>
  on: (channel: OnChannel, listener: IpcListener) => () => void
  off: (channel: OnChannel, listener: IpcListener) => void
  /** Resolves a dropped/selected `File`'s absolute path (replaces the removed `File.path`, gone since Electron 32). */
  getPathForFile: (file: File) => string
  /** Returns preload execution timing mark. */
  getPreloadTime: () => { start: number; timeOrigin: number }
}


declare global {
  interface Window {
    api: ElectronAPI
  }
}

// Makes this an external module so `declare global` is valid and the Window
// augmentation actually applies across the renderer.
export {}

/// <reference types="vite/client" />

/**
 * The bridge accepts any channel string. Concrete channel safety is provided
 * by the shared contract (src/shared/contract.ts), which both the Neutralino
 * bridge whitelist and the renderer's `api.ts` helper are derived from.
 */
type InvokeChannel = string
type OnChannel = string

type IpcListener = (...args: unknown[]) => void

/**
 * The `window.api` bridge exposed by `neutralinoApi.ts`.
 * Declared here so all renderer TypeScript files see the correct types.
 */
interface FerryAPI {
  invoke: (channel: InvokeChannel, ...args: unknown[]) => Promise<unknown>
  on: (channel: OnChannel, listener: IpcListener) => () => void
  off: (channel: OnChannel, listener: IpcListener) => void
  send: (channel: string, ...args: unknown[]) => void
  /** Opens a validated external HTTPS URL through the native host when supported. */
  openExternal?: (url: string) => Promise<void>
  /** Resolves a dropped/selected `File`'s absolute path when available on the File object. */
  getPathForFile: (file: File) => string
  /** Streams a dropped `File` directly to the sidecar's staging directory over authenticated localhost HTTP. */
  stageDroppedFile?: (
    stageId: string,
    relativePath: string,
    file: File,
    modifiedAt?: string,
    signal?: AbortSignal
  ) => Promise<void>
  /** Returns bridge initialization timing mark. */
  getPreloadTime: () => { start: number; timeOrigin: number }
}


declare global {
  interface Window {
    api: FerryAPI
  }
}

// Makes this an external module so `declare global` is valid and the Window
// augmentation actually applies across the renderer.
export {}

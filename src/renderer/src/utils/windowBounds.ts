import { window as nlWindow } from '@neutralinojs/lib'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { WindowIsMaximizedResult, WindowStateEvent } from '@shared/contract'
import { invoke, onEvent } from '../api'
import { isNeutralinoRuntime } from '../bridge/neutralinoApi'

export const WINDOW_BOUNDS_STORAGE_KEY = 'ferry:windowBounds'
export const MIN_WINDOW_WIDTH = 900
export const MIN_WINDOW_HEIGHT = 600

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

export interface ScreenBounds {
  availLeft: number
  availTop: number
  availWidth: number
  availHeight: number
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function loadWindowBounds(storage: Storage = localStorage): WindowBounds | null {
  try {
    const raw = storage.getItem(WINDOW_BOUNDS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WindowBounds> | null
    if (
      !parsed ||
      !isFiniteNumber(parsed.x) ||
      !isFiniteNumber(parsed.y) ||
      !isFiniteNumber(parsed.width) ||
      !isFiniteNumber(parsed.height)
    ) {
      return null
    }
    return {
      x: parsed.x,
      y: parsed.y,
      width: parsed.width,
      height: parsed.height,
      isMaximized: Boolean(parsed.isMaximized)
    }
  } catch {
    return null
  }
}

export function saveWindowBounds(bounds: WindowBounds, storage: Storage = localStorage): void {
  try {
    storage.setItem(WINDOW_BOUNDS_STORAGE_KEY, JSON.stringify(bounds))
  } catch {
    // Ignore storage quota / restricted context errors.
  }
}

/**
 * Ensures restored window dimensions respect minimums and keeps at least the
 * titlebar reachable on-screen if a previously connected monitor disappeared.
 */
export function clampWindowBounds(bounds: WindowBounds, screen?: ScreenBounds, scale = 1): WindowBounds {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const minW = Math.round(MIN_WINDOW_WIDTH * safeScale)
  const minH = Math.round(MIN_WINDOW_HEIGHT * safeScale)
  const width = Math.max(minW, Math.round(bounds.width))
  const height = Math.max(minH, Math.round(bounds.height))
  let x = Math.round(bounds.x)
  let y = Math.round(bounds.y)

  if (screen && screen.availWidth > 0 && screen.availHeight > 0) {
    const effectiveMinW = Math.min(minW, screen.availWidth)
    const effectiveMinH = Math.min(minH, screen.availHeight)
    const clampedWidth = Math.min(Math.max(effectiveMinW, Math.round(bounds.width)), screen.availWidth)
    const clampedHeight = Math.min(Math.max(effectiveMinH, Math.round(bounds.height)), screen.availHeight)
    const minVisibleX = screen.availLeft - clampedWidth + 100
    const maxVisibleX = screen.availLeft + screen.availWidth - 100
    const minVisibleY = screen.availTop
    const maxVisibleY = screen.availTop + screen.availHeight - 60
    x = Math.min(Math.max(x, minVisibleX), maxVisibleX)
    y = Math.min(Math.max(y, minVisibleY), maxVisibleY)
    return {
      x,
      y,
      width: clampedWidth,
      height: clampedHeight,
      isMaximized: bounds.isMaximized
    }
  }

  return { x, y, width, height, isMaximized: bounds.isMaximized }
}

function currentScale(): number {
  if (typeof window === 'undefined') return 1
  return typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
}

function currentScreenBounds(): ScreenBounds | undefined {
  if (typeof window === 'undefined' || !window.screen) return undefined
  const scr = window.screen as Screen & { availLeft?: number; availTop?: number }
  if (!scr.availWidth || !scr.availHeight) return undefined
  const dpr = currentScale()
  return {
    availLeft: Math.round((scr.availLeft ?? 0) * dpr),
    availTop: Math.round((scr.availTop ?? 0) * dpr),
    availWidth: Math.round(scr.availWidth * dpr),
    availHeight: Math.round(scr.availHeight * dpr)
  }
}

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/**
 * Computes new `{ x, y, width, height }` for an edge/corner drag resize while
 * keeping the opposite edge anchored when clamping to minimum dimensions.
 */
export function computeResizedBounds(
  start: { x: number; y: number; width: number; height: number },
  deltaX: number,
  deltaY: number,
  dir: ResizeDirection,
  scale = 1
): { x: number; y: number; width: number; height: number } {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const minW = Math.round(MIN_WINDOW_WIDTH * safeScale)
  const minH = Math.round(MIN_WINDOW_HEIGHT * safeScale)
  let { x, y, width, height } = start

  if (dir.includes('e')) {
    width = Math.max(minW, Math.round(start.width + deltaX))
  } else if (dir.includes('w')) {
    const nextWidth = Math.max(minW, Math.round(start.width - deltaX))
    x = Math.round(start.x + (start.width - nextWidth))
    width = nextWidth
  }

  if (dir.includes('s')) {
    height = Math.max(minH, Math.round(start.height + deltaY))
  } else if (dir.includes('n')) {
    const nextHeight = Math.max(minH, Math.round(start.height - deltaY))
    y = Math.round(start.y + (start.height - nextHeight))
    height = nextHeight
  }

  return { x, y, width, height }
}

let activeFlushSnapshot: (() => Promise<void>) | null = null

/** Immediately snapshots and saves current window bounds (used before closing). */
export async function flushWindowBoundsSnapshot(): Promise<void> {
  if (activeFlushSnapshot) {
    await activeFlushSnapshot()
  }
}

/**
 * Restores persisted Neutralino window bounds on startup and continuously
 * snapshots bounds on resize/drag/blur/state-change so restarting reopens in the same spot.
 */
export function initWindowBoundsPersistence(): () => void {
  if (typeof window === 'undefined' || !isNeutralinoRuntime()) {
    return () => {}
  }

  let disposed = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let lastNormalBounds: Omit<WindowBounds, 'isMaximized'> | null = null
  let restoring = false

  const saved = loadWindowBounds()
  if (saved) {
    const startupScale = currentScale()
    const startupScreen = currentScreenBounds()
    const sizeOnly = clampWindowBounds(saved, undefined, startupScale)
    const startupClamped = startupScreen ? clampWindowBounds(saved, startupScreen, startupScale) : sizeOnly
    const fitsStartupScreen =
      startupClamped.x === sizeOnly.x &&
      startupClamped.y === sizeOnly.y &&
      startupClamped.width === sizeOnly.width &&
      startupClamped.height === sizeOnly.height
    const initial = fitsStartupScreen ? startupClamped : sizeOnly
    lastNormalBounds = { x: initial.x, y: initial.y, width: initial.width, height: initial.height }
    restoring = true
    void (async () => {
      try {
        await nlWindow.setSize({ width: initial.width, height: initial.height })
        await nlWindow.move(initial.x, initial.y)
        // Secondary monitors sit outside startup window.screen; wait briefly after move
        // so Chromium updates window.screen to the target display before checking off-screen bounds.
        if (!fitsStartupScreen) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100))
          if (disposed) return
          const postMoveScreen = currentScreenBounds()
          if (postMoveScreen) {
            const verified = clampWindowBounds(initial, postMoveScreen, currentScale())
            if (
              verified.x !== initial.x ||
              verified.y !== initial.y ||
              verified.width !== initial.width ||
              verified.height !== initial.height
            ) {
              lastNormalBounds = { x: verified.x, y: verified.y, width: verified.width, height: verified.height }
              await nlWindow.setSize({ width: verified.width, height: verified.height })
              await nlWindow.move(verified.x, verified.y)
            }
          }
        }
        if (initial.isMaximized) {
          const current = await invoke<WindowIsMaximizedResult>(INVOKE_CHANNELS.windowIsMaximized)
          if (!current.isMaximized) {
            await invoke(INVOKE_CHANNELS.windowMaximizeToggle)
          }
        }
      } catch {
        // Ignore startup restore errors if window is already closing.
      } finally {
        restoring = false
      }
    })()
  }

  let snapshotQueue: Promise<void> = Promise.resolve()

  const runSnapshot = async (): Promise<void> => {
    if (disposed || restoring) return
    try {
      const [{ isMaximized }, pos, size] = await Promise.all([
        invoke<WindowIsMaximizedResult>(INVOKE_CHANNELS.windowIsMaximized),
        nlWindow.getPosition(),
        nlWindow.getSize()
      ])
      if (disposed || restoring) return
      if (!isMaximized && isFiniteNumber(size.width) && isFiniteNumber(size.height)) {
        lastNormalBounds = {
          x: pos.x,
          y: pos.y,
          width: size.width,
          height: size.height
        }
      }
      if (lastNormalBounds) {
        saveWindowBounds({ ...lastNormalBounds, isMaximized })
      }
    } catch {
      // Ignore transient window API errors.
    }
  }

  const snapshot = (): Promise<void> => {
    const next = snapshotQueue.then(runSnapshot, runSnapshot)
    snapshotQueue = next
    return next
  }

  const scheduleSnapshot = (): void => {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void snapshot()
    }, 300)
  }

  const onBlur = (): void => {
    void snapshot()
  }

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      void snapshot()
    }
  }

  const onDirty = (): void => {
    void snapshot()
  }

  activeFlushSnapshot = async () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await snapshot()
  }

  const unsubscribeState = onEvent<WindowStateEvent>(EVENT_CHANNELS.windowStateChange, () => {
    scheduleSnapshot()
  })

  if (!saved) {
    // Seed initial normal bounds so an immediate maximize on first run still persists.
    void snapshot()
  }

  window.addEventListener('resize', scheduleSnapshot)
  window.addEventListener('blur', onBlur)
  window.addEventListener('ferry:window-bounds-dirty', onDirty)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    disposed = true
    activeFlushSnapshot = null
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    unsubscribeState()
    window.removeEventListener('resize', scheduleSnapshot)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('ferry:window-bounds-dirty', onDirty)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

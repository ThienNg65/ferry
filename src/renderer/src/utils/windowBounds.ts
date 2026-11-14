import { window as nlWindow } from '@neutralinojs/lib'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { NativeDisplayInfo, WindowStateEvent, WindowStateResult } from '@shared/contract'
import { invoke, onEvent } from '../api'
import { isNeutralinoRuntime, registerBeforeWindowClose } from '../bridge/neutralinoApi'

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
 * Picks the display work area with the largest overlap with `bounds`, falling back
 * to the primary display if the previously used monitor is no longer connected.
 */
export function pickTargetScreen(
  bounds: Pick<WindowBounds, 'x' | 'y' | 'width' | 'height'>,
  displays: NativeDisplayInfo[]
): ScreenBounds | undefined {
  if (displays.length === 0) return undefined
  let bestDisplay = displays.find((d) => d.isPrimary) ?? displays[0]
  let bestArea = 0

  for (const display of displays) {
    const w = display.workArea
    const overlapW = Math.max(0, Math.min(bounds.x + bounds.width, w.x + w.width) - Math.max(bounds.x, w.x))
    const overlapH = Math.max(0, Math.min(bounds.y + bounds.height, w.y + w.height) - Math.max(bounds.y, w.y))
    const area = overlapW * overlapH
    if (area > bestArea) {
      bestArea = area
      bestDisplay = display
    }
  }

  return {
    availLeft: bestDisplay.workArea.x,
    availTop: bestDisplay.workArea.y,
    availWidth: bestDisplay.workArea.width,
    availHeight: bestDisplay.workArea.height
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
    const minVisibleX = screen.availLeft - clampedWidth + 120
    const maxVisibleX = screen.availLeft + screen.availWidth - 120
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

let activeFlushSnapshot: (() => Promise<void>) | null = null

/** Immediately snapshots and saves current window bounds (used before closing). */
export async function flushWindowBoundsSnapshot(): Promise<void> {
  if (activeFlushSnapshot) {
    await activeFlushSnapshot()
  }
}

/**
 * Restores persisted Neutralino window bounds while `hidden: true`, applies initial
 * theme framing before `window:show`, and continuously snapshots normal bounds.
 */
export function initWindowBoundsPersistence(options?: { beforeShow?: Promise<void> }): () => void {
  if (typeof window === 'undefined' || !isNeutralinoRuntime()) {
    return () => {}
  }

  let disposed = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let lastNormalBounds: Omit<WindowBounds, 'isMaximized'> | null = null
  let restoring = true
  let shown = false

  const showOnce = async (): Promise<void> => {
    if (shown) return
    shown = true
    try {
      await invoke<void>(INVOKE_CHANNELS.windowShow)
    } catch {
      // Ignore if window is already closing.
    }
  }

  // Failsafe so a slow sidecar or RPC error can never leave the window hidden.
  const showFailsafeTimer = setTimeout(() => {
    void showOnce()
  }, 800)

  let snapshotQueue: Promise<void> = Promise.resolve()

  const runSnapshot = async (): Promise<void> => {
    if (disposed || restoring) return
    try {
      const [state, pos, size] = await Promise.all([
        invoke<WindowStateResult>(INVOKE_CHANNELS.windowGetState),
        nlWindow.getPosition(),
        nlWindow.getSize()
      ])
      if (disposed || restoring || state.isMinimized) return
      const posX = pos.x ?? 0
      const posY = pos.y ?? 0
      if (
        !state.isMaximized &&
        !state.isFullScreen &&
        posX > -10000 &&
        posY > -10000 &&
        isFiniteNumber(size.width) &&
        isFiniteNumber(size.height) &&
        size.width >= MIN_WINDOW_WIDTH &&
        size.height >= MIN_WINDOW_HEIGHT
      ) {
        lastNormalBounds = {
          x: posX,
          y: posY,
          width: size.width,
          height: size.height
        }
      }
      if (lastNormalBounds) {
        saveWindowBounds({ ...lastNormalBounds, isMaximized: state.isMaximized })
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

  const saved = loadWindowBounds()
  void (async () => {
    try {
      const beforeShowWait = options?.beforeShow
        ? Promise.race([options.beforeShow.catch(() => {}), new Promise<void>((r) => setTimeout(r, 350))])
        : Promise.resolve()

      if (saved) {
        let displays: NativeDisplayInfo[] = []
        try {
          displays = await Promise.race([
            invoke<NativeDisplayInfo[]>(INVOKE_CHANNELS.windowGetDisplays),
            new Promise<NativeDisplayInfo[]>((resolve) => setTimeout(() => resolve([]), 350))
          ])
        } catch {
          displays = []
        }
        if (disposed) return

        const targetScreen = pickTargetScreen(saved, displays) ?? currentScreenBounds()
        const initial = clampWindowBounds(saved, targetScreen, currentScale())
        lastNormalBounds = { x: initial.x, y: initial.y, width: initial.width, height: initial.height }

        await nlWindow.setSize({ width: initial.width, height: initial.height })
        await nlWindow.move(initial.x, initial.y)
        await beforeShowWait
        if (disposed) return

        if (initial.isMaximized) {
          await nlWindow.maximize()
        }
        await showOnce()
      } else {
        await beforeShowWait
        if (disposed) return
        await showOnce()
      }
    } catch {
      await showOnce()
    } finally {
      clearTimeout(showFailsafeTimer)
      restoring = false
      if (!disposed && !saved) {
        void snapshot()
      }
    }
  })()

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

  activeFlushSnapshot = async () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await snapshot()
  }

  const unregisterCloseHook = registerBeforeWindowClose(() => flushWindowBoundsSnapshot())

  const unsubscribeState = onEvent<WindowStateEvent>(EVENT_CHANNELS.windowStateChange, () => {
    scheduleSnapshot()
  })

  window.addEventListener('resize', scheduleSnapshot)
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    disposed = true
    clearTimeout(showFailsafeTimer)
    activeFlushSnapshot = null
    unregisterCloseHook()
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    unsubscribeState()
    window.removeEventListener('resize', scheduleSnapshot)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

import { describe, expect, it } from 'vitest'
import type { NativeDisplayInfo } from '@shared/contract'
import {
  clampWindowBounds,
  loadWindowBounds,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  pickTargetScreen,
  saveWindowBounds,
  WINDOW_BOUNDS_STORAGE_KEY
} from './windowBounds'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    }
  }
}

describe('windowBounds', () => {
  it('saves and loads valid window bounds', () => {
    const storage = createMemoryStorage()
    const bounds = { x: 120, y: 80, width: 1440, height: 900, isMaximized: true }
    saveWindowBounds(bounds, storage)
    expect(loadWindowBounds(storage)).toEqual(bounds)
  })

  it('returns null for missing or malformed stored bounds', () => {
    const storage = createMemoryStorage()
    expect(loadWindowBounds(storage)).toBeNull()

    storage.setItem(WINDOW_BOUNDS_STORAGE_KEY, '{bad json')
    expect(loadWindowBounds(storage)).toBeNull()

    storage.setItem(WINDOW_BOUNDS_STORAGE_KEY, JSON.stringify({ x: 10, y: 'bad', width: 1000, height: 700 }))
    expect(loadWindowBounds(storage)).toBeNull()
  })

  it('clamps dimensions to minimums and recovers off-screen coordinates', () => {
    const clamped = clampWindowBounds(
      { x: 4000, y: -50, width: 400, height: 300, isMaximized: false },
      { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1032 }
    )
    expect(clamped.width).toBe(MIN_WINDOW_WIDTH)
    expect(clamped.height).toBe(MIN_WINDOW_HEIGHT)
    expect(clamped.x).toBe(1800)
    expect(clamped.y).toBe(0)
  })

  it('scales minimum dimensions for high-DPI displays without exceeding screen bounds', () => {
    const highDpiClamped = clampWindowBounds(
      { x: 2000, y: 100, width: 1000, height: 700, isMaximized: false },
      { availLeft: 1920, availTop: 0, availWidth: 3840, availHeight: 2080 },
      2
    )
    expect(highDpiClamped.width).toBe(MIN_WINDOW_WIDTH * 2)
    expect(highDpiClamped.height).toBe(MIN_WINDOW_HEIGHT * 2)
    expect(highDpiClamped.x).toBe(2000)
  })

  it('picks the display with largest overlap and falls back to primary when unplugged', () => {
    const displays: NativeDisplayInfo[] = [
      {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1032 },
        isPrimary: true,
        scaleFactor: 1
      },
      {
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        workArea: { x: 1920, y: 0, width: 2560, height: 1392 },
        isPrimary: false,
        scaleFactor: 1
      }
    ]

    expect(pickTargetScreen({ x: 2100, y: 100, width: 1280, height: 800 }, displays)).toEqual({
      availLeft: 1920,
      availTop: 0,
      availWidth: 2560,
      availHeight: 1392
    })

    // Disconnected third monitor at x=5000 falls back to primary monitor.
    expect(pickTargetScreen({ x: 5000, y: 100, width: 1280, height: 800 }, displays)).toEqual({
      availLeft: 0,
      availTop: 0,
      availWidth: 1920,
      availHeight: 1032
    })

    expect(pickTargetScreen({ x: 0, y: 0, width: 1280, height: 800 }, [])).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import {
  clampWindowBounds,
  computeResizedBounds,
  loadWindowBounds,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
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
    expect(clamped.x).toBe(1820)
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

    const resizedHighDpi = computeResizedBounds(
      { x: 200, y: 150, width: 2000, height: 1400 },
      500,
      500,
      'nw',
      2
    )
    expect(resizedHighDpi).toEqual({
      x: 400,
      y: 350,
      width: MIN_WINDOW_WIDTH * 2,
      height: MIN_WINDOW_HEIGHT * 2
    })
  })

  it('computes resized bounds while anchoring opposite edge at minimum size', () => {
    const start = { x: 200, y: 150, width: 1000, height: 700 }
    // Dragging top-left inward past minimum size clamps x/y to right/bottom edge minus min dimensions
    expect(computeResizedBounds(start, 300, 300, 'nw')).toEqual({
      x: 300,
      y: 250,
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT
    })
    // Dragging bottom-right outward expands width and height without moving x/y
    expect(computeResizedBounds(start, 120, 80, 'se')).toEqual({
      x: 200,
      y: 150,
      width: 1120,
      height: 780
    })
    // Dragging west edge left expands width and shifts x left; east/south/north/ne/sw
    expect(computeResizedBounds(start, -50, 0, 'w')).toEqual({ x: 150, y: 150, width: 1050, height: 700 })
    expect(computeResizedBounds(start, 50, 0, 'e')).toEqual({ x: 200, y: 150, width: 1050, height: 700 })
    expect(computeResizedBounds(start, 0, -40, 'n')).toEqual({ x: 200, y: 110, width: 1000, height: 740 })
    expect(computeResizedBounds(start, 0, 40, 's')).toEqual({ x: 200, y: 150, width: 1000, height: 740 })
    expect(computeResizedBounds(start, 50, -40, 'ne')).toEqual({ x: 200, y: 110, width: 1050, height: 740 })
    expect(computeResizedBounds(start, -50, 40, 'sw')).toEqual({ x: 150, y: 150, width: 1050, height: 740 })
  })
})

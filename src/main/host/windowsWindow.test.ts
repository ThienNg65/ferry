import { describe, expect, it } from 'vitest'
import { getNativeDisplays, isValidColorRef, parseDisplaysOutput, syncWindowsWindowTheme } from './windowsWindow'

describe('windowsWindow', () => {
  it('parses single and multi-monitor JSON output from PowerShell', () => {
    const single = JSON.stringify({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1032 },
      isPrimary: true,
      scaleFactor: 1
    })
    expect(parseDisplaysOutput(single)).toEqual([
      {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1032 },
        isPrimary: true,
        scaleFactor: 1
      }
    ])

    const multi = JSON.stringify([
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
        scaleFactor: 1.5
      }
    ])
    expect(parseDisplaysOutput(multi)).toHaveLength(2)
  })

  it('returns empty array on malformed or empty display output', () => {
    expect(parseDisplaysOutput('')).toEqual([])
    expect(parseDisplaysOutput('{bad json')).toEqual([])
    expect(parseDisplaysOutput(JSON.stringify([{ bounds: { x: 0, y: 0, width: 0, height: 10 } }]))).toEqual([])
  })

  it('validates Win32 COLORREF caption color integers', () => {
    expect(isValidColorRef(0)).toBe(true)
    expect(isValidColorRef(0x262626)).toBe(true)
    expect(isValidColorRef(0xffffff)).toBe(true)
    expect(isValidColorRef(-1)).toBe(false)
    expect(isValidColorRef(0x1000000)).toBe(false)
    expect(isValidColorRef(1.5)).toBe(false)
    expect(isValidColorRef('#262626')).toBe(false)
  })

  it('is a safe no-op on non-Windows platforms', async () => {
    expect(await getNativeDisplays('linux')).toEqual([])
    await expect(syncWindowsWindowTheme('dark', 1234, 'linux', 0x262626)).resolves.toBeUndefined()
  })
})

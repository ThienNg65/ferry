import { execFile } from 'child_process'
import { promisify } from 'util'
import type { DisplayBounds, NativeDisplayInfo } from '../../shared/contract'

const execFileAsync = promisify(execFile)

function isDisplayBounds(v: unknown): v is DisplayBounds {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.x === 'number' &&
    Number.isFinite(r.x) &&
    typeof r.y === 'number' &&
    Number.isFinite(r.y) &&
    typeof r.width === 'number' &&
    Number.isFinite(r.width) &&
    r.width > 0 &&
    typeof r.height === 'number' &&
    Number.isFinite(r.height) &&
    r.height > 0
  )
}

/** Parses JSON monitor geometry emitted by `Screen.AllScreens`. */
export function parseDisplaysOutput(raw: string): NativeDisplayInfo[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed) as unknown
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const result: NativeDisplayInfo[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      if (!isDisplayBounds(rec.bounds) || !isDisplayBounds(rec.workArea)) continue
      result.push({
        bounds: rec.bounds,
        workArea: rec.workArea,
        isPrimary: Boolean(rec.isPrimary),
        scaleFactor: typeof rec.scaleFactor === 'number' && rec.scaleFactor > 0 ? rec.scaleFactor : 1
      })
    }
    return result
  } catch {
    return []
  }
}

/** Queries all connected displays and their taskbar-adjusted work areas on Windows. */
export async function getNativeDisplays(platform: NodeJS.Platform = process.platform): Promise<NativeDisplayInfo[]> {
  if (platform !== 'win32') return []
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$screens = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {',
    '  [PSCustomObject]@{',
    '    bounds = @{ x = $_.Bounds.X; y = $_.Bounds.Y; width = $_.Bounds.Width; height = $_.Bounds.Height }',
    '    workArea = @{ x = $_.WorkingArea.X; y = $_.WorkingArea.Y; width = $_.WorkingArea.Width; height = $_.WorkingArea.Height }',
    '    isPrimary = [bool]$_.Primary',
    '    scaleFactor = 1',
    '  }',
    '}',
    '$screens | ConvertTo-Json -Compress -Depth 3'
  ].join('; ')
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true, timeout: 3000 }
    )
    return parseDisplaysOutput(stdout)
  } catch {
    return []
  }
}

const DWM_THEME_CS = `
using System;
using System.Runtime.InteropServices;
public static class FerryDwm {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
  public static void ApplyDark(uint targetPid, int dark, int captionColor) {
    EnumWindows((hwnd, lParam) => {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (pid != targetPid) return true;
      if (GetWindow(hwnd, 4) != IntPtr.Zero) return true;
      long style = GetWindowLongPtr64(hwnd, -16).ToInt64();
      if ((style & 0x00C00000L) == 0) return true;
      int val = dark;
      if (DwmSetWindowAttribute(hwnd, 20, ref val, 4) != 0) {
        DwmSetWindowAttribute(hwnd, 19, ref val, 4);
      }
      if (captionColor >= 0 && captionColor <= 0x00ffffff) {
        int cap = captionColor;
        DwmSetWindowAttribute(hwnd, 35, ref cap, 4);
      }
      return true;
    }, IntPtr.Zero);
  }
}`

/** True when `value` is an integer Win32 COLORREF (`0x000000`–`0xffffff`). */
export function isValidColorRef(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff
}

interface PendingThemeSync {
  theme: 'light' | 'dark'
  captionColor?: number
}

let themeSyncInFlight: Promise<void> | null = null
let pendingSync: PendingThemeSync | null = null

async function runThemeSyncOnce(req: PendingThemeSync, hostPid: number): Promise<void> {
  const darkFlag = req.theme === 'dark' ? 1 : 0
  const captionArg = isValidColorRef(req.captionColor) ? req.captionColor : -1
  const script = `Add-Type -TypeDefinition @'\n${DWM_THEME_CS}\n'@; [FerryDwm]::ApplyDark(${hostPid}, ${darkFlag}, ${captionArg})`
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true, timeout: 3000 }
    )
  } catch {
    // Non-fatal: older Windows builds or non-host test environments may not expose DWM.
  }
}

/**
 * Applies Windows 10/11 dark/light framing (`DWMWA_USE_IMMUTABLE_DARK_MODE`) and optional
 * Windows 11 caption color (`DWMWA_CAPTION_COLOR`) to the parent Neutralino host window,
 * including while `hidden: true`.
 */
export async function syncWindowsWindowTheme(
  theme: 'light' | 'dark',
  hostPid: number = process.ppid,
  platform: NodeJS.Platform = process.platform,
  captionColor?: number
): Promise<void> {
  if (platform !== 'win32' || !Number.isInteger(hostPid) || hostPid <= 0) return
  pendingSync = { theme, captionColor }
  if (themeSyncInFlight) {
    await themeSyncInFlight
    return
  }
  themeSyncInFlight = (async () => {
    while (pendingSync !== null) {
      const next = pendingSync
      pendingSync = null
      await runThemeSyncOnce(next, hostPid)
    }
  })().finally(() => {
    themeSyncInFlight = null
  })
  await themeSyncInFlight
}

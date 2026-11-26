import { INVOKE_CHANNELS } from '../../shared/contract'
import { getNativeDisplays, isValidColorRef, syncWindowsWindowTheme } from '../host/windowsWindow'
import { handle } from './envelope'
import { failValidation } from './validation'

/** Registers sidecar-backed Windows native window integration channels. */
export function registerWindowHandlers(): void {
  handle(INVOKE_CHANNELS.windowSyncTheme, (payload: unknown) => {
    const raw =
      typeof payload === 'string'
        ? { theme: payload, captionColor: undefined }
        : payload && typeof payload === 'object'
          ? (payload as { theme?: unknown; captionColor?: unknown })
          : null
    if (!raw || (raw.theme !== 'light' && raw.theme !== 'dark')) {
      failValidation(INVOKE_CHANNELS.windowSyncTheme, `Invalid window theme: ${String(payload)}`)
    }
    if (raw.captionColor !== undefined && !isValidColorRef(raw.captionColor)) {
      failValidation(INVOKE_CHANNELS.windowSyncTheme, `Invalid window captionColor: ${String(raw.captionColor)}`)
    }
    return syncWindowsWindowTheme(raw.theme, undefined, undefined, raw.captionColor)
  })

  handle(INVOKE_CHANNELS.windowGetDisplays, () => getNativeDisplays())
}

import type { BrowserWindow } from 'electron'
import { handle } from './envelope'
import { INVOKE_CHANNELS, type WindowIsMaximizedResult } from '../../shared/contract'

/** Registers custom-titlebar window-control handlers (minimize/maximize/close). */
export function registerWindowHandlers(getMainWindow: () => BrowserWindow | null): void {
  handle<void>(INVOKE_CHANNELS.windowMinimize, () => {
    getMainWindow()?.minimize()
  })

  handle<void>(INVOKE_CHANNELS.windowMaximizeToggle, () => {
    const win = getMainWindow()
    if (!win) {
      return
    }
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  handle<void>(INVOKE_CHANNELS.windowClose, () => {
    getMainWindow()?.close()
  })

  handle<WindowIsMaximizedResult>(INVOKE_CHANNELS.windowIsMaximized, () => ({
    isMaximized: getMainWindow()?.isMaximized() ?? false
  }))
}

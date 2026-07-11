import { BrowserWindow, dialog } from 'electron'
import { handle } from './envelope'
import { INVOKE_CHANNELS } from '../../shared/contract'

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

/** Registers native open-file / open-folder dialog handlers. */
export function registerDialogHandlers(): void {
  handle<string | null>(INVOKE_CHANNELS.dialogPickFile, async () => {
    const win = focusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'] })
      : await dialog.showOpenDialog({ properties: ['openFile'] })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  handle<string | null>(INVOKE_CHANNELS.dialogPickFolder, async () => {
    const win = focusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })
}

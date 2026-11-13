import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron'
import type { Host } from './host'

export const electronHost: Host = {
  broadcast(channel, payload) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    }
  },
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plaintext) => safeStorage.encryptString(plaintext).toString('base64'),
  decrypt: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext, 'base64')),
  get dataDir() {
    return app.getPath('userData')
  },
  openPath: (p) => shell.openPath(p),
  async pickOpenFile(options) {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const dialogOpts = {
      properties: ['openFile' as const],
      ...(options?.filters ? { filters: options.filters } : {})
    }
    const result = win ? await dialog.showOpenDialog(win, dialogOpts) : await dialog.showOpenDialog(dialogOpts)
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  }
}

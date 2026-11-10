import { app, BrowserWindow, safeStorage, shell } from 'electron'
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
  openPath: (p) => shell.openPath(p)
}

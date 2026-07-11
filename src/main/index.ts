import { app, BrowserWindow, Menu, shell } from 'electron'
import path from 'path'
import { registerSitesHandlers } from './ipc/sites.ipc'
import { registerSessionHandlers } from './ipc/session.ipc'
import { registerActivityHandlers } from './ipc/activity.ipc'
import { registerDialogHandlers } from './ipc/dialog.ipc'
import { registerFsHandlers } from './ipc/fs.ipc'
import { registerTransferHandlers } from './ipc/transfer.ipc'
import { registerTailHandlers } from './ipc/tail.ipc'
import { registerUnzipHandlers } from './ipc/unzip.ipc'

/** Development mode flag — set by electron-vite. */
const IS_DEV = !app.isPackaged

/** Resolved path to the compiled preload script. */
const PRELOAD_PATH = path.join(__dirname, '../preload/index.js')

/**
 * Creates the single application BrowserWindow with hardened security
 * settings and a custom frameless title bar (drawn by the renderer).
 *
 * Security flags applied:
 *  - `nodeIntegration: false`    — Node.js APIs are not exposed in the renderer
 *  - `contextIsolation: true`    — renderer runs in an isolated context
 *  - `sandbox: true`             — renderer process is sandboxed at the OS level
 *  - `webSecurity: true`         — prevents loading local resources cross-origin
 *  - preload script exposed only via `contextBridge`
 */
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#18181b',
    titleBarStyle: 'hidden',
    // Native Windows overlay draws real minimize/maximize/close buttons over
    // our custom draggable title bar — required on Windows since 'hidden'
    // alone removes ALL window chrome, leaving no way to close the window.
    titleBarOverlay: {
      color: '#18181b',
      symbolColor: '#a1a1aa',
      height: 36
    },
    webPreferences: {
      preload: PRELOAD_PATH,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  })

  // Open external links in the OS browser, not in Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.once('ready-to-show', () => {
    win.show()
    if (IS_DEV) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  })

  const devUrl = IS_DEV ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** Registers all IPC channel handlers for the lifetime of the application. */
function registerAllHandlers(): void {
  registerSitesHandlers()
  registerSessionHandlers()
  registerActivityHandlers()
  registerDialogHandlers()
  registerFsHandlers()
  registerTransferHandlers()
  registerTailHandlers()
  registerUnzipHandlers()
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // No default menu bar — replaced by the in-app command palette / app menu.
  Menu.setApplicationMenu(null)

  registerAllHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

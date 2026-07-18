import { app, BrowserWindow, Menu, shell } from 'electron'
import path from 'path'
import { registerSitesHandlers } from './ipc/sites.ipc'
import { registerSettingsHandlers } from './ipc/settings.ipc'
import { registerSessionHandlers } from './ipc/session.ipc'
import { registerDialogHandlers } from './ipc/dialog.ipc'
import { registerFsHandlers } from './ipc/fs.ipc'
import { registerTransferHandlers } from './ipc/transfer.ipc'
import { registerTailHandlers } from './ipc/tail.ipc'
import { registerTerminalHandlers } from './ipc/terminal.ipc'
import { registerUnzipHandlers } from './ipc/unzip.ipc'
import { registerArchiveHandlers } from './ipc/archive.ipc'
import { registerOperationsHandlers } from './ipc/operations.ipc'
import { registerSystemHandlers } from './ipc/system.ipc'
import { registerWindowHandlers } from './ipc/window.ipc'
import { registerUpdateHandlers } from './ipc/update.ipc'
import { initAutoUpdater } from './update/AutoUpdater'
import { AppSettingsStore } from './app/AppSettingsStore'
import { TransferQueue } from './transfer/TransferQueue'
import { EVENT_CHANNELS, type WindowStateEvent } from '../shared/contract'

/** Development mode flag — set by electron-vite. */
const IS_DEV = !app.isPackaged

/** Resolved path to the compiled preload script. */
const PRELOAD_PATH = path.join(__dirname, '../preload/index.js')

/** The single application window — referenced by the window-control IPC handlers. */
let mainWindow: BrowserWindow | null = null

/**
 * Creates the single application BrowserWindow with hardened security
 * settings and a fully custom frameless title bar (drawn by the renderer,
 * including minimize/maximize/close buttons — see TitleBar.vue).
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
    // Dev-mode-only taskbar/window icon (packaged builds inherit the icon
    // embedded in the exe via electron-builder's `win.icon`, since `resources/`
    // isn't otherwise shipped into the packaged app's `files`).
    icon: IS_DEV ? path.join(__dirname, '../../resources/favicon.ico') : undefined,
    // 'hidden' alone removes ALL native chrome on Windows (no OS-drawn caption
    // buttons at all) — intentional, since TitleBar.vue renders its own
    // minimize/maximize/close buttons wired to the window:* IPC channels below.
    titleBarStyle: 'hidden',
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

  const broadcastWindowState = (): void => {
    const payload: WindowStateEvent = { isMaximized: win.isMaximized() }
    if (!win.isDestroyed()) {
      win.webContents.send(EVENT_CHANNELS.windowStateChange, payload)
    }
  }
  win.on('maximize', broadcastWindowState)
  win.on('unmaximize', broadcastWindowState)

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
  registerSettingsHandlers()
  registerSessionHandlers()
  registerDialogHandlers()
  registerFsHandlers()
  registerTransferHandlers()
  registerTailHandlers()
  registerTerminalHandlers()
  registerUnzipHandlers()
  registerArchiveHandlers()
  registerOperationsHandlers()
  registerSystemHandlers()
  registerWindowHandlers(() => mainWindow)
  registerUpdateHandlers()
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // No default menu bar on Windows/Linux — replaced by the in-app command
  // palette; Chromium dispatches native edit commands (copy/paste in inputs)
  // without a menu there. macOS is different: Cmd+C/V only work via menu-role
  // accelerators, so keep a minimal app+edit menu on darwin.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]))
  } else {
    Menu.setApplicationMenu(null)
  }

  registerAllHandlers()
  TransferQueue.getInstance().setBandwidthLimitKBps(AppSettingsStore.getInstance().get().bandwidthLimitKBps)
  mainWindow = createWindow()
  initAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

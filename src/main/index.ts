const mainStartTime = performance.now()
const mainTimeOrigin = performance.timeOrigin
const isProfiling =
  process.argv.includes('--profile-startup') ||
  process.argv.includes('--profiling') ||
  process.env['FERRY_PROFILE'] === '1' ||
  process.env['IS_PROFILING'] === 'true'

let appReadyTime = 0
let readyToShowTime = 0

import { app, BrowserWindow, ipcMain, Menu, session, shell } from 'electron'
import path from 'path'
import { registerSitesHandlers } from './ipc/sites.ipc'
import { registerSettingsHandlers } from './ipc/settings.ipc'
import { registerSessionHandlers } from './ipc/session.ipc'
import { registerDialogHandlers } from './ipc/dialog.ipc'
import { registerKeysHandlers } from './ipc/keys.ipc'
import { registerBookmarksHandlers } from './ipc/bookmarks.ipc'
import { registerHistoryHandlers } from './ipc/history.ipc'
import { initHistoryRecorder } from './history/HistoryRecorder'
import { HistoryStore } from './history/HistoryStore'
import { registerEditHandlers } from './ipc/edit.ipc'
import { EditSessionManager } from './edit/EditSessionManager'
import { registerSyncHandlers } from './ipc/sync.ipc'
import { registerFsHandlers } from './ipc/fs.ipc'
import { registerTransferHandlers } from './ipc/transfer.ipc'
import { registerTailHandlers } from './ipc/tail.ipc'
import { registerTerminalHandlers } from './ipc/terminal.ipc'
import { registerUnzipHandlers } from './ipc/unzip.ipc'
import { registerArchiveHandlers } from './ipc/archive.ipc'
import { registerOperationsHandlers } from './ipc/operations.ipc'
import { registerMonitorHandlers } from './ipc/monitor.ipc'
import { registerSystemHandlers } from './ipc/system.ipc'
import { registerWindowHandlers } from './ipc/window.ipc'
import { registerUpdateHandlers } from './ipc/update.ipc'
import { initAutoUpdater } from './update/AutoUpdater'
import { AppSettingsStore } from './app/AppSettingsStore'
import { TransferQueue } from './transfer/TransferQueue'
import { KnownHostsStore } from './ssh/KnownHostsStore'
import { EVENT_CHANNELS, INVOKE_CHANNELS, ok, type WindowStateEvent, type ProfileReportPayload } from '../shared/contract'

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
      experimentalFeatures: false,
      v8CacheOptions: 'bypassHeatCheck'
    }
  })

  // Open external links in the OS browser, not in Electron — but only for
  // http(s). A URL rendered from remote SSH data (a log line, a filename) must
  // never be able to invoke an arbitrary OS handler via file:/custom schemes.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url)
      if (protocol === 'http:' || protocol === 'https:') {
        shell.openExternal(url)
      }
    } catch {
      // Malformed URL — ignore, never open.
    }
    return { action: 'deny' }
  })

  // Defense-in-depth: this is a single-window SPA with no vue-router, so no
  // legitimate top-level navigation ever occurs. `will-navigate` does not fire
  // for the initial loadURL/loadFile, so unconditionally blocking it prevents
  // the renderer frame from ever being steered to untrusted content.
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  win.once('ready-to-show', () => {
    if (!readyToShowTime) {
      readyToShowTime = performance.now()
    }
    if (!win.isVisible()) {
      win.show()
    }
    if (IS_DEV && !isProfiling) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
    // Defer non-critical store reads, history recorder, auto-updater, bandwidth limit,
    // and heavy modules until post-ready-to-show frame
    setTimeout(() => {
      try {
        initHistoryRecorder()
        TransferQueue.getInstance().setBandwidthLimitKBps(AppSettingsStore.getInstance().get().bandwidthLimitKBps)
        void initAutoUpdater()
      } catch (err) {
        console.error('Post ready-to-show setup failed:', err)
      }
      void import('ssh2').catch(() => {})
      try {
        KnownHostsStore.getInstance()
      } catch {
        // A corrupted known_hosts.json must not crash the app at startup —
        // it'll surface (and can be dealt with) when the user next connects.
      }
    }, 0)
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
  readyToShowTime = performance.now()
  win.show()

  return win
}

function registerProfileHandler(): void {
  ipcMain.handle(INVOKE_CHANNELS.profileReport, (_event, payload: ProfileReportPayload) => {
    if (isProfiling) {
      const mainAbsT0 = mainTimeOrigin + mainStartTime
      const appReadyMs = Math.max(0, appReadyTime - mainStartTime)

      const actualReadyToShowTime = readyToShowTime > 0 ? readyToShowTime : performance.now()
      const readyToShowMs = Math.max(0, actualReadyToShowTime - mainStartTime)

      const preloadStartAbs = payload.preloadTimeOrigin + payload.preloadStart
      const preloadStartMs = Math.max(0, preloadStartAbs - mainAbsT0)

      const rendererStartAbs = payload.rendererTimeOrigin + payload.rendererStart
      const rendererStartMs = Math.max(0, rendererStartAbs - mainAbsT0)

      const rendererMountAbs = payload.rendererMountTimeOrigin + payload.rendererMount
      const rendererMountMs = Math.max(0, rendererMountAbs - mainAbsT0)

      const firstPaintAbs = payload.rendererMountTimeOrigin + payload.firstPaint
      const firstPaintMs = Math.max(0, firstPaintAbs - mainAbsT0)

      const result = {
        mainStart: 0,
        appReady: Math.round(appReadyMs * 100) / 100,
        readyToShow: Math.round(readyToShowMs * 100) / 100,
        preloadStart: Math.round(preloadStartMs * 100) / 100,
        rendererStart: Math.round(rendererStartMs * 100) / 100,
        rendererMount: Math.round(rendererMountMs * 100) / 100,
        firstPaint: Math.round(firstPaintMs * 100) / 100,
        totalStartupMs: Math.round(firstPaintMs * 100) / 100,
        phases: {
          mainToAppReadyMs: Math.round(appReadyMs * 100) / 100,
          appReadyToReadyToShowMs: Math.round(Math.max(0, readyToShowMs - appReadyMs) * 100) / 100,
          readyToShowToRendererMountMs: Math.round(Math.max(0, rendererMountMs - readyToShowMs) * 100) / 100,
          rendererMountToFirstPaintMs: Math.round(Math.max(0, firstPaintMs - rendererMountMs) * 100) / 100
        }
      }
      process.stdout.write(`[FERRY_PROFILE_RESULT] ${JSON.stringify(result)}\n`)
      setTimeout(() => {
        app.quit()
      }, 50)
    }
    return ok(null)
  })
}


/** Registers all IPC channel handlers for the lifetime of the application. */
function registerAllHandlers(): void {
  registerSitesHandlers()
  registerSettingsHandlers()
  registerSessionHandlers()
  registerDialogHandlers()
  registerKeysHandlers()
  registerBookmarksHandlers()
  registerHistoryHandlers()
  registerEditHandlers()
  registerSyncHandlers()
  registerFsHandlers()
  registerTransferHandlers()
  registerTailHandlers()
  registerTerminalHandlers()
  registerUnzipHandlers()
  registerArchiveHandlers()
  registerOperationsHandlers()
  registerMonitorHandlers()
  registerSystemHandlers()
  registerWindowHandlers(() => mainWindow)
  registerUpdateHandlers()
  registerProfileHandler()
}


// ── Bootstrap ──────────────────────────────────────────────────────────────

app.commandLine.appendSwitch('proxy-server', 'direct://')
app.commandLine.appendSwitch('no-proxy-server')
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disable-http-cache')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-extensions')
app.commandLine.appendSwitch('disable-default-apps')
app.commandLine.appendSwitch('process-per-site')

app.whenReady().then(() => {
  appReadyTime = performance.now()
  // No default menu bar on Windows/Linux — replaced by the in-app command

  // palette; Chromium dispatches native edit commands (copy/paste in inputs)
  // without a menu there. macOS is different: Cmd+C/V only work via menu-role
  // accelerators, so keep a minimal app+edit menu on darwin.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]))
  } else {
    Menu.setApplicationMenu(null)
  }

  // Deny every renderer permission request EXCEPT clipboard-write: "Copy path"
  // (FileRow.vue) and the terminal's Ctrl+C copy-selection (terminalStreams.store.ts)
  // both call navigator.clipboard.writeText(), which Chromium gates behind the
  // clipboard-sanitized-write permission — a blanket deny broke both silently
  // (NotAllowedError at the call site, easy to miss without exercising them).
  // clipboard-read is deliberately NOT allowed: the app already reads the OS
  // clipboard through the main-process `clipboard.readText()` IPC instead (see
  // terminalStreams.store.ts), so the renderer never needs it directly.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write')
  })

  registerAllHandlers()
  mainWindow = createWindow()

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

// Delays actual quit by one tick to let EditSessionManager best-effort clean
// up fully-synced temp files first — `quitting` guards against re-entering
// this handler when the `app.quit()` call below re-fires `before-quit`.
let quitting = false
app.on('before-quit', (event) => {
  if (quitting) {
    return
  }
  event.preventDefault()
  quitting = true
  // Flush any debounced-but-not-yet-written history entries synchronously
  // before EditSessionManager's async cleanup — HistoryStore.flush() is
  // itself synchronous (electron-store writes are), so this can't race it.
  HistoryStore.getInstance().flush()
  void EditSessionManager.getInstance()
    .disposeAll()
    .finally(() => app.quit())
})

import { app, BrowserWindow } from 'electron'
import {
  EVENT_CHANNELS,
  type CheckUpdateResult,
  type UpdateAvailableEvent,
  type UpdateDownloadedEvent,
  type UpdateState
} from '../../shared/contract'
import { AppSettingsStore } from '../app/AppSettingsStore'

let initialized = false
let periodicTimer: NodeJS.Timeout | null = null
let cachedAutoUpdater: typeof import('electron-updater').autoUpdater | null = null

let currentState: UpdateState = {
  status: app.isPackaged ? 'idle' : 'disabled',
  currentVersion: app.getVersion()
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function updateState(patch: Partial<UpdateState>): void {
  currentState = { ...currentState, ...patch }
  broadcast(EVENT_CHANNELS.updateStatus, currentState)
}

/** Resolves the autoUpdater instance across ESM/CJS interop boundaries. */
async function getAutoUpdater() {
  if (cachedAutoUpdater) {
    return cachedAutoUpdater
  }
  const mod = (await import('electron-updater')) as {
    autoUpdater?: typeof import('electron-updater').autoUpdater
    default?: { autoUpdater?: typeof import('electron-updater').autoUpdater }
  }
  const updater = mod.default?.autoUpdater ?? mod.autoUpdater
  if (!updater) {
    throw new Error('electron-updater failed to load autoUpdater instance')
  }
  cachedAutoUpdater = updater
  return updater
}

/** Returns the current snapshot of auto-update state. */
export function getUpdateState(): UpdateState {
  return { ...currentState }
}

/**
 * Wires electron-updater's GitHub-Releases-based update check.
 *
 * `electron-builder.yml`'s `publish.owner`/`publish.repo` point at the real
 * repo, and `.github/workflows/ci.yml`'s `auto-release` job publishes a real
 * GitHub Release (including `latest.yml`) on every push to `main` — so the
 * feed itself is real and live.
 *
 * In dev (`app.isPackaged` is false), status is marked as 'disabled'.
 */
export async function initAutoUpdater(): Promise<void> {
  if (initialized) {
    return
  }
  initialized = true

  if (!app.isPackaged) {
    updateState({ status: 'disabled' })
    return
  }

  const autoUpdater = await getAutoUpdater()
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    updateState({ status: 'checking', error: undefined })
  })

  autoUpdater.on('update-available', (info) => {
    updateState({
      status: 'downloading',
      availableVersion: info.version,
      error: undefined
    })
    broadcast(EVENT_CHANNELS.updateAvailable, { version: info.version } satisfies UpdateAvailableEvent)
  })

  autoUpdater.on('download-progress', (progress) => {
    updateState({
      status: 'downloading',
      progress: {
        percent: Math.round(progress.percent),
        bytesPerSecond: Math.round(progress.bytesPerSecond),
        transferred: progress.transferred,
        total: progress.total
      }
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateState({
      status: 'downloaded',
      availableVersion: info.version,
      error: undefined
    })
    broadcast(EVENT_CHANNELS.updateDownloaded, { version: info.version } satisfies UpdateDownloadedEvent)
  })

  autoUpdater.on('update-not-available', () => {
    updateState({ status: 'not-available', error: undefined })
  })

  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[AutoUpdater]', err)
    updateState({ status: 'error', error: message })
  })

  // Periodic check timer (every 6 hours)
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000
  if (periodicTimer) {
    clearInterval(periodicTimer)
  }
  periodicTimer = setInterval(() => {
    const settings = AppSettingsStore.getInstance().get()
    if (settings.autoCheckUpdates !== false) {
      void checkForUpdates(false)
    }
  }, SIX_HOURS_MS)
  periodicTimer.unref?.()

  const settings = AppSettingsStore.getInstance().get()
  if (settings.autoCheckUpdates !== false) {
    void checkForUpdates(false)
  }
}

/** Checks for updates immediately. If isManual is true, returns status or error directly to caller. */
export async function checkForUpdates(isManual = false): Promise<CheckUpdateResult> {
  if (!app.isPackaged) {
    updateState({ status: 'disabled' })
    return { status: 'disabled', error: 'Updates are disabled in development mode' }
  }

  if (currentState.status === 'checking' || currentState.status === 'downloading') {
    return { status: currentState.status, version: currentState.availableVersion }
  }

  updateState({
    status: 'checking',
    lastCheckedAt: new Date().toISOString(),
    error: undefined
  })

  try {
    const autoUpdater = await getAutoUpdater()
    const checkResult = await autoUpdater.checkForUpdates()
    if (!checkResult || checkResult.updateInfo.version === app.getVersion()) {
      updateState({ status: 'not-available' })
      return { status: 'not-available', version: app.getVersion() }
    }
    return { status: 'available', version: checkResult.updateInfo.version }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (isManual) {
      console.error('[AutoUpdater] manual checkForUpdates failed', err)
    } else {
      console.error('[AutoUpdater] background checkForUpdates failed', err)
    }
    updateState({ status: 'error', error: message })
    return { status: 'error', error: message }
  }
}

/** Quits and installs the already-downloaded update immediately, instead of waiting for the next natural app quit. */
export async function installUpdateNow(): Promise<void> {
  const autoUpdater = await getAutoUpdater()
  autoUpdater.quitAndInstall()
}

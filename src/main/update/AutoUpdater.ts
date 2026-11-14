import {
  EVENT_CHANNELS,
  type CheckUpdateResult,
  type UpdateAvailableEvent,
  type UpdateDownloadedEvent,
  type UpdateState
} from '../../shared/contract'
import { AppSettingsStore } from '../app/AppSettingsStore'
import { host } from '../host/host'
import { getSidecarUpdater, type SidecarUpdater } from './SidecarUpdater'

let initialized = false
let periodicTimer: NodeJS.Timeout | null = null
let cachedAutoUpdater: SidecarUpdater | null = null
let currentState: UpdateState | null = null

function getIsPackaged(): boolean {
  return Boolean(host().isPackaged)
}

function getAppVersion(): string {
  return host().appVersion ?? '0.24.0'
}

function ensureState(): UpdateState {
  if (!currentState) {
    currentState = {
      status: getIsPackaged() ? 'idle' : 'disabled',
      currentVersion: getAppVersion()
    }
  }
  return currentState
}

function updateState(patch: Partial<UpdateState>): void {
  currentState = { ...ensureState(), currentVersion: getAppVersion(), ...patch }
  host().broadcast(EVENT_CHANNELS.updateStatus, currentState)
}

/** Resolves the Neutralino sidecar updater instance. */
function getAutoUpdater(): SidecarUpdater {
  if (!cachedAutoUpdater) {
    cachedAutoUpdater = getSidecarUpdater()
  }
  return cachedAutoUpdater
}

/** Returns the current snapshot of auto-update state. */
export function getUpdateState(): UpdateState {
  return { ...ensureState() }
}

/** Resets singleton state for unit tests. */
export function resetAutoUpdaterForTests(): void {
  initialized = false
  if (periodicTimer) {
    clearInterval(periodicTimer)
    periodicTimer = null
  }
  cachedAutoUpdater = null
  currentState = null
}

/**
 * Wires GitHub-Releases-based update checks via {@link SidecarUpdater}.
 *
 * In unpackaged development mode (`host().isPackaged === false`), status is marked `'disabled'`.
 */
export async function initAutoUpdater(checkImmediately = true): Promise<void> {
  if (initialized) {
    return
  }
  initialized = true

  if (!getIsPackaged()) {
    updateState({ status: 'disabled' })
    return
  }

  const autoUpdater = getAutoUpdater()
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    updateState({ status: 'checking', error: undefined })
  })

  autoUpdater.on('update-available', (info: { version: string }) => {
    updateState({
      status: 'downloading',
      availableVersion: info.version,
      error: undefined
    })
    host().broadcast(EVENT_CHANNELS.updateAvailable, { version: info.version } satisfies UpdateAvailableEvent)
  })

  autoUpdater.on('download-progress', (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => {
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

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    updateState({
      status: 'downloaded',
      availableVersion: info.version,
      error: undefined
    })
    host().broadcast(EVENT_CHANNELS.updateDownloaded, { version: info.version } satisfies UpdateDownloadedEvent)
  })

  autoUpdater.on('update-not-available', () => {
    updateState({ status: 'not-available', error: undefined })
  })

  autoUpdater.on('error', (err: unknown) => {
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

  if (checkImmediately) {
    const settings = AppSettingsStore.getInstance().get()
    if (settings.autoCheckUpdates !== false) {
      void checkForUpdates(false)
    }
  }
}

/** Checks for updates immediately. If isManual is true, returns status or error directly to caller. */
export async function checkForUpdates(isManual = false): Promise<CheckUpdateResult> {
  if (!getIsPackaged()) {
    updateState({ status: 'disabled' })
    return { status: 'disabled', error: 'Updates are disabled in development mode' }
  }

  await initAutoUpdater(false)

  const state = ensureState()
  if (state.status === 'checking' || state.status === 'downloading') {
    return { status: state.status, version: state.availableVersion }
  }

  updateState({
    status: 'checking',
    lastCheckedAt: new Date().toISOString(),
    error: undefined
  })

  try {
    const autoUpdater = getAutoUpdater()
    const checkResult = await autoUpdater.checkForUpdates()
    const currentVer = getAppVersion()
    if (!checkResult || checkResult.updateInfo.version === currentVer) {
      updateState({ status: 'not-available' })
      return { status: 'not-available', version: currentVer }
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
  await initAutoUpdater(false)
  const autoUpdater = getAutoUpdater()
  autoUpdater.quitAndInstall(true, true)
}

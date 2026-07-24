import { app, BrowserWindow } from 'electron'
import {
  EVENT_CHANNELS,
  type UpdateAvailableEvent,
  type UpdateDownloadedEvent
} from '../../shared/contract'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

/**
 * Wires electron-updater's GitHub-Releases-based update check.
 *
 * This is genuinely greenfield scaffolding, not a fully proven feature: it
 * needs `electron-builder.yml`'s `publish.owner`/`publish.repo` pointing at a
 * real repo with a real published release, and a code-signing certificate
 * (see `electron-builder.yml`'s own comment on `CSC_LINK`/`CSC_KEY_PASSWORD`)
 * for the installed update to be trusted on Windows — neither exists in this
 * dev environment, so this has never been exercised against a real release.
 * A no-op in dev (`app.isPackaged` is false, matching electron-updater's own
 * recommendation not to run update checks against a local/unpackaged build).
 */
export async function initAutoUpdater(): Promise<void> {
  if (!app.isPackaged) {
    return
  }

  const { autoUpdater } = await import('electron-updater')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    broadcast(EVENT_CHANNELS.updateAvailable, { version: info.version } satisfies UpdateAvailableEvent)
  })
  autoUpdater.on('update-downloaded', (info) => {
    broadcast(EVENT_CHANNELS.updateDownloaded, { version: info.version } satisfies UpdateDownloadedEvent)
  })
  // Swallowed deliberately: until electron-builder.yml's publish placeholders
  // are replaced with a real repo, every check fails the same way (no feed to
  // query) — there's nothing actionable for a user to do about it, so this
  // must never surface as an error toast.
  autoUpdater.on('error', () => {})

  autoUpdater.checkForUpdates().catch(() => {})
}

/** Quits and installs the already-downloaded update immediately, instead of waiting for the next natural app quit. */
export async function installUpdateNow(): Promise<void> {
  const { autoUpdater } = await import('electron-updater')
  autoUpdater.quitAndInstall()
}

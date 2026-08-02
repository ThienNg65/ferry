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
 * `electron-builder.yml`'s `publish.owner`/`publish.repo` point at the real
 * repo, and `.github/workflows/ci.yml`'s `auto-release` job publishes a real
 * GitHub Release (including `latest.yml`) on every push to `main` — so the
 * feed itself is real and live. Two things remain genuinely unproven: the
 * installer isn't code-signed yet (see `electron-builder.yml`'s own comment
 * on `CSC_LINK`/`CSC_KEY_PASSWORD`, and `.claude/plan/ferry-smartscreen-signing-plan.md`
 * for the SignPath-based plan to fix that), and this has not yet been
 * exercised end-to-end against a real install (an older packaged build
 * actually detecting/downloading/installing a newer release) — flag both if
 * either is ever reported broken.
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
  // Never surfaced as a user-facing error toast (there's nothing actionable a
  // user can do about a feed/network hiccup), but logged rather than fully
  // swallowed — a silent blanket swallow here previously hid a real, ongoing
  // failure (the feed's latest.yml was never being published) for an unknown
  // number of releases with nothing in any log to point at it.
  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater]', err)
  })

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[AutoUpdater] checkForUpdates failed', err)
  })
}

/** Quits and installs the already-downloaded update immediately, instead of waiting for the next natural app quit. */
export async function installUpdateNow(): Promise<void> {
  const { autoUpdater } = await import('electron-updater')
  autoUpdater.quitAndInstall()
}

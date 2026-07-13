import { app, nativeImage } from 'electron'
import { handle, handleWithEvent } from './envelope'
import { INVOKE_CHANNELS, type AppVersionResult, type DownloadsPathResult } from '../../shared/contract'

/** 1x1 transparent PNG — `WebContents.startDrag` requires a non-empty icon; the OS drag ghost is what matters, not this. */
const DRAG_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=='

/** Registers OS-standard-path IPC handlers (not dialogs — see dialog.ipc.ts for those). */
export function registerSystemHandlers(): void {
  handle<DownloadsPathResult>(INVOKE_CHANNELS.systemGetDownloadsPath, () => ({
    path: app.getPath('downloads')
  }))
  handle<AppVersionResult>(INVOKE_CHANNELS.systemGetAppVersion, () => ({
    version: app.getVersion()
  }))

  // Starts a native OS drag session for a LOCAL file/folder, letting the renderer's
  // dragstart hand off straight to Explorer/Finder instead of only supporting
  // pane-to-pane drags. Must be called synchronously from the renderer's own
  // dragstart handler — Chromium's drag gesture doesn't survive an async gap.
  handleWithEvent<void>(INVOKE_CHANNELS.systemStartDrag, (event, filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('startDrag requires a file path')
    }
    event.sender.startDrag({ file: filePath, icon: nativeImage.createFromDataURL(DRAG_ICON_DATA_URL) })
  })
}

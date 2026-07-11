import { app } from 'electron'
import { handle } from './envelope'
import { INVOKE_CHANNELS, type DownloadsPathResult } from '../../shared/contract'

/** Registers OS-standard-path IPC handlers (not dialogs — see dialog.ipc.ts for those). */
export function registerSystemHandlers(): void {
  handle<DownloadsPathResult>(INVOKE_CHANNELS.systemGetDownloadsPath, () => ({
    path: app.getPath('downloads')
  }))
}

import { registerSitesHandlers } from './sites.ipc'
import { registerSettingsHandlers } from './settings.ipc'
import { registerSessionHandlers } from './session.ipc'
import { registerKeysHandlers } from './keys.ipc'
import { registerBookmarksHandlers } from './bookmarks.ipc'
import { registerHistoryHandlers } from './history.ipc'
import { registerEditHandlers } from './edit.ipc'
import { registerSyncHandlers } from './sync.ipc'
import { registerFsHandlers } from './fs.ipc'
import { registerTransferHandlers } from './transfer.ipc'
import { registerTailHandlers } from './tail.ipc'
import { registerTerminalHandlers } from './terminal.ipc'
import { registerUnzipHandlers } from './unzip.ipc'
import { registerArchiveHandlers } from './archive.ipc'
import { registerOperationsHandlers } from './operations.ipc'
import { registerMonitorHandlers } from './monitor.ipc'
import { registerUpdateHandlers } from './update.ipc'
import { registerWindowHandlers } from './window.ipc'
import { registerCompanionHandlers } from './companion.ipc'
import { registerSessionTeardown } from '../ssh/registerSessionTeardown'

export function registerSidecarHandlers(): void {
  registerSessionTeardown()
  registerSitesHandlers()
  registerSettingsHandlers()
  registerSessionHandlers()
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
  registerUpdateHandlers()
  registerWindowHandlers()
  registerCompanionHandlers()
}

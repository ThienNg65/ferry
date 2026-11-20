import { handle } from './envelope'
import {
  INVOKE_CHANNELS,
  type CheckUpdateResult,
  type UpdateState
} from '../../shared/contract'
import {
  checkForUpdates,
  getUpdateState,
  installUpdateNow
} from '../update/AutoUpdater'

/** Registers the handlers for checking, querying, and applying updates. */
export function registerUpdateHandlers(): void {
  handle<CheckUpdateResult>(INVOKE_CHANNELS.updateCheck, () => {
    return checkForUpdates(true)
  })

  handle<UpdateState>(INVOKE_CHANNELS.updateGetStatus, () => {
    return getUpdateState()
  })

  handle<void>(INVOKE_CHANNELS.updateInstallNow, () => {
    return installUpdateNow()
  })
}

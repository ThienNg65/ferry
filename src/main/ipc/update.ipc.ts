import { handle } from './envelope'
import { INVOKE_CHANNELS } from '../../shared/contract'
import { installUpdateNow } from '../update/AutoUpdater'

/** Registers the handler that lets the renderer trigger an already-downloaded update install immediately. */
export function registerUpdateHandlers(): void {
  handle<void>(INVOKE_CHANNELS.updateInstallNow, () => {
    installUpdateNow()
  })
}

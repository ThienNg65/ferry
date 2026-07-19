import { handle } from './envelope'
import { INVOKE_CHANNELS, type SyncOptions, type SyncPlan, type SyncRunResult } from '../../shared/contract'
import { previewSync, runSync } from '../sync/SyncService'
import { OperationRegistry } from '../operations/OperationRegistry'

/** Registers one-way directory sync (mirror) handlers. */
export function registerSyncHandlers(): void {
  handle<SyncPlan>(INVOKE_CHANNELS.syncPreview, async (options) => {
    return previewSync(options as SyncOptions)
  })

  handle<SyncRunResult>(INVOKE_CHANNELS.syncRun, async (options) => {
    const opts = options as SyncOptions
    const verb = opts.direction === 'push' ? 'local → remote' : 'remote → local'
    return OperationRegistry.getInstance().run(
      { kind: 'sync', sessionId: opts.sessionId, label: `Syncing (${verb})`, cancellable: true },
      (ctx) => runSync(opts, ctx)
    )
  })
}

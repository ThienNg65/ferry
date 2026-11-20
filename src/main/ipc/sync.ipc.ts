import { handle } from './envelope'
import { INVOKE_CHANNELS, type CompareRequest, type CompareRow, type SyncOptions, type SyncPlan, type SyncRunRequest, type SyncRunResult } from '../../shared/contract'
import { compareTrees, previewSync, runSync, summarizeSync } from '../sync/SyncService'
import { SshError } from '../ssh/errors'
import { OperationRegistry } from '../operations/OperationRegistry'

/** Registers one-way directory sync (mirror) handlers. */
export function registerSyncHandlers(): void {
  handle<SyncPlan>(INVOKE_CHANNELS.syncPreview, async (options) => {
    return previewSync(options as SyncOptions)
  })

  handle<CompareRow[]>(INVOKE_CHANNELS.syncCompare, (req) => compareTrees(req as CompareRequest))

  handle<SyncRunResult>(INVOKE_CHANNELS.syncRun, async (payload) => {
    const request = payload as SyncRunRequest
    if (!request?.options || !Array.isArray(request.approvedPlan?.toDelete)
      || !Array.isArray(request.approvedPlan?.toTransfer) || typeof request.requestId !== 'string') {
      throw new SshError('VALIDATION', 'Preview and approve the sync plan before running it.')
    }
    const opts = request.options
    const verb = opts.direction === 'push' ? 'local → remote' : 'remote → local'
    return OperationRegistry.getInstance().run(
      { kind: 'sync', sessionId: opts.sessionId, label: `Syncing (${verb})`, cancellable: true, requestId: request.requestId },
      (ctx) => runSync(opts, request.approvedPlan, ctx),
      summarizeSync
    )
  })
}

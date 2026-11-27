import { handle } from './envelope'
import { optionalBoolean, requireArray, requireBoolean, requireEnum, requireNonEmptyString, requireObject, requireString } from './validation'
import {
  INVOKE_CHANNELS,
  type CompareRequest,
  type CompareRow,
  type FileDiffRequest,
  type FileDiffResult,
  type SyncDirection,
  type SyncOptions,
  type SyncPlan,
  type SyncRunResult
} from '../../shared/contract'
import { diffLocalAndRemote } from '../diff/FileDiffService'
import { compareTrees, previewSync, runSync, summarizeSync } from '../sync/SyncService'
import { OperationRegistry } from '../operations/OperationRegistry'

const SYNC_DIRECTIONS: readonly SyncDirection[] = ['push', 'pull']

function validateSyncOptions(value: unknown, channel: string): SyncOptions {
  const obj = requireObject(value, channel)
  return {
    sessionId: requireNonEmptyString(obj.sessionId, 'sessionId', channel),
    localPath: requireNonEmptyString(obj.localPath, 'localPath', channel),
    remotePath: requireNonEmptyString(obj.remotePath, 'remotePath', channel),
    direction: requireEnum(obj.direction, SYNC_DIRECTIONS, 'direction', channel),
    deleteExtras: requireBoolean(obj.deleteExtras, 'deleteExtras', channel)
  }
}

/** Registers one-way directory sync (mirror) handlers. */
export function registerSyncHandlers(): void {
  handle<SyncPlan>(INVOKE_CHANNELS.syncPreview, async (options) => {
    return previewSync(validateSyncOptions(options, INVOKE_CHANNELS.syncPreview))
  })

  handle<CompareRow[]>(INVOKE_CHANNELS.syncCompare, (req) => {
    const channel = INVOKE_CHANNELS.syncCompare
    const obj = requireObject(req, channel)
    const request: CompareRequest = {
      sessionId: requireNonEmptyString(obj.sessionId, 'sessionId', channel),
      localPath: requireNonEmptyString(obj.localPath, 'localPath', channel),
      remotePath: requireNonEmptyString(obj.remotePath, 'remotePath', channel)
    }
    return compareTrees(request)
  })

  handle<FileDiffResult>(INVOKE_CHANNELS.syncDiffFiles, (req) => {
    const channel = INVOKE_CHANNELS.syncDiffFiles
    const obj = requireObject(req, channel)
    const request: FileDiffRequest = {
      sessionId: requireNonEmptyString(obj.sessionId, 'sessionId', channel),
      localPath: requireNonEmptyString(obj.localPath, 'localPath', channel),
      remotePath: requireNonEmptyString(obj.remotePath, 'remotePath', channel)
    }
    if (obj.localContent !== undefined) {
      request.localContent = requireString(obj.localContent, 'localContent', channel)
    }
    const viaSudo = optionalBoolean(obj.viaSudo, 'viaSudo', channel)
    if (viaSudo !== undefined) {
      request.viaSudo = viaSudo
    }
    return diffLocalAndRemote(request)
  })

  handle<SyncRunResult>(INVOKE_CHANNELS.syncRun, async (payload) => {
    const channel = INVOKE_CHANNELS.syncRun
    const obj = requireObject(payload, channel)
    const requestId = requireNonEmptyString(obj.requestId, 'requestId', channel)
    const opts = validateSyncOptions(obj.options, channel)
    const planObj = requireObject(obj.approvedPlan, channel)
    const toTransfer = requireArray(planObj.toTransfer, 'approvedPlan.toTransfer', channel) as SyncPlan['toTransfer']
    const toDelete = requireArray(planObj.toDelete, 'approvedPlan.toDelete', channel) as SyncPlan['toDelete']
    const approvedPlan: SyncPlan = {
      toTransfer,
      toDelete,
      totalBytes: typeof planObj.totalBytes === 'number' ? planObj.totalBytes : 0
    }
    const verb = opts.direction === 'push' ? 'local → remote' : 'remote → local'
    return OperationRegistry.getInstance().run(
      { kind: 'sync', sessionId: opts.sessionId, label: `Syncing (${verb})`, cancellable: true, requestId },
      (ctx) => runSync(opts, approvedPlan, ctx),
      summarizeSync
    )
  })
}

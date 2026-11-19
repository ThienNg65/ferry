import { handle } from './envelope'
import { requireEnum, requireNonEmptyString, requireObject } from './validation'
import { INVOKE_CHANNELS, type TransferEnqueueRequest, type TransferEnqueueResult } from '../../shared/contract'
import { TransferQueue } from '../transfer/TransferQueue'

/** Registers handlers for enqueueing and cancelling transfers. */
export function registerTransferHandlers(): void {
  handle<TransferEnqueueResult>(INVOKE_CHANNELS.transferEnqueue, (req) => {
    const request = requireObject(req, INVOKE_CHANNELS.transferEnqueue) as unknown as TransferEnqueueRequest
    const sessionId = requireNonEmptyString(request.sessionId, 'sessionId', INVOKE_CHANNELS.transferEnqueue)
    const kind = requireEnum(request.kind, ['upload', 'download'] as const, 'kind', INVOKE_CHANNELS.transferEnqueue)
    const localPath = requireNonEmptyString(request.localPath, 'localPath', INVOKE_CHANNELS.transferEnqueue)
    const remotePath = requireNonEmptyString(request.remotePath, 'remotePath', INVOKE_CHANNELS.transferEnqueue)
    const queue = TransferQueue.getInstance()
    const transferId = request.isDir
      ? queue.enqueueTree(sessionId, kind, localPath, remotePath)
      : request.createParents === true
        ? queue.enqueue(sessionId, kind, localPath, remotePath, true)
        : queue.enqueue(sessionId, kind, localPath, remotePath)
    return { transferId }
  })

  handle<void>(INVOKE_CHANNELS.transferCancel, (transferId) => {
    TransferQueue.getInstance().cancel(requireNonEmptyString(transferId, 'transferId', INVOKE_CHANNELS.transferCancel))
  })

  handle<void>(INVOKE_CHANNELS.transferRetry, (transferId) => {
    TransferQueue.getInstance().retry(requireNonEmptyString(transferId, 'transferId', INVOKE_CHANNELS.transferRetry))
  })

  handle<void>(INVOKE_CHANNELS.transferPause, (transferId) => {
    TransferQueue.getInstance().pause(requireNonEmptyString(transferId, 'transferId', INVOKE_CHANNELS.transferPause))
  })
}

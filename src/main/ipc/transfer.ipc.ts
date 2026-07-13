import { handle } from './envelope'
import { INVOKE_CHANNELS, type TransferEnqueueResult, type TransferKind } from '../../shared/contract'
import { TransferQueue } from '../transfer/TransferQueue'

/** Request payload for `transfer:enqueue`. */
interface TransferEnqueueRequest {
  sessionId: string
  kind: TransferKind
  localPath: string
  remotePath: string
  /** True to recursively transfer a whole directory tree instead of a single file. */
  isDir?: boolean
}

/** Registers handlers for enqueueing and cancelling transfers. */
export function registerTransferHandlers(): void {
  handle<TransferEnqueueResult>(INVOKE_CHANNELS.transferEnqueue, (req) => {
    const request = req as TransferEnqueueRequest
    const queue = TransferQueue.getInstance()
    const transferId = request.isDir
      ? queue.enqueueTree(request.sessionId, request.kind, request.localPath, request.remotePath)
      : queue.enqueue(request.sessionId, request.kind, request.localPath, request.remotePath)
    return { transferId }
  })

  handle<void>(INVOKE_CHANNELS.transferCancel, (transferId) => {
    TransferQueue.getInstance().cancel(transferId as string)
  })
}

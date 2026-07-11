import { handle } from './envelope'
import { INVOKE_CHANNELS, type TransferEnqueueResult, type TransferKind } from '../../shared/contract'
import { TransferQueue } from '../transfer/TransferQueue'

/** Request payload for `transfer:enqueue`. */
interface TransferEnqueueRequest {
  sessionId: string
  kind: TransferKind
  localPath: string
  remotePath: string
}

/** Registers handlers for enqueueing and cancelling transfers. */
export function registerTransferHandlers(): void {
  handle<TransferEnqueueResult>(INVOKE_CHANNELS.transferEnqueue, (req) => {
    const request = req as TransferEnqueueRequest
    const transferId = TransferQueue.getInstance().enqueue(
      request.sessionId,
      request.kind,
      request.localPath,
      request.remotePath
    )
    return { transferId }
  })

  handle<void>(INVOKE_CHANNELS.transferCancel, (transferId) => {
    TransferQueue.getInstance().cancel(transferId as string)
  })
}

import { randomUUID } from 'crypto'
import { handle } from './envelope'
import { INVOKE_CHANNELS } from '../../shared/contract'
import { TailManager } from '../tail/TailManager'

/** Request payload for `tail:start`. */
interface TailStartRequest {
  sessionId: string
  remotePath: string
  historyLines?: number
}

/** Result of starting a tail — the caller uses `tailId` to route events and to stop. */
interface TailStartResult {
  tailId: string
}

/** Registers handlers for starting/stopping a remote `tail -F` stream. */
export function registerTailHandlers(): void {
  handle<TailStartResult>(INVOKE_CHANNELS.tailStart, (req) => {
    const request = req as TailStartRequest
    const tailId = randomUUID()
    TailManager.getInstance().start(tailId, request.sessionId, request.remotePath, request.historyLines)
    return { tailId }
  })

  handle<void>(INVOKE_CHANNELS.tailStop, (tailId) => {
    TailManager.getInstance().stop(tailId as string)
  })
}

import { randomUUID } from 'crypto'
import { handle } from './envelope'
import { requireNonEmptyString, requireObject } from './validation'
import { INVOKE_CHANNELS, type TailStartRequest, type TailStartResult } from '../../shared/contract'
import { SshError } from '../ssh/errors'
import { TailManager } from '../tail/TailManager'

/** Registers handlers for starting/stopping a remote `tail -F` stream. */
export function registerTailHandlers(): void {
  handle<TailStartResult>(INVOKE_CHANNELS.tailStart, (req) => {
    const request = requireObject(req, INVOKE_CHANNELS.tailStart) as unknown as TailStartRequest
    const sessionId = requireNonEmptyString(request.sessionId, 'sessionId', INVOKE_CHANNELS.tailStart)
    const remotePath = requireNonEmptyString(request.remotePath, 'remotePath', INVOKE_CHANNELS.tailStart)
    if (request.historyLines !== undefined && typeof request.historyLines !== 'number') {
      throw new SshError('VALIDATION', `${INVOKE_CHANNELS.tailStart} requires "historyLines" to be a number`)
    }
    const tailId = randomUUID()
    TailManager.getInstance().start(tailId, sessionId, remotePath, request.historyLines)
    return { tailId }
  })

  handle<void>(INVOKE_CHANNELS.tailStop, (tailId) => {
    TailManager.getInstance().stop(requireNonEmptyString(tailId, 'tailId', INVOKE_CHANNELS.tailStop))
  })
}

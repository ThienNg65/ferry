import { handle } from './envelope'
import {
  INVOKE_CHANNELS,
  type KeyboardInteractiveRespondRequest,
  type SessionOpenRequest,
  type SessionOpenResult
} from '../../shared/contract'
import { SessionManager } from '../ssh/SessionManager'
import { SshError } from '../ssh/errors'

/** Registers handlers for opening/closing SSH sessions. */
export function registerSessionHandlers(): void {
  handle<SessionOpenResult>(INVOKE_CHANNELS.sessionOpen, async (req) => {
    const request = req as SessionOpenRequest
    if (request.siteId) {
      return SessionManager.getInstance().openFromSite(request.siteId, request.sessionId, request.trustedHostKey)
    }
    if (request.quickConnect) {
      return SessionManager.getInstance().openQuickConnect(request.quickConnect, request.sessionId, request.trustedHostKey)
    }
    throw new SshError('VALIDATION', 'session:open requires siteId or quickConnect')
  })

  handle<void>(INVOKE_CHANNELS.sessionClose, (sessionId) => {
    SessionManager.getInstance().close(sessionId as string)
  })

  handle<void>(INVOKE_CHANNELS.sessionKeyboardInteractiveRespond, (req) => {
    const { requestId, responses } = req as KeyboardInteractiveRespondRequest
    if (!Array.isArray(responses)) {
      throw new SshError('VALIDATION', 'session:keyboardInteractiveRespond requires responses to be an array')
    }
    SessionManager.getInstance().respondKeyboardInteractive(requestId, responses)
  })
}

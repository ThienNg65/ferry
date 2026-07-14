import { handle } from './envelope'
import {
  INVOKE_CHANNELS,
  type KeyboardInteractiveRespondRequest,
  type QuickConnectInput,
  type SessionOpenResult
} from '../../shared/contract'
import { SessionManager } from '../ssh/SessionManager'
import { SshError } from '../ssh/errors'

/** Request payload for `session:open` — connect from a saved site, or ad hoc. */
export interface SessionOpenRequest {
  siteId?: string
  quickConnect?: QuickConnectInput
  /** Set only on a user-confirmed retry after a host-key-mismatch warning — see {@link SessionManager.openFromSite}. */
  trustHostKeyChange?: boolean
}

/** Registers handlers for opening/closing SSH sessions. */
export function registerSessionHandlers(): void {
  handle<SessionOpenResult>(INVOKE_CHANNELS.sessionOpen, async (req) => {
    const request = req as SessionOpenRequest
    if (request.siteId) {
      return SessionManager.getInstance().openFromSite(request.siteId, request.trustHostKeyChange)
    }
    if (request.quickConnect) {
      return SessionManager.getInstance().openQuickConnect(request.quickConnect, request.trustHostKeyChange)
    }
    throw new SshError('VALIDATION', 'session:open requires siteId or quickConnect')
  })

  handle<void>(INVOKE_CHANNELS.sessionClose, (sessionId) => {
    SessionManager.getInstance().close(sessionId as string)
  })

  handle<void>(INVOKE_CHANNELS.sessionKeyboardInteractiveRespond, (req) => {
    const { requestId, responses } = req as KeyboardInteractiveRespondRequest
    SessionManager.getInstance().respondKeyboardInteractive(requestId, responses)
  })
}

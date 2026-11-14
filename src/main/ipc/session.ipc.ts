import { handle } from './envelope'
import { requireEnum, requireNonEmptyString, requireObject, requirePort, validateProxyConfig } from './validation'
import {
  INVOKE_CHANNELS,
  type HostKeyRespondRequest,
  type KeyboardInteractiveRespondRequest,
  type QuickConnectInput,
  type SessionOpenRequest,
  type SessionOpenResult
} from '../../shared/contract'
import { SessionManager } from '../ssh/SessionManager'
import { SshError } from '../ssh/errors'

/** Registers handlers for opening/closing SSH sessions. */
export function registerSessionHandlers(): void {
  handle<SessionOpenResult>(INVOKE_CHANNELS.sessionOpen, async (req) => {
    const request = requireObject(req, INVOKE_CHANNELS.sessionOpen) as unknown as SessionOpenRequest
    const sessionId = requireNonEmptyString(request.sessionId, 'sessionId', INVOKE_CHANNELS.sessionOpen)
    if (request.siteId !== undefined) {
      const siteId = requireNonEmptyString(request.siteId, 'siteId', INVOKE_CHANNELS.sessionOpen)
      return SessionManager.getInstance().openFromSite(siteId, sessionId, request.trustedHostKey)
    }
    if (request.quickConnect !== undefined) {
      const qc = requireObject(request.quickConnect, INVOKE_CHANNELS.sessionOpen)
      requireNonEmptyString(qc.host, 'quickConnect.host', INVOKE_CHANNELS.sessionOpen)
      requirePort(qc.port, 'quickConnect.port', INVOKE_CHANNELS.sessionOpen)
      requireNonEmptyString(qc.username, 'quickConnect.username', INVOKE_CHANNELS.sessionOpen)
      requireEnum(qc.authMethod, ['password', 'privateKey', 'agent'] as const, 'quickConnect.authMethod', INVOKE_CHANNELS.sessionOpen)
      if (qc.proxyMode === 'custom' && qc.proxy !== undefined) {
        validateProxyConfig(qc.proxy, INVOKE_CHANNELS.sessionOpen)
      }
      return SessionManager.getInstance().openQuickConnect(qc as unknown as QuickConnectInput, sessionId, request.trustedHostKey)
    }
    throw new SshError('VALIDATION', 'session:open requires siteId or quickConnect')
  })

  handle<void>(INVOKE_CHANNELS.sessionClose, (sessionId) => {
    SessionManager.getInstance().close(requireNonEmptyString(sessionId, 'sessionId', INVOKE_CHANNELS.sessionClose))
  })

  handle<void>(INVOKE_CHANNELS.sessionKeyboardInteractiveRespond, (req) => {
    const obj = requireObject(req, INVOKE_CHANNELS.sessionKeyboardInteractiveRespond) as unknown as KeyboardInteractiveRespondRequest
    const requestId = requireNonEmptyString(obj.requestId, 'requestId', INVOKE_CHANNELS.sessionKeyboardInteractiveRespond)
    if (!Array.isArray(obj.responses) || obj.responses.some((r) => typeof r !== 'string')) {
      throw new SshError('VALIDATION', 'session:keyboardInteractiveRespond requires responses to be a string array')
    }
    SessionManager.getInstance().respondKeyboardInteractive(requestId, obj.responses)
  })

  handle<void>(INVOKE_CHANNELS.sessionHostKeyRespond, (req) => {
    const obj = requireObject(req, INVOKE_CHANNELS.sessionHostKeyRespond) as unknown as HostKeyRespondRequest
    const requestId = requireNonEmptyString(obj.requestId, 'requestId', INVOKE_CHANNELS.sessionHostKeyRespond)
    SessionManager.getInstance().respondHostKey(requestId, obj.accept === true)
  })
}

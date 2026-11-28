import { handle } from './envelope'
import {
  failValidation,
  optionalSecretString,
  optionalString,
  requireEnum,
  requireNonEmptyString,
  requireObject,
  requirePort,
  validateJumpHosts,
  validateProxyConfig
} from './validation'
import {
  INVOKE_CHANNELS,
  type HostKeyRespondRequest,
  type KeyboardInteractiveRespondRequest,
  type QuickConnectInput,
  type SessionOpenRequest,
  type SessionOpenResult
} from '../../shared/contract'
import { SessionManager } from '../ssh/SessionManager'

function parseTrustedHostKey(value: unknown, channel: string): SessionOpenRequest['trustedHostKey'] {
  if (value === undefined) return undefined
  const obj = requireObject(value, channel)
  return {
    host: requireNonEmptyString(obj.host, 'trustedHostKey.host', channel),
    port: requirePort(obj.port, 'trustedHostKey.port', channel)
  }
}

function validateQuickConnect(value: unknown, channel: string): QuickConnectInput {
  const obj = requireObject(value, channel)
  const host = requireNonEmptyString(obj.host, 'quickConnect.host', channel)
  const port = requirePort(obj.port, 'quickConnect.port', channel)
  const username = requireNonEmptyString(obj.username, 'quickConnect.username', channel)
  const authMethod = requireEnum(obj.authMethod, ['password', 'privateKey', 'agent'] as const, 'quickConnect.authMethod', channel)
  const proxyMode =
    obj.proxyMode === undefined ? undefined : requireEnum(obj.proxyMode, ['inherit', 'none', 'custom'] as const, 'quickConnect.proxyMode', channel)
  const jumpHosts = validateJumpHosts(obj.jumpHosts, channel)
  const out: Record<string, unknown> = { host, port, username, authMethod }
  const name = optionalString(obj.name, 'quickConnect.name', channel)
  if (name !== undefined) out.name = name
  const privateKeyPath = optionalString(obj.privateKeyPath, 'quickConnect.privateKeyPath', channel)
  if (privateKeyPath !== undefined) out.privateKeyPath = privateKeyPath
  const agentPath = optionalString(obj.agentPath, 'quickConnect.agentPath', channel)
  if (agentPath !== undefined) out.agentPath = agentPath
  const remoteInitialPath = optionalString(obj.remoteInitialPath, 'quickConnect.remoteInitialPath', channel)
  if (remoteInitialPath !== undefined) out.remoteInitialPath = remoteInitialPath
  const localInitialPath = optionalString(obj.localInitialPath, 'quickConnect.localInitialPath', channel)
  if (localInitialPath !== undefined) out.localInitialPath = localInitialPath
  const password = optionalSecretString(obj.password, 'quickConnect.password', channel)
  if (password !== undefined) out.password = password
  const passphrase = optionalSecretString(obj.passphrase, 'quickConnect.passphrase', channel)
  if (passphrase !== undefined) out.passphrase = passphrase
  if (proxyMode !== undefined) out.proxyMode = proxyMode
  if (proxyMode === 'custom' && obj.proxy !== undefined) {
    out.proxy = validateProxyConfig(obj.proxy, channel)
  }
  if (jumpHosts !== undefined) out.jumpHosts = jumpHosts
  return out as unknown as QuickConnectInput
}

/** Registers handlers for opening/closing SSH sessions. */
export function registerSessionHandlers(): void {
  handle<SessionOpenResult>(INVOKE_CHANNELS.sessionOpen, async (req) => {
    const request = requireObject(req, INVOKE_CHANNELS.sessionOpen) as unknown as SessionOpenRequest
    const sessionId = requireNonEmptyString(request.sessionId, 'sessionId', INVOKE_CHANNELS.sessionOpen)
    const trustedHostKey = parseTrustedHostKey(request.trustedHostKey, INVOKE_CHANNELS.sessionOpen)
    if (request.siteId !== undefined) {
      const siteId = requireNonEmptyString(request.siteId, 'siteId', INVOKE_CHANNELS.sessionOpen)
      return SessionManager.getInstance().openFromSite(siteId, sessionId, trustedHostKey)
    }
    if (request.quickConnect !== undefined) {
      const qc = validateQuickConnect(request.quickConnect, INVOKE_CHANNELS.sessionOpen)
      return SessionManager.getInstance().openQuickConnect(qc, sessionId, trustedHostKey)
    }
    failValidation(INVOKE_CHANNELS.sessionOpen, 'session:open requires siteId or quickConnect')
  })

  handle<void>(INVOKE_CHANNELS.sessionClose, (sessionId) => {
    SessionManager.getInstance().close(requireNonEmptyString(sessionId, 'sessionId', INVOKE_CHANNELS.sessionClose))
  })

  handle<void>(INVOKE_CHANNELS.sessionKeyboardInteractiveRespond, (req) => {
    const obj = requireObject(req, INVOKE_CHANNELS.sessionKeyboardInteractiveRespond) as unknown as KeyboardInteractiveRespondRequest
    const requestId = requireNonEmptyString(obj.requestId, 'requestId', INVOKE_CHANNELS.sessionKeyboardInteractiveRespond)
    if (!Array.isArray(obj.responses) || obj.responses.some((r) => typeof r !== 'string')) {
      failValidation(INVOKE_CHANNELS.sessionKeyboardInteractiveRespond, 'session:keyboardInteractiveRespond requires responses to be a string array')
    }
    SessionManager.getInstance().respondKeyboardInteractive(requestId, obj.responses)
  })

  handle<void>(INVOKE_CHANNELS.sessionHostKeyRespond, (req) => {
    const obj = requireObject(req, INVOKE_CHANNELS.sessionHostKeyRespond) as unknown as HostKeyRespondRequest
    const requestId = requireNonEmptyString(obj.requestId, 'requestId', INVOKE_CHANNELS.sessionHostKeyRespond)
    SessionManager.getInstance().respondHostKey(requestId, obj.accept === true)
  })
}

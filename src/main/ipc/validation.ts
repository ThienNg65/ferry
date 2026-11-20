import { SshError } from '../ssh/errors'
import { logSecurityEvent } from '../host/securityLog'
import type { AuthMethod, JumpHostConfig, ProxyConfig, SiteEnvironment, SiteInput } from '../../shared/contract'

const AUTH_METHODS: readonly AuthMethod[] = ['password', 'privateKey', 'agent']
const HOP_AUTH_METHODS = ['password', 'privateKey'] as const
const PROXY_MODES = ['inherit', 'none', 'custom'] as const
const PROXY_TYPES = ['socks5', 'http'] as const
const SITE_ENVIRONMENTS: readonly SiteEnvironment[] = ['prod', 'staging', 'dev']

function failValidation(channel: string, message: string): never {
  logSecurityEvent('ipc.validation_rejected', { channel, message })
  throw new SshError('VALIDATION', message)
}

export function requireObject(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    failValidation(channel, `${channel} requires an object payload`)
  }
  return value as Record<string, unknown>
}

export function requireNonEmptyString(value: unknown, field: string, channel: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failValidation(channel, `${channel} requires a non-empty "${field}"`)
  }
  return value
}

export function optionalString(value: unknown, field: string, channel: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value !== 'string') {
    failValidation(channel, `${channel} requires "${field}" to be a string`)
  }
  return value
}

/** Like {@link optionalString}, but preserves `""` so callers can distinguish "clear secret" from "unchanged". */
export function optionalSecretString(value: unknown, field: string, channel: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    failValidation(channel, `${channel} requires "${field}" to be a string`)
  }
  return value
}

export function requirePort(value: unknown, field: string, channel: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) {
    failValidation(channel, `${channel} requires "${field}" to be an integer between 1 and 65535`)
  }
  return value as number
}

export function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string, channel: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    failValidation(channel, `${channel} requires "${field}" to be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

export function validateProxyConfig(value: unknown, channel: string): ProxyConfig {
  const obj = requireObject(value, channel)
  return {
    type: requireEnum(obj.type, PROXY_TYPES, 'proxy.type', channel),
    host: requireNonEmptyString(obj.host, 'proxy.host', channel),
    port: requirePort(obj.port, 'proxy.port', channel),
    username: optionalString(obj.username, 'proxy.username', channel),
    password: optionalSecretString(obj.password, 'proxy.password', channel)
  }
}

export function validateJumpHosts(value: unknown, channel: string): JumpHostConfig[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    failValidation(channel, `${channel} requires "jumpHosts" to be an array`)
  }
  return value.map((hop) => {
    const h = requireObject(hop, channel)
    return {
      host: requireNonEmptyString(h.host, 'jumpHosts.host', channel),
      port: requirePort(h.port, 'jumpHosts.port', channel),
      username: requireNonEmptyString(h.username, 'jumpHosts.username', channel),
      authMethod: requireEnum(h.authMethod, HOP_AUTH_METHODS, 'jumpHosts.authMethod', channel),
      privateKeyPath: optionalString(h.privateKeyPath, 'jumpHosts.privateKeyPath', channel),
      password: optionalSecretString(h.password, 'jumpHosts.password', channel),
      passphrase: optionalSecretString(h.passphrase, 'jumpHosts.passphrase', channel),
      ...(typeof h.sourceIndex === 'number' && Number.isInteger(h.sourceIndex) && h.sourceIndex >= -1
        ? { sourceIndex: h.sourceIndex }
        : {})
    }
  })
}

export function validateSiteInput(value: unknown, channel: string): SiteInput {
  const obj = requireObject(value, channel)
  const host = requireNonEmptyString(obj.host, 'host', channel)
  const name = optionalString(obj.name, 'name', channel) ?? host
  const port = requirePort(obj.port, 'port', channel)
  const username = requireNonEmptyString(obj.username, 'username', channel)
  const authMethod = requireEnum(obj.authMethod, AUTH_METHODS, 'authMethod', channel)
  const proxyMode =
    obj.proxyMode === undefined ? undefined : requireEnum(obj.proxyMode, PROXY_MODES, 'proxyMode', channel)
  const jumpHosts = validateJumpHosts(obj.jumpHosts, channel)
  const environment =
    obj.environment === undefined || obj.environment === null || obj.environment === ''
      ? undefined
      : requireEnum(obj.environment, SITE_ENVIRONMENTS, 'environment', channel)

  const out: SiteInput = {
    name,
    host,
    port,
    username,
    authMethod,
    privateKeyPath: optionalString(obj.privateKeyPath, 'privateKeyPath', channel),
    agentPath: optionalString(obj.agentPath, 'agentPath', channel),
    remoteInitialPath: optionalString(obj.remoteInitialPath, 'remoteInitialPath', channel),
    localInitialPath: optionalString(obj.localInitialPath, 'localInitialPath', channel),
    password: optionalSecretString(obj.password, 'password', channel),
    passphrase: optionalSecretString(obj.passphrase, 'passphrase', channel),
    group: optionalString(obj.group, 'group', channel),
    ...(environment !== undefined ? { environment } : {}),
    ...(proxyMode !== undefined ? { proxyMode } : {}),
    ...(jumpHosts !== undefined ? { jumpHosts } : {})
  }
  if (proxyMode === 'custom' && obj.proxy !== undefined) {
    out.proxy = validateProxyConfig(obj.proxy, channel)
  }
  return out
}

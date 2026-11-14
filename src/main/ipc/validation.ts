import { SshError } from '../ssh/errors'
import { logSecurityEvent } from '../host/securityLog'
import type { AuthMethod, ProxyConfig, SiteInput } from '../../shared/contract'

const AUTH_METHODS: readonly AuthMethod[] = ['password', 'privateKey', 'agent']
const HOP_AUTH_METHODS = ['password', 'privateKey'] as const
const PROXY_MODES = ['inherit', 'none', 'custom'] as const
const PROXY_TYPES = ['socks5', 'http'] as const

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
    password: optionalString(obj.password, 'proxy.password', channel)
  }
}

export function validateSiteInput(value: unknown, channel: string): SiteInput {
  const obj = requireObject(value, channel)
  const host = requireNonEmptyString(obj.host, 'host', channel)
  const name = optionalString(obj.name, 'name', channel) ?? host
  const port = requirePort(obj.port, 'port', channel)
  const username = requireNonEmptyString(obj.username, 'username', channel)
  const authMethod = requireEnum(obj.authMethod, AUTH_METHODS, 'authMethod', channel)
  const proxyMode = obj.proxyMode === undefined ? undefined : requireEnum(obj.proxyMode, PROXY_MODES, 'proxyMode', channel)

  if (obj.jumpHosts !== undefined && !Array.isArray(obj.jumpHosts)) {
    failValidation(channel, `${channel} requires "jumpHosts" to be an array`)
  }
  const jumpHosts = Array.isArray(obj.jumpHosts)
    ? obj.jumpHosts.map((hop) => {
        const h = requireObject(hop, channel)
        return {
          host: requireNonEmptyString(h.host, 'jumpHosts.host', channel),
          port: requirePort(h.port, 'jumpHosts.port', channel),
          username: requireNonEmptyString(h.username, 'jumpHosts.username', channel),
          authMethod: requireEnum(h.authMethod, HOP_AUTH_METHODS, 'jumpHosts.authMethod', channel),
          privateKeyPath: optionalString(h.privateKeyPath, 'jumpHosts.privateKeyPath', channel),
          password: optionalString(h.password, 'jumpHosts.password', channel),
          passphrase: optionalString(h.passphrase, 'jumpHosts.passphrase', channel)
        }
      })
    : undefined

  const out: SiteInput = {
    ...(obj as unknown as SiteInput),
    name,
    host,
    port,
    username,
    authMethod,
    ...(proxyMode !== undefined ? { proxyMode } : {}),
    ...(jumpHosts !== undefined ? { jumpHosts } : {})
  }
  if (proxyMode === 'custom' && obj.proxy !== undefined) {
    out.proxy = validateProxyConfig(obj.proxy, channel)
  } else {
    delete out.proxy
  }
  return out
}

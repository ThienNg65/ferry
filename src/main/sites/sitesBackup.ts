import type { JumpHostConfig, ProxyConfig, SiteEnvironment, SiteInput } from '../../shared/contract'
import { SshError } from '../ssh/errors'

const AUTH_METHODS = ['password', 'privateKey', 'agent']
const HOP_AUTH_METHODS = ['password', 'privateKey']
const PROXY_MODES = ['inherit', 'none', 'custom']
const PROXY_TYPES = ['socks5', 'http']
const ENVIRONMENTS = ['prod', 'staging', 'dev']

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new Error(`Missing "${field}"`)
    }
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error(`"${field}" must be a string`)
  }
  return value
}

function port(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) {
    throw new Error(`"${field}" must be a port between 1 and 65535`)
  }
  return value as number
}

function oneOf<T extends string>(value: unknown, allowed: string[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`"${field}" must be one of ${allowed.join(', ')}`)
  }
  return value as T
}

function parseHop(raw: unknown, index: number): JumpHostConfig {
  if (!isObject(raw)) {
    throw new Error(`Jump host ${index + 1} is not an object`)
  }
  return {
    host: str(raw.host, 'jumpHosts.host', true) as string,
    port: port(raw.port, 'jumpHosts.port'),
    username: str(raw.username, 'jumpHosts.username', true) as string,
    authMethod: oneOf(raw.authMethod, HOP_AUTH_METHODS, 'jumpHosts.authMethod'),
    privateKeyPath: str(raw.privateKeyPath, 'jumpHosts.privateKeyPath')
  }
}

function parseProxy(raw: unknown): ProxyConfig {
  if (!isObject(raw)) {
    throw new Error('"proxy" must be an object')
  }
  return {
    type: oneOf(raw.type, PROXY_TYPES, 'proxy.type'),
    host: str(raw.host, 'proxy.host', true) as string,
    port: port(raw.port, 'proxy.port'),
    username: str(raw.username, 'proxy.username')
  }
}

function parseSite(raw: unknown, _index: number): SiteInput {
  if (!isObject(raw)) {
    throw new Error('not an object')
  }
  const proxyMode = raw.proxyMode === undefined ? undefined : oneOf<'inherit' | 'none' | 'custom'>(raw.proxyMode, PROXY_MODES, 'proxyMode')
  if (raw.jumpHosts !== undefined && !Array.isArray(raw.jumpHosts)) {
    throw new Error('"jumpHosts" must be an array')
  }
  return {
    name: str(raw.name, 'name') ?? (str(raw.host, 'host', true) as string),
    host: str(raw.host, 'host', true) as string,
    port: port(raw.port, 'port'),
    username: str(raw.username, 'username', true) as string,
    authMethod: oneOf(raw.authMethod, AUTH_METHODS, 'authMethod'),
    privateKeyPath: str(raw.privateKeyPath, 'privateKeyPath'),
    agentPath: str(raw.agentPath, 'agentPath'),
    remoteInitialPath: str(raw.remoteInitialPath, 'remoteInitialPath'),
    localInitialPath: str(raw.localInitialPath, 'localInitialPath'),
    jumpHosts: raw.jumpHosts ? (raw.jumpHosts as unknown[]).map(parseHop) : undefined,
    proxyMode,
    proxy: proxyMode === 'custom' ? parseProxy(raw.proxy) : undefined,
    group: str(raw.group, 'group'),
    environment: raw.environment === undefined ? undefined : oneOf<SiteEnvironment>(raw.environment, ENVIRONMENTS, 'environment')
  }
}

export function parseSitesBackup(text: string): SiteInput[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new SshError('VALIDATION', 'File is not valid JSON')
  }
  if (!isObject(data) || data.schemaVersion !== 1 || !Array.isArray(data.sites)) {
    throw new SshError('VALIDATION', 'Not a Ferry sites backup (expected schemaVersion 1)')
  }
  return data.sites.map((raw, index) => {
    try {
      return parseSite(raw, index)
    } catch (e) {
      throw new SshError('VALIDATION', `Site ${index + 1}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
}

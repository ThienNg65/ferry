import type { AuthMethod, ExportSshConfigResult } from '../../shared/contract'

export type { ExportSshConfigResult }

export interface ExportableJumpHost {
  host: string
  port?: number
  username?: string
  authMethod?: 'password' | 'privateKey'
  privateKeyPath?: string
}

export interface ExportableSite {
  name?: string
  host: string
  port?: number
  username?: string
  authMethod?: AuthMethod
  privateKeyPath?: string
  jumpHosts?: ReadonlyArray<ExportableJumpHost>
  jumpHost?: ExportableJumpHost
}

export interface ExportSshConfigOptions {
  /** Include a leading comment banner explaining that secrets are omitted (default: true). */
  includeHeader?: boolean
}

const CONTROL_CHARS_RE = /[\r\n\0\x01-\x1f\x7f]/g
const NEEDS_QUOTING_RE = /[\s#=]/
const EXPORT_HEADER = '# Exported from Ferry (passwords and passphrases are never included)'

function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS_RE, '').trim()
}

function isValidPort(port: number | undefined): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
}

/** Returns true for raw IPv6 literals (two or more colons, not already bracketed). */
function isUnbracketedIpv6(host: string): boolean {
  if (host.startsWith('[')) {
    return false
  }
  const firstColon = host.indexOf(':')
  return firstColon !== -1 && firstColon !== host.lastIndexOf(':')
}

/**
 * Formats an OpenSSH config token, quoting values that contain whitespace, `#`, or `=`.
 * Strips control characters and double quotes to prevent directive injection.
 */
export function formatSshConfigValue(raw: string): string {
  const clean = stripControlChars(raw).replace(/"/g, '')
  if (!clean) {
    return ''
  }
  return NEEDS_QUOTING_RE.test(clean) ? `"${clean}"` : clean
}

/**
 * Formats an OpenSSH `IdentityFile` path, escaping literal `%` characters as `%%`
 * so OpenSSH does not interpret them as token expansions (`%h`, `%r`, `%u`, etc.).
 */
function formatIdentityFileValue(raw: string): string {
  const clean = stripControlChars(raw).replace(/"/g, '').replace(/%/g, '%%')
  if (!clean) {
    return ''
  }
  return NEEDS_QUOTING_RE.test(clean) ? `"${clean}"` : clean
}

/**
 * Produces a safe OpenSSH `Host` alias that will not be interpreted as a wildcard,
 * negated pattern (`!`), or keyword/value delimiter (`=`) by OpenSSH or Ferry's
 * `parseSshConfig()` importer.
 */
export function sanitizeHostAlias(rawName: string | undefined, fallbackHost: string): string {
  const base = stripControlChars(rawName || fallbackHost)
    .replace(/[*?"#!=]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (base) {
    return base
  }

  const hostFallback = stripControlChars(fallbackHost)
    .replace(/[*?"#!=\s]/g, '')

  return hostFallback || 'host'
}

function allocateUniqueAlias(baseAlias: string, usedAliases: Set<string>): string {
  let alias = baseAlias
  let suffix = 2
  while (usedAliases.has(alias)) {
    alias = `${baseAlias}-${suffix}`
    suffix += 1
  }
  usedAliases.add(alias)
  return alias
}

function formatInlineProxyJumpHop(hop: ExportableJumpHost): string | null {
  const host = stripControlChars(hop.host).replace(/[\s,]/g, '')
  if (!host) {
    return null
  }

  const ipv6 = isUnbracketedIpv6(host)
  const formattedHost = ipv6 ? `[${host}]` : host
  const hasExplicitPort = !ipv6 && !host.startsWith('[') && host.includes(':')
  const user = hop.username ? stripControlChars(hop.username).replace(/[\s,@]/g, '') : ''
  const port = !hasExplicitPort && isValidPort(hop.port) && hop.port !== 22 ? `:${hop.port}` : ''

  return `${user ? `${user}@` : ''}${formattedHost}${port}`
}

function hasCustomHopKey(hop: ExportableJumpHost): boolean {
  return Boolean(hop.privateKeyPath && stripControlChars(hop.privateKeyPath) && hop.authMethod !== 'password')
}

/**
 * Serializes saved Ferry sites into standard OpenSSH `config` syntax.
 * Explicitly omits passwords, passphrases, and any other secret credentials.
 */
export function formatSitesAsSshConfig(
  sites: ReadonlyArray<ExportableSite>,
  options: ExportSshConfigOptions = {}
): ExportSshConfigResult {
  const { includeHeader = true } = options
  const usedAliases = new Set<string>()
  // Deduplicate identical bastion Host blocks (when multiple sites share a jump hop with a custom key).
  const jumpAliasBySignature = new Map<string, string>()
  const jumpBlocks: string[] = []
  const siteBlocks: string[] = []
  let skippedCount = 0

  for (const site of sites) {
    const hostName = formatSshConfigValue(site.host)
    if (!hostName) {
      skippedCount += 1
      continue
    }

    const baseAlias = sanitizeHostAlias(site.name, site.host)
    const alias = allocateUniqueAlias(baseAlias, usedAliases)

    const lines: string[] = [`Host ${alias}`, `  HostName ${hostName}`]

    if (isValidPort(site.port) && site.port !== 22) {
      lines.push(`  Port ${site.port}`)
    }

    if (site.username) {
      const user = formatSshConfigValue(site.username)
      if (user) {
        lines.push(`  User ${user}`)
      }
    }

    // Only emit IdentityFile for key-based auth; passwords and passphrases are never written.
    if (site.authMethod === 'privateKey' && site.privateKeyPath) {
      const identityFile = formatIdentityFileValue(site.privateKeyPath)
      if (identityFile) {
        lines.push(`  IdentityFile ${identityFile}`)
      }
    }

    const hops = site.jumpHosts?.length ? site.jumpHosts : site.jumpHost ? [site.jumpHost] : []
    if (hops.length > 0) {
      const jumpSpecs: string[] = []
      for (let i = 0; i < hops.length; i += 1) {
        const hop = hops[i]
        if (hasCustomHopKey(hop)) {
          const hopHost = formatSshConfigValue(hop.host)
          if (!hopHost) {
            continue
          }
          const hopPort = isValidPort(hop.port) && hop.port !== 22 ? hop.port : 22
          const hopUser = hop.username ? formatSshConfigValue(hop.username) : ''
          const hopKey = formatIdentityFileValue(hop.privateKeyPath!)
          if (!hopKey) {
            const inline = formatInlineProxyJumpHop(hop)
            if (inline) jumpSpecs.push(inline)
            continue
          }

          const signature = `${hopHost}|${hopPort}|${hopUser}|${hopKey}`
          let hopAlias = jumpAliasBySignature.get(signature)
          if (!hopAlias) {
            const hopBase = sanitizeHostAlias(
              hops.length > 1 ? `${alias}-jump-${i + 1}` : `${alias}-jump`,
              hop.host
            )
            hopAlias = allocateUniqueAlias(hopBase, usedAliases)
            jumpAliasBySignature.set(signature, hopAlias)

            const hopLines: string[] = [`Host ${hopAlias}`, `  HostName ${hopHost}`]
            if (hopPort !== 22) {
              hopLines.push(`  Port ${hopPort}`)
            }
            if (hopUser) {
              hopLines.push(`  User ${hopUser}`)
            }
            hopLines.push(`  IdentityFile ${hopKey}`)
            jumpBlocks.push(hopLines.join('\n'))
          }
          jumpSpecs.push(hopAlias)
        } else {
          const inline = formatInlineProxyJumpHop(hop)
          if (inline) {
            jumpSpecs.push(inline)
          }
        }
      }

      if (jumpSpecs.length > 0) {
        lines.push(`  ProxyJump ${formatSshConfigValue(jumpSpecs.join(','))}`)
      }
    }

    siteBlocks.push(lines.join('\n'))
  }

  const allBlocks = [...jumpBlocks, ...siteBlocks]
  const body = allBlocks.join('\n\n')

  let content: string
  if (body) {
    content = includeHeader ? `${EXPORT_HEADER}\n\n${body}\n` : `${body}\n`
  } else {
    content = includeHeader ? `${EXPORT_HEADER}\n` : ''
  }

  return {
    content,
    exportedCount: siteBlocks.length,
    skippedCount
  }
}

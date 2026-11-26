export interface ExportableJumpHost {
  host: string
  port?: number
  username?: string
}

export interface ExportableSite {
  name?: string
  host: string
  port?: number
  username?: string
  authMethod?: string
  privateKeyPath?: string
  jumpHosts?: ReadonlyArray<ExportableJumpHost>
  jumpHost?: ExportableJumpHost
}

export interface ExportSshConfigOptions {
  /** Include a leading comment banner explaining that secrets are omitted (default: true). */
  includeHeader?: boolean
}

export interface ExportSshConfigResult {
  content: string
  exportedCount: number
  skippedCount: number
}

const CONTROL_CHARS_RE = /[\r\n\0\x01-\x1f\x7f]/g
const NEEDS_QUOTING_RE = /[\s#=]/

function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS_RE, '').trim()
}

function isValidPort(port: number | undefined): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
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
 * Produces a safe OpenSSH `Host` alias that will not be interpreted as a wildcard
 * or negated pattern by OpenSSH or Ferry's `parseSshConfig()` importer.
 */
export function sanitizeHostAlias(rawName: string | undefined, fallbackHost: string): string {
  const base = stripControlChars(rawName || fallbackHost)
    .replace(/[*?"#]/g, '')
    .replace(/^!+/, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (base) {
    return base
  }

  const hostFallback = stripControlChars(fallbackHost)
    .replace(/[*?"#\s]/g, '')
    .replace(/^!+/, '')

  return hostFallback || 'host'
}

function formatProxyJumpHop(hop: ExportableJumpHost): string | null {
  const host = stripControlChars(hop.host).replace(/[\s,]/g, '')
  if (!host) {
    return null
  }

  const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const user = hop.username ? stripControlChars(hop.username).replace(/[\s,@]/g, '') : ''
  const port = isValidPort(hop.port) && hop.port !== 22 ? `:${hop.port}` : ''

  return `${user ? `${user}@` : ''}${formattedHost}${port}`
}

function formatProxyJump(site: ExportableSite): string | null {
  const hops = site.jumpHosts?.length ? site.jumpHosts : site.jumpHost ? [site.jumpHost] : []
  if (hops.length === 0) {
    return null
  }
  const formatted = hops
    .map(formatProxyJumpHop)
    .filter((entry): entry is string => Boolean(entry))
  return formatted.length > 0 ? formatted.join(',') : null
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
  const blocks: string[] = []
  let skippedCount = 0

  for (const site of sites) {
    const hostName = formatSshConfigValue(site.host)
    if (!hostName) {
      skippedCount += 1
      continue
    }

    const baseAlias = sanitizeHostAlias(site.name, site.host)
    let alias = baseAlias
    let suffix = 2
    while (usedAliases.has(alias)) {
      alias = `${baseAlias}-${suffix}`
      suffix += 1
    }
    usedAliases.add(alias)

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
      const identityFile = formatSshConfigValue(site.privateKeyPath)
      if (identityFile) {
        lines.push(`  IdentityFile ${identityFile}`)
      }
    }

    const proxyJump = formatProxyJump(site)
    if (proxyJump) {
      lines.push(`  ProxyJump ${formatSshConfigValue(proxyJump)}`)
    }

    blocks.push(lines.join('\n'))
  }

  const header = includeHeader
    ? '# Exported from Ferry (passwords and passphrases are never included)\n\n'
    : ''

  const body = blocks.join('\n\n')
  const content = body ? `${header}${body}\n` : header

  return {
    content,
    exportedCount: blocks.length,
    skippedCount
  }
}

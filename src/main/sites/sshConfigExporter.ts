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

function isUnbracketedIpv6(host: string): boolean {
  if (host.startsWith('[')) {
    return false
  }
  const firstColon = host.indexOf(':')
  return firstColon !== -1 && firstColon !== host.lastIndexOf(':')
}

export function formatSshConfigValue(raw: string): string {
  const clean = stripControlChars(raw).replace(/"/g, '')
  if (!clean) {
    return ''
  }
  return NEEDS_QUOTING_RE.test(clean) ? `"${clean}"` : clean
}

function formatIdentityFileValue(raw: string): string {
  const clean = stripControlChars(raw).replace(/"/g, '').replace(/%/g, '%%')
  if (!clean) {
    return ''
  }
  return NEEDS_QUOTING_RE.test(clean) ? `"${clean}"` : clean
}

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

  const hostFallback = stripControlChars(fallbackHost).replace(/[*?"#!=\s]/g, '')
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

interface JumpHostContext {
  usedAliases: Set<string>
  jumpAliasBySignature: Map<string, string>
  jumpBlocks: string[]
}

function resolveJumpHopSpec(
  hop: ExportableJumpHost,
  siteAlias: string,
  hopIndex: number,
  hopCount: number,
  ctx: JumpHostContext
): string | null {
  if (!hasCustomHopKey(hop)) {
    return formatInlineProxyJumpHop(hop)
  }

  const hopHost = formatSshConfigValue(hop.host)
  if (!hopHost) {
    return null
  }

  const hopKey = formatIdentityFileValue(hop.privateKeyPath!)
  if (!hopKey) {
    return formatInlineProxyJumpHop(hop)
  }

  const hopPort = isValidPort(hop.port) && hop.port !== 22 ? hop.port : 22
  const hopUser = hop.username ? formatSshConfigValue(hop.username) : ''
  const signature = `${hopHost}|${hopPort}|${hopUser}|${hopKey}`

  let hopAlias = ctx.jumpAliasBySignature.get(signature)
  if (!hopAlias) {
    const hopBase = sanitizeHostAlias(
      hopCount > 1 ? `${siteAlias}-jump-${hopIndex + 1}` : `${siteAlias}-jump`,
      hop.host
    )
    hopAlias = allocateUniqueAlias(hopBase, ctx.usedAliases)
    ctx.jumpAliasBySignature.set(signature, hopAlias)

    const hopLines: string[] = [`Host ${hopAlias}`, `  HostName ${hopHost}`]
    if (hopPort !== 22) {
      hopLines.push(`  Port ${hopPort}`)
    }
    if (hopUser) {
      hopLines.push(`  User ${hopUser}`)
    }
    hopLines.push(`  IdentityFile ${hopKey}`)
    ctx.jumpBlocks.push(hopLines.join('\n'))
  }

  return hopAlias
}

function formatProxyJumpLine(site: ExportableSite, siteAlias: string, ctx: JumpHostContext): string | null {
  const hops = site.jumpHosts?.length ? site.jumpHosts : site.jumpHost ? [site.jumpHost] : []
  if (hops.length === 0) {
    return null
  }

  const jumpSpecs = hops
    .map((hop, index) => resolveJumpHopSpec(hop, siteAlias, index, hops.length, ctx))
    .filter((entry): entry is string => Boolean(entry))

  return jumpSpecs.length > 0 ? `  ProxyJump ${formatSshConfigValue(jumpSpecs.join(','))}` : null
}

export function formatSitesAsSshConfig(
  sites: ReadonlyArray<ExportableSite>,
  options: ExportSshConfigOptions = {}
): ExportSshConfigResult {
  const { includeHeader = true } = options
  const ctx: JumpHostContext = {
    usedAliases: new Set<string>(),
    jumpAliasBySignature: new Map<string, string>(),
    jumpBlocks: []
  }
  const siteBlocks: string[] = []
  let skippedCount = 0

  for (const site of sites) {
    const hostName = formatSshConfigValue(site.host)
    if (!hostName) {
      skippedCount += 1
      continue
    }

    const alias = allocateUniqueAlias(sanitizeHostAlias(site.name, site.host), ctx.usedAliases)
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

    if (site.authMethod === 'privateKey' && site.privateKeyPath) {
      const identityFile = formatIdentityFileValue(site.privateKeyPath)
      if (identityFile) {
        lines.push(`  IdentityFile ${identityFile}`)
      }
    }

    const proxyJumpLine = formatProxyJumpLine(site, alias, ctx)
    if (proxyJumpLine) {
      lines.push(proxyJumpLine)
    }

    siteBlocks.push(lines.join('\n'))
  }

  const body = [...ctx.jumpBlocks, ...siteBlocks].join('\n\n')
  const content = body
    ? includeHeader
      ? `${EXPORT_HEADER}\n\n${body}\n`
      : `${body}\n`
    : includeHeader
      ? `${EXPORT_HEADER}\n`
      : ''

  return {
    content,
    exportedCount: siteBlocks.length,
    skippedCount
  }
}

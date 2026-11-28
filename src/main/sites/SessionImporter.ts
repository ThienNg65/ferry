import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
import type { ImportedSessionCandidate, JumpHostConfig } from '../../shared/contract'
import { decodeSessionName, listRegSubkeyPaths, parseDword, parseRegValues } from './regQuery'

const execFileAsync = promisify(execFile)

const PUTTY_ROOT = 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions'
const WINSCP_ROOT = 'HKCU\\Software\\Martin Prikryl\\WinSCP 2\\Sessions'

/** Runs `reg query "<key>"` (no shell involved — `execFile` passes `key` as a single argv element). Returns null if the key doesn't exist or `reg` itself is unavailable, treated as "nothing found" rather than an error. */
async function regQuery(key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', key], { windowsHide: true })
    return stdout
  } catch {
    return null
  }
}

/**
 * Scans PuTTY's saved sessions (`HKCU\Software\SimonTatham\PuTTY\Sessions`).
 * PuTTY never stores passwords, so there's nothing to skip there — only
 * host/port/username/key-path are ever present.
 */
export async function scanPuttySessions(
  /** Overridable only for unit tests (see SessionImporter.test.ts) — real callers never pass this, so the win32 gate below still applies to them. */
  queryFn?: (key: string) => Promise<string | null>,
  defaultUser: string = os.userInfo().username
): Promise<ImportedSessionCandidate[]> {
  if (!queryFn && process.platform !== 'win32') {
    return []
  }
  const query = queryFn ?? regQuery
  const listing = await query(PUTTY_ROOT)
  if (!listing) {
    return []
  }
  const candidates: ImportedSessionCandidate[] = []
  for (const subkey of listRegSubkeyPaths(listing, PUTTY_ROOT)) {
    const rawName = subkey.slice(subkey.lastIndexOf('\\') + 1)
    const name = decodeSessionName(rawName)
    if (name === 'Default Settings') {
      continue
    }
    const detail = await query(subkey)
    if (!detail) {
      continue
    }
    const values = parseRegValues(detail)
    const host = values.get('HostName')
    if (!host) {
      continue
    }
    const rawUser = values.get('UserName')?.trim()
    candidates.push({
      source: 'putty',
      name,
      host,
      port: parseDword(values.get('PortNumber'), 22),
      username: rawUser || defaultUser,
      privateKeyPath: values.get('PublicKeyFile') || undefined
    })
  }
  return candidates
}

/** Defensive bound on WinSCP folder-group nesting depth — this walks external registry data, not a structure Ferry controls. */
const MAX_WINSCP_DEPTH = 20

/**
 * Recursively visits one WinSCP session-or-folder-group node. `reg query
 * "<key>"` (no `/s`) returns both that key's own values AND its direct child
 * subkey paths in one call, so a folder-group node (no `HostName` of its
 * own) is detected by simply finding no host — and its children, which may
 * be further nested groups or real sessions, are always visited regardless,
 * since a folder-group and a real session could in principle coexist at the
 * same level.
 */
async function walkWinScpNode(
  subkey: string,
  ancestorNames: string[],
  candidates: ImportedSessionCandidate[],
  depth: number,
  queryFn: (key: string) => Promise<string | null>,
  defaultUser: string
): Promise<void> {
  if (depth > MAX_WINSCP_DEPTH) {
    return
  }
  const detail = await queryFn(subkey)
  if (!detail) {
    return
  }
  const rawName = subkey.slice(subkey.lastIndexOf('\\') + 1)
  const decoded = decodeSessionName(rawName)
  // Some WinSCP installs name a nested child key with its full path from the
  // Sessions root (not just the segment relative to its immediate parent) —
  // take only the last segment so it isn't doubled onto `ancestorNames`.
  const leafSegment = decoded.slice(decoded.lastIndexOf('/') + 1)
  const names = [...ancestorNames, leafSegment]
  const values = parseRegValues(detail)
  const host = values.get('HostName')
  if (host) {
    const rawUser = values.get('UserName')?.trim()
    candidates.push({
      source: 'winscp',
      name: names.join('/'),
      host,
      port: parseDword(values.get('PortNumber'), 22),
      username: rawUser || defaultUser,
      privateKeyPath: values.get('PublicKeyFile') || undefined,
      remoteInitialPath: values.get('RemoteDirectory') || undefined
    })
  }
  await Promise.all(
    listRegSubkeyPaths(detail, subkey).map((child) =>
      walkWinScpNode(child, names, candidates, depth + 1, queryFn, defaultUser)
    )
  )
}

/**
 * Scans WinSCP's saved sessions
 * (`HKCU\Software\Martin Prikryl\WinSCP 2\Sessions`), recursing into nested
 * folder groups (a session name containing further subkeys) so sessions
 * organized into folders aren't silently dropped — a nested session's
 * `name` is its full folder path, `/`-joined (e.g. `Work/Prod/db1`).
 * Deliberately does NOT import the stored password: WinSCP's own scheme
 * only reversibly obfuscates it (not real encryption), but re-implementing
 * that scheme without a way to validate it against a real WinSCP install
 * risks silently importing a wrong plaintext password with no visible error
 * — worse than just asking the user to retype it.
 */
export async function scanWinScpSessions(
  /** Overridable only for unit tests (see SessionImporter.test.ts) — real callers never pass this, so the win32 gate below still applies to them. */
  queryFn?: (key: string) => Promise<string | null>,
  defaultUser: string = os.userInfo().username
): Promise<ImportedSessionCandidate[]> {
  if (!queryFn && process.platform !== 'win32') {
    return []
  }
  const query = queryFn ?? regQuery
  const listing = await query(WINSCP_ROOT)
  if (!listing) {
    return []
  }
  const candidates: ImportedSessionCandidate[] = []
  await Promise.all(
    listRegSubkeyPaths(listing, WINSCP_ROOT).map((subkey) =>
      walkWinScpNode(subkey, [], candidates, 0, query, defaultUser)
    )
  )
  return candidates
}

interface SshConfigHost {
  alias: string
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
}

function expandHome(p: string, home: string): string {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(home, p.slice(1)) : p
}

export function parseSshConfig(
  text: string,
  home: string = os.homedir(),
  defaultUser: string = os.userInfo().username
): ImportedSessionCandidate[] {
  // Host patterns select candidates; only concrete aliases are imported.
  // Resolve each option in OpenSSH's first-matching-value-wins order.
  const sections: Array<{ patterns: string[]; options: Partial<SshConfigHost> }> = []
  const aliases: string[] = []
  let current: (typeof sections)[number] | undefined = { patterns: ['*'], options: {} }
  sections.push(current)
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(\S+?)(?:\s*=\s*|\s+)(.+)$/.exec(line)
    if (!match) continue
    const key = match[1].toLowerCase()
    const args = [...match[2].matchAll(/(?:^|\s+)(?:"([^"]*)"|([^\s"#][^\s"]*)|(#.*$))/g)]
      .filter((token) => token[3] === undefined)
      .map((token) => token[1] ?? token[2])
    if (args.length === 0) continue
    const [value] = args
    if (key === 'host') {
      const patterns = args
      current = { patterns, options: {} }
      sections.push(current)
      for (const pattern of patterns) {
        if (!pattern.startsWith('!') && !/[*?]/.test(pattern) && !aliases.includes(pattern)) aliases.push(pattern)
      }
    } else if (key === 'match') {
      // Match conditions are intentionally unsupported.
      current = undefined
    } else if (current) {
      const options = current.options
      if (key === 'hostname' && options.hostName === undefined) options.hostName = value
      else if (key === 'user' && options.user === undefined) options.user = value
      else if (key === 'port' && options.port === undefined) {
        const port = Number(value)
        options.port = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 22
      } else if (key === 'identityfile' && options.identityFile === undefined) options.identityFile = expandHome(value.replace(/%%/g, '%'), home)
      else if (key === 'proxyjump' && options.proxyJump === undefined) options.proxyJump = value
    }
  }

  const matches = (patterns: string[], alias: string): boolean => {
    let positive = false
    for (const raw of patterns) {
      const negated = raw.startsWith('!')
      const pattern = negated ? raw.slice(1) : raw
      const escaped = [...pattern].map((char) => {
        if (char === '*') return '.*'
        if (char === '?') return '.'
        return char.replace(/[\\^$+?.()|[\]{}]/g, '\\$&')
      }).join('')
      if (new RegExp('^' + escaped + '$').test(alias)) {
        if (negated) return false
        positive = true
      }
    }
    return positive
  }

  const hosts: SshConfigHost[] = aliases.map((alias) => {
    const host: SshConfigHost = { alias }
    for (const section of sections) {
      if (!matches(section.patterns, alias)) continue
      for (const key of ['hostName', 'user', 'port', 'identityFile', 'proxyJump'] as const) {
        if (host[key] === undefined && section.options[key] !== undefined) {
          Object.assign(host, { [key]: section.options[key] })
        }
      }
    }
    return host
  })

  const byAlias = new Map(hosts.map((h) => [h.alias, h]))
  const parseValidPort = (raw: string | undefined): number => {
    const n = raw ? Number.parseInt(raw, 10) : 22
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 22
  }

  const toHop = (spec: string): JumpHostConfig => {
    const known = byAlias.get(spec)
    if (known) {
      return {
        host: known.hostName ?? known.alias,
        port: known.port ?? 22,
        username: known.user ?? defaultUser,
        authMethod: known.identityFile ? 'privateKey' : 'password',
        privateKeyPath: known.identityFile
      }
    }
    const at = spec.indexOf('@')
    const username = at >= 0 ? spec.slice(0, at) : defaultUser
    const hostPort = spec.slice(at + 1)
    let host = hostPort
    let portStr: string | undefined
    if (hostPort.startsWith('[')) {
      const closeIdx = hostPort.indexOf(']')
      if (closeIdx !== -1) {
        host = hostPort.slice(1, closeIdx)
        if (hostPort[closeIdx + 1] === ':') {
          portStr = hostPort.slice(closeIdx + 2)
        }
      }
    } else {
      const firstColon = hostPort.indexOf(':')
      const lastColon = hostPort.lastIndexOf(':')
      if (firstColon !== -1 && firstColon === lastColon) {
        host = hostPort.slice(0, firstColon)
        portStr = hostPort.slice(firstColon + 1)
      }
    }
    return { host, port: parseValidPort(portStr), username, authMethod: 'password' }
  }

  return hosts.map((h) => ({
    source: 'sshconfig' as const,
    name: h.alias,
    host: h.hostName ?? h.alias,
    port: h.port ?? 22,
    username: h.user ?? defaultUser,
    privateKeyPath: h.identityFile,
    jumpHosts:
      h.proxyJump && h.proxyJump.toLowerCase() !== 'none'
        ? h.proxyJump.split(',').map((spec) => toHop(spec.trim()))
        : undefined
  }))
}

export async function scanSshConfig(): Promise<ImportedSessionCandidate[]> {
  return parseSshConfig(await readFile(path.join(os.homedir(), '.ssh', 'config'), 'utf-8'))
}

/** Scans every supported source. One source failing (e.g. a locked-down registry) doesn't hide results from the other. */
export async function scanImportCandidates(): Promise<ImportedSessionCandidate[]> {
  const [putty, winscp, sshConfig] = await Promise.all([
    scanPuttySessions().catch(() => []),
    scanWinScpSessions().catch(() => []),
    scanSshConfig().catch(() => [])
  ])
  return [...winscp, ...putty, ...sshConfig]
}

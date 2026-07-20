import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ImportedSessionCandidate } from '../../shared/contract'
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
export async function scanPuttySessions(): Promise<ImportedSessionCandidate[]> {
  if (process.platform !== 'win32') {
    return []
  }
  const listing = await regQuery(PUTTY_ROOT)
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
    const detail = await regQuery(subkey)
    if (!detail) {
      continue
    }
    const values = parseRegValues(detail)
    const host = values.get('HostName')
    if (!host) {
      continue
    }
    candidates.push({
      source: 'putty',
      name,
      host,
      port: parseDword(values.get('PortNumber'), 22),
      username: values.get('UserName') ?? '',
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
  queryFn: (key: string) => Promise<string | null>
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
    candidates.push({
      source: 'winscp',
      name: names.join('/'),
      host,
      port: parseDword(values.get('PortNumber'), 22),
      username: values.get('UserName') ?? '',
      privateKeyPath: values.get('PublicKeyFile') || undefined,
      remoteInitialPath: values.get('RemoteDirectory') || undefined
    })
  }
  await Promise.all(
    listRegSubkeyPaths(detail, subkey).map((child) => walkWinScpNode(child, names, candidates, depth + 1, queryFn))
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
  queryFn?: (key: string) => Promise<string | null>
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
    listRegSubkeyPaths(listing, WINSCP_ROOT).map((subkey) => walkWinScpNode(subkey, [], candidates, 0, query))
  )
  return candidates
}

/** Scans every supported source. One source failing (e.g. a locked-down registry) doesn't hide results from the other. */
export async function scanImportCandidates(): Promise<ImportedSessionCandidate[]> {
  const [putty, winscp] = await Promise.all([
    scanPuttySessions().catch(() => []),
    scanWinScpSessions().catch(() => [])
  ])
  return [...winscp, ...putty]
}

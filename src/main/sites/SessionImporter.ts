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
  for (const subkey of listRegSubkeyPaths(listing)) {
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

/**
 * Scans WinSCP's saved sessions
 * (`HKCU\Software\Martin Prikryl\WinSCP 2\Sessions`). Deliberately does NOT
 * import the stored password: WinSCP's own scheme only reversibly obfuscates
 * it (not real encryption), but re-implementing that scheme without a way to
 * validate it against a real WinSCP install risks silently importing a wrong
 * plaintext password with no visible error — worse than just asking the user
 * to retype it. Nested folder groups (a session name containing further
 * subkeys) are skipped, not recursed into — see the roadmap for why.
 */
export async function scanWinScpSessions(): Promise<ImportedSessionCandidate[]> {
  if (process.platform !== 'win32') {
    return []
  }
  const listing = await regQuery(WINSCP_ROOT)
  if (!listing) {
    return []
  }
  const candidates: ImportedSessionCandidate[] = []
  for (const subkey of listRegSubkeyPaths(listing)) {
    const rawName = subkey.slice(subkey.lastIndexOf('\\') + 1)
    const name = decodeSessionName(rawName)
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
      source: 'winscp',
      name,
      host,
      port: parseDword(values.get('PortNumber'), 22),
      username: values.get('UserName') ?? '',
      privateKeyPath: values.get('PublicKeyFile') || undefined,
      remoteInitialPath: values.get('RemoteDirectory') || undefined
    })
  }
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

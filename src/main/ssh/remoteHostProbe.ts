import { formatRemoteOsLabel, type RemoteHostInfo, type RemoteInitSystem } from '../../shared/contract'

export { formatRemoteOsLabel }

const MARKER = '@@@'

/**
 * Single-exec POSIX probe for remote OS, kernel, distro (/etc/os-release), shell, and init system.
 * Safe across GNU/Linux, Alpine/BusyBox, macOS, and BSDs; never fails the SSH session.
 */
export const REMOTE_HOST_PROBE_COMMAND =
  'uname -srm 2>/dev/null || true; echo @@@; ' +
  'cat /etc/os-release 2>/dev/null || uname -v 2>/dev/null || true; echo @@@; ' +
  'printf "%s\\n" "${SHELL:-}"; echo @@@; ' +
  'if [ -d /run/systemd/system ]; then echo systemd; ' +
  'elif command -v rc-service >/dev/null 2>&1 || [ -d /run/openrc ]; then echo openrc; ' +
  'elif command -v service >/dev/null 2>&1; then echo sysvinit; ' +
  'elif [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then echo launchd; ' +
  'else echo unknown; fi'

function parseOsRelease(text: string): string | undefined {
  let prettyName: string | undefined
  let name: string | undefined
  let versionId: string | undefined

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!val) continue
    if (key === 'PRETTY_NAME') prettyName = val
    else if (key === 'NAME') name = val
    else if (key === 'VERSION_ID') versionId = val
  }

  if (prettyName) return prettyName.slice(0, 100)
  if (name) return (versionId ? `${name} ${versionId}` : name).slice(0, 100)
  return undefined
}

function parseInitSystem(raw: string): RemoteInitSystem {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === 'systemd' || trimmed === 'openrc' || trimmed === 'sysvinit' || trimmed === 'launchd') {
    return trimmed
  }
  return 'unknown'
}

/** Parses stdout from {@link REMOTE_HOST_PROBE_COMMAND} into a compact {@link RemoteHostInfo}. */
export function parseRemoteHostInfo(stdout: string): RemoteHostInfo | null {
  const sections = stdout.split(new RegExp(`^${MARKER}\\s*$`, 'm')).map((s) => s.trim())
  const unameLine = sections[0] ?? ''
  const osReleaseText = sections[1] ?? ''
  const shellRaw = sections[2] ?? ''
  const initRaw = sections[3] ?? ''

  const unameParts = unameLine.split(/\s+/).filter(Boolean)
  const os = unameParts[0] || ''
  const kernel = unameParts[1] || undefined
  const arch = unameParts[2] || undefined
  const distro = parseOsRelease(osReleaseText)
  const shell = shellRaw.split(/\r?\n/)[0]?.trim().slice(0, 80) || undefined
  const initSystem = parseInitSystem(initRaw)

  if (!os && !distro && !shell) {
    return null
  }

  return {
    os: os || 'Unknown',
    ...(distro ? { distro } : {}),
    ...(kernel ? { kernel } : {}),
    ...(arch ? { arch } : {}),
    ...(shell ? { shell } : {}),
    initSystem
  }
}

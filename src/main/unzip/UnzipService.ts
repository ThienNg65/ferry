import { SessionManager } from '../ssh/SessionManager'
import { SshError } from '../ssh/errors'
import type { UnzipResult } from '../../shared/contract'

/** Sentinel printed to stderr when the remote host has no `unzip` binary. */
const UNZIP_MISSING_SENTINEL = '__UNZIP_MISSING__'

/** Single-quotes a value for safe interpolation into a remote shell command. */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Extracts a remote archive in place via SSH exec — no download/upload
 * round-trip. Runs exactly `unzip -qo <archive> -d <targetDir>`, guarded by a
 * `command -v unzip` pre-check so a missing binary is reported with a clear
 * message instead of a raw exit code.
 */
export async function extractRemote(
  sessionId: string,
  archivePath: string,
  targetDir: string
): Promise<UnzipResult> {
  const shell = SessionManager.getInstance().shell(sessionId)
  const command =
    `sh -c "command -v unzip >/dev/null 2>&1 || { echo '${UNZIP_MISSING_SENTINEL}' >&2; exit 127; }; ` +
    `unzip -qo ${shellEscape(archivePath)} -d ${shellEscape(targetDir)}"`

  const result = await shell.exec(command, { timeoutMs: 5 * 60 * 1000 })

  if (result.code === 127 && result.stderr.includes(UNZIP_MISSING_SENTINEL)) {
    throw new SshError(
      'UNZIP_NOT_FOUND',
      'unzip is not installed on this server — ask your admin to install it (e.g. apt/yum install unzip).'
    )
  }
  if (result.code !== 0) {
    throw new SshError('SSH_EXEC', result.stderr.trim() || result.stdout.trim() || `unzip exited with code ${result.code}`)
  }

  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code }
}

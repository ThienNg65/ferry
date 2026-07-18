import { SessionManager } from '../ssh/SessionManager'
import { SshError } from '../ssh/errors'
import { shellEscape } from '../ssh/shellEscape'
import { archiveKind, type ArchiveKind } from '../../shared/archive'
import type { UnzipResult } from '../../shared/contract'

/** Sentinel printed to stderr when the remote host has no matching extraction tool. */
const EXTRACT_TOOL_MISSING_SENTINEL = '__EXTRACT_TOOL_MISSING__'

function toolFor(kind: ArchiveKind): string {
  return kind === 'zip' ? 'unzip' : 'tar'
}

export function buildExtractCommand(kind: ArchiveKind, archivePath: string, targetDir: string): string {
  const archive = shellEscape(archivePath)
  const target = shellEscape(targetDir)
  const tool = toolFor(kind)
  const cmd =
    kind === 'zip'
      ? `unzip -qo ${archive} -d ${target}`
      : kind === 'tar'
        ? `tar -xf ${archive} -C ${target}`
        : kind === 'targz'
          ? `tar -xzf ${archive} -C ${target}`
          : `tar -xjf ${archive} -C ${target}`
  // The inner command is assembled with each path already shellEscape()'d, then the
  // WHOLE inner command is shellEscape()'d again as a single argument to the outer
  // `sh -c`. Wrapping it in hand-built double quotes instead (as this used to do)
  // would be unsafe: $(...) / backticks are still live inside a double-quoted
  // string, so a path containing one would execute before ever reaching the inner
  // shell, regardless of its own nested single-quoting.
  const inner =
    `command -v ${tool} >/dev/null 2>&1 || ` +
    `{ echo ${shellEscape(EXTRACT_TOOL_MISSING_SENTINEL)} >&2; exit 127; }; mkdir -p ${target} && ${cmd}`
  return `sh -c ${shellEscape(inner)}`
}

/**
 * Extracts a remote archive in place via SSH exec — no download/upload
 * round-trip. Recognizes .zip (via `unzip`) and .tar/.tar.gz/.tgz/.tar.bz2/
 * .tbz2 (via `tar`), guarded by a `command -v` pre-check so a missing binary
 * is reported with a clear message instead of a raw exit code.
 */
export async function extractRemote(
  sessionId: string,
  archivePath: string,
  targetDir: string,
  signal?: AbortSignal
): Promise<UnzipResult> {
  const kind = archiveKind(archivePath)
  if (!kind) {
    throw new SshError('VALIDATION', `Unsupported archive type: ${archivePath}`)
  }

  const shell = SessionManager.getInstance().shell(sessionId)
  const command = buildExtractCommand(kind, archivePath, targetDir)

  const result = await shell.exec(command, { timeoutMs: 5 * 60 * 1000, signal })

  if (result.code === 127 && result.stderr.includes(EXTRACT_TOOL_MISSING_SENTINEL)) {
    const tool = toolFor(kind)
    throw new SshError(
      'ARCHIVE_TOOL_NOT_FOUND',
      `${tool} is not installed on this server — ask your admin to install it (e.g. apt/yum install ${tool}).`
    )
  }
  if (result.code !== 0) {
    throw new SshError('SSH_EXEC', result.stderr.trim() || result.stdout.trim() || `extraction exited with code ${result.code}`)
  }

  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code }
}

import { createWriteStream } from 'fs'
import { stat, unlink } from 'fs/promises'
import * as path from 'path'
import { SessionManager } from '../ssh/SessionManager'
import { SshError } from '../ssh/errors'
import { shellEscape } from '../ssh/shellEscape'
import type { UnzipResult } from '../../shared/contract'

/** Sentinel printed to stderr when the remote host has no `zip` binary. */
const COMPRESS_TOOL_MISSING_SENTINEL = '__COMPRESS_TOOL_MISSING__'

/** Splits a `/`-separated remote path into its parent directory and final segment — mirrors {@link TransferQueue}'s manual remote-path joins rather than pulling in `path.posix` for one call site. */
export function splitRemotePath(remotePath: string): { dir: string; base: string } {
  const clean = remotePath.length > 1 ? remotePath.replace(/\/+$/, '') : remotePath
  const idx = clean.lastIndexOf('/')
  if (idx === -1) {
    return { dir: '.', base: clean }
  }
  if (idx === 0) {
    return { dir: '/', base: clean.slice(1) }
  }
  return { dir: clean.slice(0, idx), base: clean.slice(idx + 1) }
}

/**
 * Zips a single local file or folder into `destZipPath`. Uses `archiver`
 * (streamed, not loaded into memory) so large folders don't blow up heap —
 * the archive's internal paths are rooted at the source's own basename, not
 * its full absolute path (e.g. zipping `C:\data\report` produces a zip whose
 * top-level entry is `report/`, not `C\data\report/`).
 */
export async function compressLocal(
  sourcePath: string,
  destZipPath: string,
  opts: { signal?: AbortSignal; onProgress?: (processedBytes: number, totalBytes: number) => void } = {}
): Promise<void> {
  const info = await stat(sourcePath)
  if (opts.signal?.aborted) {
    throw new SshError('CANCELLED', 'Compression cancelled')
  }
  // Lazy-load archiver only when a local compress actually runs, keeping it off
  // the app-startup critical path (remote compress uses the server's `zip`).
  const { ZipArchive } = await import('archiver')
  if (opts.signal?.aborted) {
    throw new SshError('CANCELLED', 'Compression cancelled')
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(destZipPath)
      const archive = new ZipArchive({ zlib: { level: 9 } })
      let settled = false
      let outputFinished = false
      let pendingErr: Error | undefined
      const finish = (err?: Error): void => {
        if (settled) {
          return
        }
        settled = true
        opts.signal?.removeEventListener('abort', onAbort)
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      }
      const onAbort = (): void => {
        pendingErr = new SshError('CANCELLED', 'Compression cancelled')
        archive.abort()
        output.destroy()
        if (output.closed) {
          finish(pendingErr)
        }
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      output.on('finish', () => {
        outputFinished = true
      })
      output.on('close', () => {
        if (!outputFinished && !pendingErr) {
          pendingErr = new SshError('UNKNOWN', `ZIP output "${destZipPath}" closed before finishing`)
          archive.abort()
        }
        finish(pendingErr)
      })
      output.on('error', (err) => {
        pendingErr ??= err
        // Wait for close before rejecting so Windows can unlink the partial file.
        output.destroy()
        if (output.closed) finish(pendingErr)
      })
      archive.on('error', (err) => {
        pendingErr ??= err
        output.destroy()
        if (output.closed) finish(pendingErr)
      })
      if (opts.onProgress) {
        // archiver's totalBytes grows as it scans the tree — callers just
        // render whatever ratio has been discovered so far.
        archive.on('progress', (p) => opts.onProgress?.(p.fs.processedBytes, p.fs.totalBytes))
      }
      archive.pipe(output)
      if (info.isDirectory()) {
        archive.directory(sourcePath, path.basename(sourcePath))
      } else {
        archive.file(sourcePath, { name: path.basename(sourcePath) })
      }
      void archive.finalize().catch((err: Error) => {
        pendingErr ??= err
        output.destroy()
        if (output.closed) finish(pendingErr)
      })
    })
  } catch (e) {
    // Best-effort removal of the partial/corrupt zip any failed run leaves
    // behind — a cancellation, a disk-full error, or a permission error from
    // archiver/fs can all leave a dangling partial file at destZipPath.
    await unlink(destZipPath).catch(() => undefined)
    throw e
  }
}

/**
 * Builds the remote `zip` invocation for {@link compressRemote}. The inner
 * command is assembled with each path already `shellEscape()`'d, then the
 * WHOLE inner command is `shellEscape()`'d again as a single argument to the
 * outer `sh -c`. Wrapping it in a hand-built double-quoted string instead
 * (as this used to do) is unsafe: `$(...)`/backticks are still live inside a
 * double-quoted string, so a path containing one would execute before ever
 * reaching the inner shell, regardless of its own nested single-quoting.
 */
export function buildCompressCommand(sourcePath: string, destZipPath: string): string {
  const { dir, base } = splitRemotePath(sourcePath)
  const cwd = shellEscape(dir)
  const source = shellEscape(base)
  const dest = shellEscape(destZipPath)
  // Stage in the destination directory so the final rename stays on the same
  // filesystem. The old archive is never touched until zip and its integrity
  // check both succeed. A trap removes only the private staging directory.
  const inner = [
    `command -v zip >/dev/null 2>&1 || { echo ${shellEscape(COMPRESS_TOOL_MISSING_SENTINEL)} >&2; exit 127; }`,
    `cd ${cwd} || exit 1`,
    `source_name=${source}`,
    `destination=${dest}`,
    'destination_dir=$(dirname -- "$destination") || exit 1',
    'destination_dir=$(cd "$destination_dir" && pwd -P) || exit 1',
    'destination="$destination_dir/$(basename -- "$destination")"',
    // Refuse an output inside its input tree rather than silently embedding
    // an old archive (or the temporary archive) in the new ZIP.
    'if [ -d "$source_name" ]; then',
    '  source_dir=$(cd "$source_name" && pwd -P) || exit 1',
    '  case "$destination/" in "$source_dir/"*) echo "Destination cannot be inside the source directory" >&2; exit 1;; esac',
    'fi',
    'staging=$(mktemp -d "$destination_dir/.ferry-zip-XXXXXXXX") || exit 1',
    'trap \'rm -rf -- "$staging"\' EXIT',
    'trap \'exit 130\' INT',
    'trap \'exit 143\' TERM',
    // Prefix ./ to prevent source names beginning with '-' being treated as options.
    'zip -rq "$staging/archive.zip" "./$source_name" || exit $?',
    'zip -T "$staging/archive.zip" >/dev/null || exit $?',
    'mv -f -- "$staging/archive.zip" "$destination" || exit $?'
  ].join('\n')

  return `sh -c ${shellEscape(inner)}`
}

/**
 * Zips a single remote file or folder in place via SSH exec (`zip -r`) — no
 * download/upload round-trip, mirroring {@link extractRemote}'s shape and
 * missing-tool handling. `cd`s into the source's parent first so the
 * archive's internal paths are rooted at its basename, same as the local path.
 */
export async function compressRemote(
  sessionId: string,
  sourcePath: string,
  destZipPath: string,
  signal?: AbortSignal
): Promise<UnzipResult> {
  const shell = SessionManager.getInstance().shell(sessionId)
  const command = buildCompressCommand(sourcePath, destZipPath)

  const result = await shell.exec(command, { timeoutMs: 5 * 60 * 1000, signal })

  if (result.code === 127 && result.stderr.includes(COMPRESS_TOOL_MISSING_SENTINEL)) {
    throw new SshError(
      'ARCHIVE_TOOL_NOT_FOUND',
      'zip is not installed on this server — ask your admin to install it (e.g. apt/yum install zip).'
    )
  }
  if (result.code !== 0) {
    throw new SshError('SSH_EXEC', result.stderr.trim() || result.stdout.trim() || `compress exited with code ${result.code}`)
  }

  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code }
}

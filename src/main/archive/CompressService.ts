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
  const idx = remotePath.lastIndexOf('/')
  if (idx <= 0) {
    return { dir: '/', base: remotePath.slice(idx + 1) }
  }
  return { dir: remotePath.slice(0, idx), base: remotePath.slice(idx + 1) }
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
  try {
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(destZipPath)
      const archive = new ZipArchive({ zlib: { level: 9 } })
      let settled = false
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
        archive.abort()
        output.destroy()
        finish(new SshError('CANCELLED', 'Compression cancelled'))
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      output.on('close', () => finish())
      output.on('error', finish)
      archive.on('error', finish)
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
      void archive.finalize()
    })
  } catch (e) {
    if (e instanceof SshError && e.code === 'CANCELLED') {
      // Best-effort removal of the partial zip a cancelled run leaves behind.
      await unlink(destZipPath).catch(() => undefined)
    }
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
  const inner =
    `command -v zip >/dev/null 2>&1 || ` +
    // `--` stops `zip` from parsing `source` as an option even if the shellEscape'd basename
    // starts with `-` (e.g. a file literally named "-T") — shellEscape only guards the shell,
    // not zip's own argv parsing.
    `{ echo ${shellEscape(COMPRESS_TOOL_MISSING_SENTINEL)} >&2; exit 127; }; cd ${cwd} && zip -rq ${dest} -- ${source}`
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

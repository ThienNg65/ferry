import { StringDecoder } from 'node:string_decoder'
import { posix as pathPosix } from 'node:path'
import type { Client, ClientChannel, SFTPWrapper, Stats } from 'ssh2'
import { BoundedLineBuffer } from './BoundedLineBuffer'
import { SshError } from './errors'
import { withRetry } from './retry'
import { shellEscape } from './shellEscape'

/** Result of a buffered remote command. */
export interface ExecResult {
  /** Full stdout captured. */
  stdout: string
  /** Full stderr captured. */
  stderr: string
  /** Process exit code (or null if the channel closed without one). */
  code: number | null
}

/** Options shared by all remote operations. */
export interface RemoteOptions {
  /** Hard timeout in ms; the operation rejects with SSH_TIMEOUT when exceeded. */
  timeoutMs?: number
  /** Abort signal — aborting destroys the channel and rejects with CANCELLED. */
  signal?: AbortSignal
  /** Retry attempts for transient failures (1 = no retry). Default 1. */
  attempts?: number
}

/** Options for {@link RemoteShell.execLines}. */
export interface ExecLinesOptions extends Omit<RemoteOptions, 'timeoutMs'> {
  /** Idle timeout after channel open. Null keeps a quiet stream connected. */
  timeoutMs?: number | null
  /** Called for each stdout line; oversized lines are capped and marked as truncated. */
  onLine: (line: string) => void
  /** Called for each chunk of stderr. */
  onStderr?: (chunk: string) => void
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Encodes path bytes for a fixed POSIX shell script without interpolating
 * untrusted path characters into the account shell's command syntax.
 */
function shellOctalEscape(value: string): string {
  return Array.from(Buffer.from(value, 'utf8'), (byte) =>
    `\\${byte.toString(8).padStart(3, '0')}`
  ).join('')
}

/** A directory entry as reported over SFTP. */
export interface SftpEntry {
  filename: string
  longname: string
  /**
   * Whether the raw (lstat-style) SFTP attrs report this entry as a
   * directory. For a symlink this reflects the *link itself*, not its
   * target — callers must resolve symlinked entries separately via `stat`.
   */
  isDirectory: boolean
  isSymlink: boolean
  size: number
  /** Modified time in epoch milliseconds. */
  mtimeMs: number
  /** Octal permission string, e.g. "0755". */
  permissions: string
}

/**
 * RemoteShell — resilient wrapper around a single connected `ssh2.Client`.
 *
 * Every buffered/streamed exec enforces a hard timeout, honours an
 * {@link AbortSignal}, and can retry transient failures with exponential
 * backoff. The shell does NOT own the connection lifecycle — the
 * SessionManager does. It only issues operations over a client it is handed.
 *
 * Covers both exec (buffered/streamed) and SFTP off the same connection —
 * a wrapper library that only exposes SFTP (e.g. ssh2-sftp-client) would give
 * no path to raw exec channels, which remote tail and remote unzip both need.
 */
export class RemoteShell {
  private readonly client: Client
  private sftpPromise: Promise<SFTPWrapper> | null = null

  /**
   * @param client - an already-connected ssh2 Client owned by the SessionManager.
   */
  constructor(client: Client) {
    this.client = client
  }

  // ── Buffered exec ──────────────────────────────────────────────────────────

  /**
   * Runs a remote command and resolves with its full output, including the
   * exit code — a non-zero exit is NOT rejected (the command may have had
   * side effects, and "failure" is command-specific); callers check
   * `result.code` themselves (see {@link UnzipService.extractRemote}).
   * Only rejects with {@link SshError} `SSH_TIMEOUT` on timeout, `SSH_EXEC` if
   * the channel itself fails to open, or `CANCELLED` when the signal aborts.
   *
   * @param command - shell command to run
   * @param opts    - timeout / signal / retry
   */
  exec(command: string, opts: RemoteOptions = {}): Promise<ExecResult> {
    return withRetry(() => this.execOnce(command, opts), {
      attempts: opts.attempts ?? 1,
      signal: opts.signal
    })
  }

  execWithStdin(
    command: string,
    input?: Buffer,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<{ stdout: Buffer; stderr: string; code: number | null }> {
    const timeoutMs = opts.timeoutMs ?? 120_000
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(new SshError('CANCELLED', 'Command cancelled'))
        return
      }
      let settled = false
      let activeStream: ClientChannel | null = null
      let timer: ReturnType<typeof setTimeout> | null = null

      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        opts.signal?.removeEventListener('abort', onAbort)
      }
      const fail = (e: SshError): void => {
        if (settled) return
        settled = true
        cleanup()
        activeStream?.destroy()
        reject(e)
      }
      const onAbort = (): void => fail(new SshError('CANCELLED', 'Command cancelled'))
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      timer = setTimeout(() => {
        fail(new SshError('SSH_TIMEOUT', `Command timed out after ${timeoutMs}ms`, true))
      }, timeoutMs)

      this.client.exec(command, (execErr, stream) => {
        if (execErr) {
          fail(new SshError('SSH_EXEC', execErr.message))
          return
        }
        if (settled) {
          stream.destroy()
          return
        }
        activeStream = stream
        const out: Buffer[] = []
        const stderr: Buffer[] = []
        stream.on('data', (chunk: Buffer) => out.push(chunk))
        stream.stderr.on('data', (chunk: Buffer) => {
          stderr.push(chunk)
        })
        stream.on('close', (code: number | null) => {
          if (settled) return
          settled = true
          cleanup()
          resolve({ stdout: Buffer.concat(out), stderr: Buffer.concat(stderr).toString('utf8'), code })
        })
        stream.on('error', (e: Error) => fail(new SshError('SSH_EXEC', e.message)))
        stream.end(input)
      })
    })
  }

  private execOnce(command: string, opts: RemoteOptions): Promise<ExecResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise<ExecResult>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      // Set once the channel opens — lets onAbort destroy it exactly like the timeout path
      // does, instead of leaving it open server-side until the remote command exits on its own.
      let activeStream: ClientChannel | null = null

      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        opts.signal?.removeEventListener('abort', onAbort)
      }
      const fail = (e: SshError): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        activeStream?.destroy()
        reject(e)
      }
      const onAbort = (): void => fail(new SshError('CANCELLED', 'Command cancelled'))

      if (opts.signal?.aborted) {
        reject(new SshError('CANCELLED', 'Command cancelled'))
        return
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      timer = setTimeout(() => {
        fail(new SshError('SSH_TIMEOUT', `Command timed out after ${timeoutMs}ms`, true))
      }, timeoutMs)

      this.client.exec(command, (execErr, stream) => {
        if (execErr) {
          fail(new SshError('SSH_EXEC', execErr.message, true))
          return
        }
        if (settled) {
          // Aborted (or timed out) in the window between the exec call and this callback.
          stream.destroy()
          return
        }
        activeStream = stream

        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        stream.on('data', (chunk: Buffer) => {
          stdout.push(chunk)
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          stderr.push(chunk)
        })
        stream.on('error', (e: Error) => fail(new SshError('SSH_EXEC', e.message, true)))
        stream.on('close', (code: number | null) => {
          if (settled) {
            return
          }
          settled = true
          cleanup()
          resolve({
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            code
          })
        })
      })
    })
  }

  // ── Streamed exec ────────────────────────────────────────────────────────────

  /**
   * Runs a remote command and invokes `onLine` for each complete stdout line.
   *
   * Used for long-running commands (`tail -F`) where output must surface
   * incrementally. Resolves when the channel closes. Timeout and abort reject
   * as in {@link exec}.
   *
   * @param command - shell command to run
   * @param opts    - line callback plus timeout / signal
   */
  execLines(command: string, opts: ExecLinesOptions): Promise<number | null> {
    const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs

    return new Promise<number | null>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      // Set once the channel opens — lets onAbort destroy it exactly like the timeout path
      // does, instead of leaving it open server-side until the remote command exits on its own.
      let activeStream: ClientChannel | null = null

      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer)
        }
        opts.signal?.removeEventListener('abort', onAbort)
      }
      const fail = (e: SshError): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        activeStream?.destroy()
        reject(e)
      }
      const onAbort = (): void => fail(new SshError('CANCELLED', 'Stream cancelled'))

      if (opts.signal?.aborted) {
        reject(new SshError('CANCELLED', 'Stream cancelled'))
        return
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      const arm = (delayMs: number | null): void => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        if (delayMs !== null) {
          timer = setTimeout(() => {
            fail(new SshError('SSH_TIMEOUT', `Stream idle for ${delayMs}ms`, true))
          }, delayMs)
        }
      }
      // Even an indefinitely quiet stream must open its channel promptly.
      arm(timeoutMs ?? DEFAULT_TIMEOUT_MS)

      this.client.exec(command, (execErr, stream) => {
        if (execErr) {
          fail(new SshError('SSH_EXEC', execErr.message, true))
          return
        }
        if (settled) {
          // Aborted (or timed out) in the window between the exec call and this callback.
          stream.destroy()
          return
        }
        activeStream = stream
        arm(timeoutMs)

        const stdoutDecoder = new StringDecoder('utf8')
        const stderrDecoder = new StringDecoder('utf8')
        const stdoutLines = new BoundedLineBuffer()
        const emitStdoutLine = (raw: string): void => {
          const line = raw.replace(/\r$/, '')
          if (line.length > 0) {
            opts.onLine(line)
          }
        }

        stream.on('data', (chunk: Buffer) => {
          arm(timeoutMs)
          stdoutLines.push(stdoutDecoder.write(chunk), emitStdoutLine)
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          arm(timeoutMs)
          const decoded = stderrDecoder.write(chunk)
          if (decoded.length > 0) {
            opts.onStderr?.(decoded)
          }
        })
        stream.on('error', (e: Error) => fail(new SshError('SSH_EXEC', e.message, true)))
        stream.on('close', (code: number | null) => {
          if (settled) {
            return
          }
          settled = true
          cleanup()
          stdoutLines.push(stdoutDecoder.end(), emitStdoutLine)
          stdoutLines.flush(emitStdoutLine)
          const stderrRemainder = stderrDecoder.end()
          if (stderrRemainder.length > 0) {
            opts.onStderr?.(stderrRemainder)
          }
          resolve(code)
        })
      })
    })
  }

  // ── Interactive shell (PTY) ───────────────────────────────────────────────────

  /**
   * Opens an interactive shell channel with a pseudo-terminal attached — the
   * basis for the Terminal feature. Unlike {@link exec}/{@link execLines},
   * the caller owns the returned channel directly (writes keystrokes, reads
   * output, resizes via `setWindow`); there is no buffering/timeout wrapper
   * here since a shell has no natural "done" state.
   *
   * @param opts - initial terminal size
   */
  openShell(opts: { cols: number; rows: number }): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      this.client.shell({ term: 'xterm-256color', cols: opts.cols, rows: opts.rows }, (err, stream) => {
        if (err) {
          reject(new SshError('SSH_EXEC', err.message))
          return
        }
        resolve(stream)
      })
    })
  }

  openShellAt(cwd: string, opts: { cols: number; rows: number }): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      const command = `cd ${shellEscape(cwd)} 2>/dev/null; exec "\${SHELL:-/bin/sh}" -l`
      this.client.exec(command, { pty: { term: 'xterm-256color', cols: opts.cols, rows: opts.rows } }, (err, stream) => {
        if (err) {
          reject(new SshError('SSH_EXEC', err.message))
          return
        }
        resolve(stream)
      })
    })
  }

  // ── SFTP ─────────────────────────────────────────────────────────────────────

  private withSftpTimeout<T>(
    label: string,
    timeoutMs: number,
    start: (resolve: (value: T) => void, reject: (err: unknown) => void) => void
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new SshError('SSH_TIMEOUT', `${label} timed out after ${timeoutMs}ms`, true))
      }, timeoutMs)
      start(
        (value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(value)
        },
        (err) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(err)
        }
      )
    })
  }

  /** Lazily opens (and caches) the SFTP subsystem for this connection. */
  sftp(): Promise<SFTPWrapper> {
    if (!this.sftpPromise) {
      let timedOut = false
      const pending = this.withSftpTimeout<SFTPWrapper>('SFTP subsystem open', DEFAULT_TIMEOUT_MS, (resolve, reject) => {
        this.client.sftp((sftpErr, sftp) => {
          if (timedOut) {
            sftp?.end()
            return
          }
          if (sftpErr) {
            if (this.sftpPromise === pending) {
              this.sftpPromise = null
            }
            reject(new SshError('SFTP', `SFTP subsystem error: ${sftpErr.message}`, true))
            return
          }
          const clear = (): void => {
            if (this.sftpPromise === pending) {
              this.sftpPromise = null
            }
          }
          sftp.once('close', clear)
          sftp.on('error', clear)
          resolve(sftp)
        })
      }).catch((err) => {
        timedOut = true
        if (this.sftpPromise === pending) {
          this.sftpPromise = null
        }
        throw err
      })
      this.sftpPromise = pending
    }
    return this.sftpPromise
  }

  /** Lists a remote directory's entries. */
  async readdir(remotePath: string): Promise<SftpEntry[]> {
    const sftp = await this.sftp()
    return this.withSftpTimeout<SftpEntry[]>(`SFTP readdir "${remotePath}"`, 60_000, (resolve, reject) => {
      sftp.readdir(remotePath, (readErr, list) => {
        if (readErr) {
          const code = (readErr as { code?: number }).code === 2 ? 'NOT_FOUND' : 'SFTP'
          reject(new SshError(code, `Failed to list "${remotePath}": ${readErr.message}`))
          return
        }
        resolve(
          list.map((item) => ({
            filename: item.filename,
            longname: item.longname,
            isDirectory: (item.attrs.mode & 0o170000) === 0o040000,
            isSymlink: (item.attrs.mode & 0o170000) === 0o120000,
            size: item.attrs.size ?? 0,
            mtimeMs: (item.attrs.mtime ?? 0) * 1000,
            permissions: (item.attrs.mode & 0o7777).toString(8).padStart(4, '0')
          }))
        )
      })
    })
  }

  /** Resolves a (possibly relative) remote path to its canonical absolute form. */
  async realpath(remotePath: string): Promise<string> {
    const sftp = await this.sftp()
    return this.withSftpTimeout<string>(`SFTP realpath "${remotePath}"`, DEFAULT_TIMEOUT_MS, (resolve, reject) => {
      sftp.realpath(remotePath, (realErr, absPath) => {
        if (realErr) {
          reject(new SshError('SFTP', `Failed to resolve "${remotePath}": ${realErr.message}`))
          return
        }
        resolve(absPath)
      })
    })
  }

  /** Resolves a symlink's immediate target (not canonicalized — unlike `realpath`, does not follow chains). */
  async readlink(remotePath: string): Promise<string> {
    const sftp = await this.sftp()
    return this.withSftpTimeout<string>(`SFTP readlink "${remotePath}"`, DEFAULT_TIMEOUT_MS, (resolve, reject) => {
      sftp.readlink(remotePath, (linkErr, target) => {
        if (linkErr) {
          reject(new SshError('SFTP', `Failed to read link "${remotePath}": ${linkErr.message}`))
          return
        }
        resolve(target)
      })
    })
  }

  /** Stats a remote path (following symlinks). */
  async stat(remotePath: string): Promise<Stats> {
    const sftp = await this.sftp()
    return this.withSftpTimeout<Stats>(`SFTP stat "${remotePath}"`, DEFAULT_TIMEOUT_MS, (resolve, reject) => {
      sftp.stat(remotePath, (statErr, stats) => {
        if (statErr) {
          reject(new SshError('NOT_FOUND', `"${remotePath}" not found: ${statErr.message}`))
          return
        }
        resolve(stats)
      })
    })
  }

  /** Stats a remote path without following symlinks. */
  async lstat(remotePath: string): Promise<Stats> {
    const sftp = await this.sftp()
    return this.withSftpTimeout<Stats>(`SFTP lstat "${remotePath}"`, DEFAULT_TIMEOUT_MS, (resolve, reject) => {
      sftp.lstat(remotePath, (statErr, stats) => {
        if (statErr) {
          const code = (statErr as { code?: number }).code === 2 ? 'NOT_FOUND' : 'SFTP'
          reject(new SshError(code, `"${remotePath}" not found: ${statErr.message}`))
          return
        }
        resolve(stats)
      })
    })
  }

  /** Reads up to `maxBytes` of a remote file as a raw Buffer, reusing an optional `stat` result. */
  async readFileBuffer(
    remotePath: string,
    maxBytes: number,
    existingStats?: Stats
  ): Promise<{ buffer: Buffer; truncated: boolean; size: number }> {
    const sftp = await this.sftp()
    const stats = existingStats ?? (await this.stat(remotePath))
    const size = stats.size ?? 0
    const length = Math.min(size, maxBytes)
    if (length === 0) {
      return { buffer: Buffer.alloc(0), truncated: size > length, size }
    }
    return new Promise((resolve, reject) => {
      const stream = sftp.createReadStream(remotePath, { start: 0, end: length - 1 })
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('error', (readErr: Error) => {
        reject(new SshError('SFTP', `Failed to read "${remotePath}": ${readErr.message}`))
      })
      stream.on('close', () => {
        resolve({
          buffer: Buffer.concat(chunks),
          truncated: size > maxBytes,
          size
        })
      })
    })
  }

  /** Reads a remote file's content as text, capped at `maxBytes` (huge files are truncated, not rejected). */
  async readFile(remotePath: string, maxBytes: number): Promise<{ content: string; truncated: boolean; size: number }> {
    const { buffer, truncated, size } = await this.readFileBuffer(remotePath, maxBytes)
    return {
      content: buffer.toString('utf-8'),
      truncated,
      size
    }
  }

  /** Creates a remote directory. */
  async mkdir(remotePath: string): Promise<void> {
    const sftp = await this.sftp()
    return this.withSftpTimeout<void>(`SFTP mkdir "${remotePath}"`, DEFAULT_TIMEOUT_MS, (resolve, reject) => {
      sftp.mkdir(remotePath, (mkdirErr) => {
        if (mkdirErr) {
          reject(new SshError('SFTP', `Failed to create "${remotePath}": ${mkdirErr.message}`))
          return
        }
        resolve()
      })
    })
  }

  async touch(remotePath: string): Promise<void> {
    const sftp = await this.sftp()
    return this.withSftpTimeout<void>(`SFTP touch "${remotePath}"`, DEFAULT_TIMEOUT_MS, (resolve, reject) => {
      sftp.open(remotePath, 'wx', (openErr, handle) => {
        if (openErr) {
          reject(new SshError('SFTP', `Failed to create "${remotePath}": ${openErr.message}`))
          return
        }
        sftp.close(handle, () => resolve())
      })
    })
  }

  /** Sets a remote path's permissions. `mode` is an octal string (e.g. "0755" or "755"). */
  async chmod(remotePath: string, mode: string): Promise<void> {
    if (!/^[0-7]{3,4}$/.test(mode)) {
      throw new SshError('VALIDATION', `Invalid permission mode "${mode}" — expected an octal string like "755" or "0755"`)
    }
    const sftp = await this.sftp()
    return this.withSftpTimeout<void>(`SFTP chmod "${remotePath}"`, DEFAULT_TIMEOUT_MS, (resolve, reject) => {
      sftp.chmod(remotePath, parseInt(mode, 8), (chmodErr) => {
        if (chmodErr) {
          reject(new SshError('SFTP', `Failed to set permissions on "${remotePath}": ${chmodErr.message}`))
          return
        }
        resolve()
      })
    })
  }

  /** Renames/moves a remote path. */
  async rename(fromPath: string, toPath: string): Promise<void> {
    const sftp = await this.sftp()
    return this.withSftpTimeout<void>(`SFTP rename "${fromPath}"`, DEFAULT_TIMEOUT_MS, (resolve, reject) => {
      sftp.rename(fromPath, toPath, (renameErr) => {
        if (renameErr) {
          reject(new SshError('SFTP', `Failed to rename "${fromPath}": ${renameErr.message}`))
          return
        }
        resolve()
      })
    })
  }

  /** Deletes a remote file. */
  async unlink(remotePath: string): Promise<void> {
    const sftp = await this.sftp()
    return this.withSftpTimeout<void>(`SFTP unlink "${remotePath}"`, DEFAULT_TIMEOUT_MS, (resolve, reject) => {
      sftp.unlink(remotePath, (unlinkErr) => {
        if (unlinkErr) {
          reject(new SshError('SFTP', `Failed to delete "${remotePath}": ${unlinkErr.message}`))
          return
        }
        resolve()
      })
    })
  }

  /** Removes a remote (empty) directory. */
  async rmdir(remotePath: string): Promise<void> {
    const sftp = await this.sftp()
    return this.withSftpTimeout<void>(`SFTP rmdir "${remotePath}"`, DEFAULT_TIMEOUT_MS, (resolve, reject) => {
      sftp.rmdir(remotePath, (rmdirErr) => {
        if (rmdirErr) {
          reject(new SshError('SFTP', `Failed to remove directory "${remotePath}": ${rmdirErr.message}`))
          return
        }
        resolve()
      })
    })
  }

  /** Creates a remote directory and any missing parent directories (`mkdir -p`; no error if it already exists). */
  async mkdirRecursive(remotePath: string): Promise<void> {
    try {
      const result = await this.exec(`mkdir -p -- ${shellEscape(remotePath)}`)
      if (result.code === 0) {
        return
      }
    } catch (e) {
      if (e instanceof SshError && (e.code === 'CANCELLED' || e.code === 'SSH_TIMEOUT')) {
        throw e
      }
    }
    await this.mkdirRecursiveSftp(remotePath)
  }

  private async mkdirRecursiveSftp(remotePath: string): Promise<void> {
    const isAbsolute = remotePath.startsWith('/')
    const parts = remotePath.split('/').filter(Boolean)
    let current = isAbsolute ? '' : '.'
    for (const part of parts) {
      current = current === '.' ? part : `${current}/${part}`
      try {
        const existing = await this.stat(current)
        if (!existing.isDirectory()) {
          throw new SshError('SFTP', `Cannot create directory "${current}": path exists as a non-directory`)
        }
      } catch (e) {
        if (e instanceof SshError && e.code !== 'NOT_FOUND') {
          throw e
        }
        try {
          await this.mkdir(current)
        } catch (mkdirErr) {
          const check = await this.stat(current).catch(() => null)
          if (!check?.isDirectory()) {
            throw mkdirErr
          }
        }
      }
    }
  }

  /** Walks parents before children over SFTP. When requested, includes symlinks as leaves. */
  async readdirRecursive(
    remotePath: string,
    includeSymlinks = false
  ): Promise<{ relPath: string; isDir: boolean; isSymlink?: true; size: number; mtimeMs?: number }[]> {
    const results: { relPath: string; isDir: boolean; isSymlink?: true; size: number; mtimeMs?: number }[] = []

    const walk = async (currentPath: string, relBase: string): Promise<void> => {
      const entries = await this.readdir(currentPath)
      for (const entry of entries) {
        if (entry.filename === '.' || entry.filename === '..') {
          continue
        }
        // The server controls `filename` — a malicious/compromised server could name an entry
        // `../../evil` or embed a path separator to escape the destination root once this relPath
        // is joined against a local/remote base elsewhere (TransferQueue, SyncService).
        if (!entry.filename || entry.filename.includes('/') || entry.filename.includes('\\')) {
          throw new SshError(
            'SFTP',
            `Refusing to process unsafe remote entry name "${entry.filename}" under "${currentPath}"`
          )
        }
        const relPath = relBase ? `${relBase}/${entry.filename}` : entry.filename
        if (entry.isSymlink) {
          if (includeSymlinks) results.push({ relPath, isDir: false, isSymlink: true, size: 0 })
          continue
        }
        const childPath = `${currentPath.replace(/\/$/, '')}/${entry.filename}`
        if (entry.isDirectory) {
          results.push({ relPath, isDir: true, size: 0 })
          await walk(childPath, relPath)
        } else {
          results.push({ relPath, isDir: false, size: entry.size, mtimeMs: entry.mtimeMs })
        }
      }
    }

    await walk(remotePath, '')
    return results
  }

  /**
   * Builds a remote delete path without trimming valid filename whitespace.
   * Lexical root aliases are rejected before either deletion strategy starts.
   */
  private resolveDeletePath(remotePath: string, remoteCwd?: string): string {
    const inputPath = remotePath ?? ''
    if (!inputPath || !inputPath.trim()) {
      throw new SshError('VALIDATION', `Refusing to delete remote root or empty path "${remotePath}"`)
    }
    if (inputPath.includes('\0') || remoteCwd?.includes('\0')) {
      throw new SshError('VALIDATION', 'Refusing to delete a path containing a null byte')
    }
    // A final dot component targets the current or parent directory itself.
    // `rm` refuses these operands, but an SFTP walk could otherwise delete their contents.
    const finalComponent = inputPath.split('/').filter(Boolean).at(-1)
    if (finalComponent === '.' || finalComponent === '..') {
      throw new SshError('VALIDATION', 'Refusing to delete current or parent directory aliases')
    }

    const cwd = remoteCwd && pathPosix.isAbsolute(remoteCwd)
      ? remoteCwd.replace(/\/+$/, '') || '/'
      : undefined
    const targetPath = pathPosix.isAbsolute(inputPath)
      ? inputPath
      : cwd
        ? `${cwd.replace(/\/+$/, '')}/${inputPath}`
        : inputPath
    const lexicalPath = pathPosix.isAbsolute(targetPath) ? pathPosix.resolve(targetPath) : null
    if (lexicalPath === '/' || lexicalPath === '/*') {
      throw new SshError('VALIDATION', `Refusing to delete remote root or root wildcard "${remotePath}"`)
    }
    return targetPath
  }

  /**
   * Resolves a target over SFTP for the fallback path. Inspect with lstat
   * before realpath so a final symlink remains a deletion leaf.
   */
  private async resolveDeleteTarget(
    remotePath: string,
    remoteCwd?: string
  ): Promise<{ path: string; stats: Stats | null }> {
    const targetPath = this.resolveDeletePath(remotePath, remoteCwd)
    const absoluteTargetPath = pathPosix.isAbsolute(targetPath)
      ? targetPath
      : `${(remoteCwd && pathPosix.isAbsolute(remoteCwd) ? remoteCwd : await this.realpath('.')).replace(/\/+$/, '')}/${targetPath}`
    const lexicalPath = pathPosix.resolve(absoluteTargetPath)
    if (lexicalPath === '/' || lexicalPath === '/*') {
      throw new SshError('VALIDATION', `Refusing to delete remote root or root wildcard "${remotePath}"`)
    }

    // Inspect the final entry without trailing separators. POSIX path resolution
    // would otherwise follow a final symlink when the caller supplied "link/".
    const targetEntryPath = absoluteTargetPath.replace(/\/+$/, '') || '/'
    const stats = await this.lstat(targetEntryPath).catch((error: unknown) => {
      if (error instanceof SshError && error.code === 'NOT_FOUND') return null
      throw error
    })
    if (!stats) {
      return { path: absoluteTargetPath, stats }
    }
    if (stats.isSymbolicLink()) {
      return { path: targetEntryPath, stats }
    }
    if (!stats.isDirectory()) {
      if (targetEntryPath !== absoluteTargetPath) {
        throw new SshError('VALIDATION', `Refusing to delete non-directory target with trailing slash "${remotePath}"`)
      }
      return { path: absoluteTargetPath, stats }
    }

    const canonicalPath = await this.realpath(targetEntryPath)
    if (pathPosix.resolve(canonicalPath) === '/') {
      throw new SshError('VALIDATION', `Refusing to delete remote root "${remotePath}"`)
    }
    return { path: pathPosix.resolve(canonicalPath), stats }
  }

  /**
   * Recursively deletes a remote path with a non-destructive shell root check.
   * The SFTP fallback independently validates the target before traversal.
   */
  async deleteRecursive(remotePath: string, remoteCwd?: string): Promise<void> {
    const targetPath = this.resolveDeletePath(remotePath, remoteCwd)
    const commandTarget = pathPosix.isAbsolute(targetPath) ? targetPath : `./${targetPath}`
    const encodedTarget = shellOctalEscape(commandTarget)
    const command = [
      `target=$(printf %b "${encodedTarget}"; printf .); target=\${target%.}`,
      'target_entry=$target',
      'while [ "${target_entry%/}" != "$target_entry" ]; do target_entry=${target_entry%/}; done',
      'if [ "$target_entry" != "$target" ]; then if [ -L "$target_entry" ] || [ -d "$target_entry" ]; then target=$target_entry; elif [ -e "$target_entry" ]; then exit 75; fi; fi',
      'if [ -L "$target" ]; then :; elif [ -d "$target" ]; then canonical=$(CDPATH= cd -P "$target" 2>/dev/null && pwd -P) || exit 74; [ "$canonical" != "/" ] || exit 73; fi',
      'rm -rf -- "$target"'
    ].join('; ')
    // Run the POSIX preflight explicitly; the account shell may be fish or csh.
    // The path is octal-encoded, so the outer single-quoted wrapper contains no raw user data.
    const shellCommand = `/bin/sh -c '${command}'`

    try {
      const result = await this.exec(shellCommand, { timeoutMs: 5 * 60 * 1000 })
      if (result.code === 0) {
        return
      }
      if (result.code === 73) {
        throw new SshError('VALIDATION', `Refusing to delete remote root "${remotePath}"`)
      }
      if (result.code === 75) {
        throw new SshError('VALIDATION', `Refusing to delete non-directory target with trailing slash "${remotePath}"`)
      }
    } catch (e) {
      if (e instanceof SshError && (
        e.code === 'CANCELLED' ||
        e.code === 'SSH_TIMEOUT' ||
        e.code === 'VALIDATION'
      )) {
        throw e
      }
      // Exec is unavailable or path verification failed — use the SFTP-only fallback.
    }
    await this.deleteRecursiveSftp(targetPath, remoteCwd)
  }

  /**
   * Recursively deletes a remote path purely over SFTP. Root validation is
   * repeated here so direct or future fallback callers cannot bypass it.
   */
  private async deleteRecursiveSftp(remotePath: string, remoteCwd?: string): Promise<void> {
    const target = await this.resolveDeleteTarget(remotePath, remoteCwd)
    const targetPath = target.path
    const stats = target.stats ?? await this.lstat(targetPath)
    // Never follow symlinks during recursive delete — unlink the link itself.
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      await this.unlink(targetPath)
      return
    }
    const entries = await this.readdir(targetPath)
    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..') {
        continue
      }
      if (!entry.filename || entry.filename.includes('/') || entry.filename.includes('\\')) {
        throw new SshError(
          'SFTP',
          `Refusing to delete unsafe remote entry name "${entry.filename}" under "${targetPath}"`
        )
      }
      const childPath = `${targetPath.replace(/\/+$/, '')}/${entry.filename}`
      await this.deleteRecursiveSftp(childPath, remoteCwd)
    }
    await this.rmdir(targetPath)
  }

}

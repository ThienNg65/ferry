import type { Client, SFTPWrapper, Stats } from 'ssh2'
import { SshError } from './errors'
import { withRetry } from './retry'

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
export interface ExecLinesOptions extends RemoteOptions {
  /** Called for each complete stdout line (newline-stripped). */
  onLine: (line: string) => void
  /** Called for each chunk of stderr. */
  onStderr?: (chunk: string) => void
}

const DEFAULT_TIMEOUT_MS = 30_000

/** A directory entry as reported over SFTP. */
export interface SftpEntry {
  filename: string
  longname: string
  isDirectory: boolean
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
   * Runs a remote command and resolves with its full output.
   *
   * Rejects with {@link SshError} `SSH_EXEC` on a non-zero exit code (these are
   * not retried — the command may have had side effects), `SSH_TIMEOUT` on
   * timeout, or `CANCELLED` when the signal aborts.
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

  private execOnce(command: string, opts: RemoteOptions): Promise<ExecResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise<ExecResult>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null

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
        reject(e)
      }
      const onAbort = (): void => fail(new SshError('CANCELLED', 'Command cancelled'))

      if (opts.signal?.aborted) {
        reject(new SshError('CANCELLED', 'Command cancelled'))
        return
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      this.client.exec(command, (execErr, stream) => {
        if (execErr) {
          fail(new SshError('SSH_EXEC', execErr.message, true))
          return
        }

        timer = setTimeout(() => {
          stream.destroy()
          fail(new SshError('SSH_TIMEOUT', `Command timed out after ${timeoutMs}ms`, true))
        }, timeoutMs)

        let stdout = ''
        let stderr = ''
        stream.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString()
        })
        stream.on('close', (code: number | null) => {
          if (settled) {
            return
          }
          settled = true
          cleanup()
          resolve({ stdout, stderr, code })
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
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise<number | null>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null

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
        reject(e)
      }
      const onAbort = (): void => fail(new SshError('CANCELLED', 'Stream cancelled'))

      if (opts.signal?.aborted) {
        reject(new SshError('CANCELLED', 'Stream cancelled'))
        return
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      this.client.exec(command, (execErr, stream) => {
        if (execErr) {
          fail(new SshError('SSH_EXEC', execErr.message, true))
          return
        }

        const arm = (): void => {
          if (timer) {
            clearTimeout(timer)
          }
          timer = setTimeout(() => {
            stream.destroy()
            fail(new SshError('SSH_TIMEOUT', `Stream idle for ${timeoutMs}ms`, true))
          }, timeoutMs)
        }
        arm()

        let buf = ''
        const flush = (final: boolean): void => {
          const parts = buf.split('\n')
          buf = final ? '' : parts.pop() ?? ''
          for (const raw of parts) {
            const line = raw.replace(/\r$/, '')
            if (line.length > 0) {
              opts.onLine(line)
            }
          }
        }

        stream.on('data', (chunk: Buffer) => {
          arm()
          buf += chunk.toString()
          flush(false)
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          arm()
          opts.onStderr?.(chunk.toString())
        })
        stream.on('close', (code: number | null) => {
          if (settled) {
            return
          }
          settled = true
          cleanup()
          if (buf.length > 0) {
            opts.onLine(buf.replace(/\r$/, ''))
          }
          resolve(code)
        })
      })
    })
  }

  // ── SFTP ─────────────────────────────────────────────────────────────────────

  /** Lazily opens (and caches) the SFTP subsystem for this connection. */
  sftp(): Promise<SFTPWrapper> {
    if (!this.sftpPromise) {
      this.sftpPromise = new Promise<SFTPWrapper>((resolve, reject) => {
        this.client.sftp((sftpErr, sftp) => {
          if (sftpErr) {
            this.sftpPromise = null
            reject(new SshError('SFTP', `SFTP subsystem error: ${sftpErr.message}`, true))
            return
          }
          resolve(sftp)
        })
      })
    }
    return this.sftpPromise
  }

  /** Lists a remote directory's entries. */
  async readdir(remotePath: string): Promise<SftpEntry[]> {
    const sftp = await this.sftp()
    return new Promise<SftpEntry[]>((resolve, reject) => {
      sftp.readdir(remotePath, (readErr, list) => {
        if (readErr) {
          reject(new SshError('SFTP', `Failed to list "${remotePath}": ${readErr.message}`))
          return
        }
        resolve(
          list.map((item) => ({
            filename: item.filename,
            longname: item.longname,
            isDirectory: (item.attrs.mode & 0o170000) === 0o040000,
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
    return new Promise<string>((resolve, reject) => {
      sftp.realpath(remotePath, (realErr, absPath) => {
        if (realErr) {
          reject(new SshError('SFTP', `Failed to resolve "${remotePath}": ${realErr.message}`))
          return
        }
        resolve(absPath)
      })
    })
  }

  /** Stats a remote path. */
  async stat(remotePath: string): Promise<Stats> {
    const sftp = await this.sftp()
    return new Promise<Stats>((resolve, reject) => {
      sftp.stat(remotePath, (statErr, stats) => {
        if (statErr) {
          reject(new SshError('NOT_FOUND', `"${remotePath}" not found: ${statErr.message}`))
          return
        }
        resolve(stats)
      })
    })
  }

  /** Creates a remote directory. */
  async mkdir(remotePath: string): Promise<void> {
    const sftp = await this.sftp()
    return new Promise<void>((resolve, reject) => {
      sftp.mkdir(remotePath, (mkdirErr) => {
        if (mkdirErr) {
          reject(new SshError('SFTP', `Failed to create "${remotePath}": ${mkdirErr.message}`))
          return
        }
        resolve()
      })
    })
  }

  /** Renames/moves a remote path. */
  async rename(fromPath: string, toPath: string): Promise<void> {
    const sftp = await this.sftp()
    return new Promise<void>((resolve, reject) => {
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
    return new Promise<void>((resolve, reject) => {
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
    return new Promise<void>((resolve, reject) => {
      sftp.rmdir(remotePath, (rmdirErr) => {
        if (rmdirErr) {
          reject(new SshError('SFTP', `Failed to remove directory "${remotePath}": ${rmdirErr.message}`))
          return
        }
        resolve()
      })
    })
  }

  /**
   * Recursively deletes a remote path (file or directory). SFTP has no native
   * recursive rm, so directories are listed and their contents removed first.
   */
  async deleteRecursive(remotePath: string): Promise<void> {
    const stats = await this.stat(remotePath)
    const isDir = stats.isDirectory()
    if (!isDir) {
      await this.unlink(remotePath)
      return
    }
    const entries = await this.readdir(remotePath)
    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..') {
        continue
      }
      const childPath = `${remotePath.replace(/\/$/, '')}/${entry.filename}`
      await this.deleteRecursive(childPath)
    }
    await this.rmdir(remotePath)
  }
}

import type { Readable } from 'node:stream'
import { SshError } from './errors'

/** Reject a stalled SFTP read when no data arrives within this interval. */
export const DEFAULT_SFTP_READ_IDLE_TIMEOUT_MS = 30_000

/** Maximum wall-clock duration for a remote preview read. */
export const DEFAULT_SFTP_READ_TIMEOUT_MS = 5 * 60_000

/** Full editor downloads can be larger than previews, so they get a longer deadline. */
export const DEFAULT_SFTP_EDIT_DOWNLOAD_TIMEOUT_MS = 15 * 60_000

export interface SftpReadStreamTimeouts {
  /** Maximum time without receiving a data chunk. Set to 0 to disable. */
  idleTimeoutMs?: number
  /** Maximum wall-clock duration from stream start. Set to 0 to disable. */
  timeoutMs?: number
}

export interface SftpReadStreamOptions extends SftpReadStreamTimeouts {
  remotePath: string
  /** Expected byte count from the SFTP stat response, when available. */
  expectedBytes?: number
  signal?: AbortSignal
  onData?: (chunk: Buffer, bytesRead: number) => void
}

/**
 * Monitors an SFTP readable stream and resolves only after a successful end.
 * Early close, incomplete data, cancellation, and stalled reads are rejected.
 * Consumer backpressure pauses the idle deadline but not the overall deadline.
 */
export function monitorSftpReadStream(stream: Readable, options: SftpReadStreamOptions): Promise<number> {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_SFTP_READ_IDLE_TIMEOUT_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_SFTP_READ_TIMEOUT_MS

  return new Promise<number>((resolve, reject) => {
    let settled = false
    let ended = false
    let bytesRead = 0
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let totalTimer: ReturnType<typeof setTimeout> | undefined

    const clearIdleTimer = (): void => {
      if (idleTimer === undefined) return
      clearTimeout(idleTimer)
      idleTimer = undefined
    }

    const cleanup = (): void => {
      clearIdleTimer()
      if (totalTimer !== undefined) clearTimeout(totalTimer)
      stream.removeListener('data', onData)
      stream.removeListener('end', onEnd)
      stream.removeListener('close', onClose)
      stream.removeListener('error', onError)
      stream.removeListener('pause', onPause)
      stream.removeListener('resume', onResume)
      options.signal?.removeEventListener('abort', onAbort)
    }

    const fail = (error: SshError): void => {
      if (settled) return
      settled = true
      cleanup()
      stream.destroy()
      reject(error)
    }

    const resetIdleTimer = (): void => {
      clearIdleTimer()
      if (idleTimeoutMs <= 0 || stream.isPaused()) return
      idleTimer = setTimeout(() => {
        fail(new SshError(
          'SSH_TIMEOUT',
          `SFTP read "${options.remotePath}" made no progress for ${idleTimeoutMs}ms`,
          true
        ))
      }, idleTimeoutMs)
    }

    const onData = (chunk: Buffer | string): void => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytesRead += buffer.length
      if (options.expectedBytes !== undefined && bytesRead > options.expectedBytes) {
        fail(new SshError(
          'SFTP',
          `SFTP read "${options.remotePath}" exceeded its expected size of ${options.expectedBytes} bytes`,
          true
        ))
        return
      }
      resetIdleTimer()
      try {
        options.onData?.(buffer, bytesRead)
      } catch {
        // Progress observers must not interrupt the underlying file read.
      }
    }

    const onPause = (): void => clearIdleTimer()
    const onResume = (): void => resetIdleTimer()

    const onEnd = (): void => {
      if (settled) return
      ended = true
      if (options.expectedBytes !== undefined && bytesRead !== options.expectedBytes) {
        fail(new SshError(
          'SFTP',
          `Incomplete SFTP read for "${options.remotePath}": expected ${options.expectedBytes} bytes but received ${bytesRead}`,
          true
        ))
        return
      }
      settled = true
      cleanup()
      resolve(bytesRead)
    }

    const onClose = (): void => {
      if (!ended) {
        fail(new SshError(
          'SFTP',
          `SFTP read "${options.remotePath}" closed before reaching end-of-stream after ${bytesRead} bytes`,
          true
        ))
      }
    }

    const onError = (error: Error): void => {
      fail(new SshError('SFTP', `Failed to read "${options.remotePath}": ${error.message}`, true))
    }

    const onAbort = (): void => {
      fail(new SshError('CANCELLED', `SFTP read "${options.remotePath}" was cancelled`))
    }

    stream.on('data', onData)
    stream.once('end', onEnd)
    stream.once('close', onClose)
    stream.once('error', onError)
    stream.on('pause', onPause)
    stream.on('resume', onResume)

    if (timeoutMs > 0) {
      totalTimer = setTimeout(() => {
        fail(new SshError(
          'SSH_TIMEOUT',
          `SFTP read "${options.remotePath}" exceeded its ${timeoutMs}ms deadline`,
          true
        ))
      }, timeoutMs)
    }
    resetIdleTimer()

    if (options.signal?.aborted) {
      onAbort()
    } else {
      options.signal?.addEventListener('abort', onAbort, { once: true })
    }
  })
}

import { open as openLocal, type FileHandle } from 'fs/promises'
import type { OpenMode, SFTPWrapper } from 'ssh2'
import type { TransferKind } from '../../shared/contract'
import { SshError } from '../ssh/errors'

export const SFTP_PIPELINE_CONCURRENCY = 32
export const SFTP_CHUNK_SIZE = 128 * 1024
const MIN_CHUNK_SIZE = 16 * 1024

export interface RateLimiterLike {
  readonly isLimited: boolean
  acquire(bytes: number, signal?: AbortSignal): Promise<void>
}

export interface PipelinedTransferOptions {
  sftp: SFTPWrapper
  kind: TransferKind
  localPath: string
  remotePath: string
  size: number
  offset: number
  signal: AbortSignal
  rateLimiter: RateLimiterLike
  onProgress: (bytesTransferred: number, offset: number) => void
  onContigOffset?: (contigOffset: number) => void
  concurrency?: number
  chunkSize?: number
}

interface SftpInternalLimits {
  _maxWriteLen?: number
  _maxReadLen?: number
}

function sftpOpen(sftp: SFTPWrapper, remotePath: string, flags: OpenMode): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.open(remotePath, flags, 0o666, (err, handle) => {
      if (err) {
        reject(err)
      } else {
        resolve(handle)
      }
    })
  })
}

function sftpClose(sftp: SFTPWrapper, handle: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.close(handle, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

function sftpWrite(sftp: SFTPWrapper, handle: Buffer, buf: Buffer, len: number, position: number): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.write(handle, buf, 0, len, position, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

function sftpRead(
  sftp: SFTPWrapper,
  handle: Buffer,
  buf: Buffer,
  off: number,
  len: number,
  position: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    sftp.read(handle, buf, off, len, position, (err, bytesRead) => {
      if (err) {
        reject(err)
      } else {
        resolve(bytesRead)
      }
    })
  })
}

function resolveChunkSize(sftp: SFTPWrapper, kind: TransferKind, requested: number): number {
  const internal = sftp as SFTPWrapper & SftpInternalLimits
  const serverMax = kind === 'upload' ? internal._maxWriteLen : internal._maxReadLen
  if (typeof serverMax === 'number' && serverMax > 0) {
    return Math.max(MIN_CHUNK_SIZE, Math.min(requested, serverMax))
  }
  return requested
}

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new SshError('CANCELLED', 'Transfer cancelled')
  }
}

/**
 * Transfers a single file between local disk and remote SFTP using pipelined
 * concurrent `sftp.write` / `sftp.read` requests so throughput scales with
 * bandwidth rather than stalling 1 RTT per 64 KB chunk.
 */
export async function transferPipelined(opts: PipelinedTransferOptions): Promise<void> {
  const { sftp, kind, localPath, remotePath, size, offset, signal, rateLimiter, onProgress, onContigOffset } = opts
  checkAborted(signal)

  if (size > 0 && offset >= size) {
    onContigOffset?.(size)
    onProgress(size, offset)
    return
  }

  const chunkSize = resolveChunkSize(sftp, kind, opts.chunkSize ?? SFTP_CHUNK_SIZE)
  const maxWorkers = Math.max(1, opts.concurrency ?? SFTP_PIPELINE_CONCURRENCY)
  const totalRemaining = Math.max(0, size - offset)
  const workerCount = size === 0 ? 1 : Math.min(maxWorkers, Math.max(1, Math.ceil(totalRemaining / chunkSize)))

  let localHandle: FileHandle | null = null
  let remoteHandle: Buffer | null = null

  try {
    const localFlags = kind === 'upload' ? 'r' : offset > 0 ? 'r+' : 'w'
    const remoteFlags: OpenMode = kind === 'upload' ? (offset > 0 ? 'r+' : 'w') : 'r'

    if (kind === 'upload') {
      localHandle = await openLocal(localPath, localFlags)
      checkAborted(signal)
      remoteHandle = await sftpOpen(sftp, remotePath, remoteFlags)
    } else {
      remoteHandle = await sftpOpen(sftp, remotePath, remoteFlags)
      checkAborted(signal)
      localHandle = await openLocal(localPath, localFlags, 0o600)
      if (offset > 0) {
        await localHandle.truncate(offset)
      }
    }
    checkAborted(signal)

    if (size === 0) {
      onContigOffset?.(0)
      onProgress(0, 0)
      return
    }

    let nextPos = offset
    let bytesMoved = offset
    let contigEnd = offset
    const completedRanges = new Map<number, number>()
    let stopped = false

    const markRangeComplete = (start: number, end: number): void => {
      if (end <= contigEnd) return
      completedRanges.set(start, end)
      while (true) {
        const nextEnd = completedRanges.get(contigEnd)
        if (nextEnd === undefined) break
        completedRanges.delete(contigEnd)
        contigEnd = nextEnd
      }
      onContigOffset?.(contigEnd)
    }

    let onAbortHandler: (() => void) | null = null
    const abortPromise = new Promise<never>((_, reject) => {
      onAbortHandler = () => {
        stopped = true
        reject(new SshError('CANCELLED', 'Transfer cancelled'))
      }
      signal.addEventListener('abort', onAbortHandler, { once: true })
    })

    const runUploadWorker = async (): Promise<void> => {
      const buf = Buffer.allocUnsafe(chunkSize)
      const lh = localHandle!
      const rh = remoteHandle!
      while (!stopped) {
        const pos = nextPos
        if (pos >= size) break
        const len = Math.min(chunkSize, size - pos)
        nextPos += len

        let filled = 0
        while (filled < len && !stopped && !signal.aborted) {
          const { bytesRead } = await lh.read(buf, filled, len - filled, pos + filled)
          if (bytesRead === 0) {
            throw new SshError('UNKNOWN', `Unexpected EOF reading "${localPath}" at offset ${pos + filled}`)
          }
          filled += bytesRead
        }
        if (stopped || signal.aborted) break

        if (rateLimiter.isLimited) {
          await rateLimiter.acquire(filled, signal)
        }
        if (stopped || signal.aborted) break

        await sftpWrite(sftp, rh, buf, filled, pos)
        if (stopped || signal.aborted) break

        bytesMoved += filled
        markRangeComplete(pos, pos + filled)
        onProgress(bytesMoved, offset)
      }
    }

    const runDownloadWorker = async (): Promise<void> => {
      const buf = Buffer.allocUnsafe(chunkSize)
      const lh = localHandle!
      const rh = remoteHandle!
      while (!stopped) {
        const pos = nextPos
        if (pos >= size) break
        const len = Math.min(chunkSize, size - pos)
        nextPos += len

        let filled = 0
        while (filled < len && !stopped && !signal.aborted) {
          const bytesRead = await sftpRead(sftp, rh, buf, filled, len - filled, pos + filled)
          if (bytesRead === 0) {
            throw new SshError('SFTP', `Unexpected EOF reading remote "${remotePath}" at offset ${pos + filled}`)
          }
          filled += bytesRead
        }
        if (stopped || signal.aborted) break

        if (rateLimiter.isLimited) {
          await rateLimiter.acquire(filled, signal)
        }
        if (stopped || signal.aborted) break

        let written = 0
        while (written < filled && !stopped && !signal.aborted) {
          const res = await lh.write(buf, written, filled - written, pos + written)
          written += res.bytesWritten
        }
        if (stopped || signal.aborted) break

        bytesMoved += filled
        markRangeComplete(pos, pos + filled)
        onProgress(bytesMoved, offset)
      }
    }

    const workersPromise = Promise.all(
      Array.from({ length: workerCount }, () => (kind === 'upload' ? runUploadWorker() : runDownloadWorker()))
    ).then(() => undefined)
    // Prevent unhandled rejection when abortPromise wins the race while workers unwind.
    workersPromise.catch(() => undefined)

    try {
      await Promise.race([workersPromise, abortPromise])
    } finally {
      stopped = true
      if (onAbortHandler) {
        signal.removeEventListener('abort', onAbortHandler)
      }
    }
  } finally {
    await Promise.all([
      remoteHandle ? sftpClose(sftp, remoteHandle).catch(() => undefined) : Promise.resolve(),
      localHandle ? localHandle.close().catch(() => undefined) : Promise.resolve()
    ])
  }
}

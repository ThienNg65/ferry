import { open as openLocal, type FileHandle } from 'fs/promises'
import type { OpenMode, SFTPWrapper } from 'ssh2'
import type { TransferKind } from '../../shared/contract'
import { SshError } from '../ssh/errors'

export const SFTP_PIPELINE_CONCURRENCY = 32
export const SFTP_CHUNK_SIZE = 128 * 1024
const MIN_CHUNK_SIZE = 16 * 1024
const CLOSE_TIMEOUT_MS = 2_000

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
  /** Uses exclusive create and records ownership only after the destination opens. */
  onDestinationCreated?: () => void
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
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve()
      }
    }, CLOSE_TIMEOUT_MS)
    timer.unref?.()
    sftp.close(handle, () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
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
  let workersPromiseRef: Promise<unknown> | null = null

  try {
    const writeFlags: OpenMode = opts.onDestinationCreated ? 'wx' : offset > 0 ? 'r+' : 'w'
    const localFlags = kind === 'upload' ? 'r' : writeFlags
    const remoteFlags = kind === 'download' ? 'r' : writeFlags

    if (kind === 'upload') {
      localHandle = await openLocal(localPath, localFlags)
      checkAborted(signal)
      remoteHandle = await sftpOpen(sftp, remotePath, remoteFlags)
      opts.onDestinationCreated?.()
    } else {
      remoteHandle = await sftpOpen(sftp, remotePath, remoteFlags)
      checkAborted(signal)
      localHandle = await openLocal(localPath, localFlags, 0o600)
      opts.onDestinationCreated?.()
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
    const workerAbort = new AbortController()

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

    const runWorker = async (): Promise<void> => {
      const buf = Buffer.allocUnsafe(chunkSize)
      const lh = localHandle!
      const rh = remoteHandle!
      while (!stopped) {
        const pos = nextPos
        if (pos >= size) break
        const len = Math.min(chunkSize, size - pos)
        nextPos += len

        let transferred = 0
        if (kind === 'upload') {
          while (transferred < len && !stopped && !signal.aborted) {
            const { bytesRead } = await lh.read(buf, transferred, len - transferred, pos + transferred)
            if (bytesRead === 0) {
              throw new SshError('UNKNOWN', `Unexpected EOF reading "${localPath}" at offset ${pos + transferred}`)
            }
            transferred += bytesRead
          }
          if (stopped || signal.aborted) break

          if (rateLimiter.isLimited) {
            await rateLimiter.acquire(transferred, workerAbort.signal)
          }
          if (stopped || signal.aborted) break

          await sftpWrite(sftp, rh, buf, transferred, pos)
        } else {
          while (transferred < len && !stopped && !signal.aborted) {
            const bytesRead = await sftpRead(sftp, rh, buf, transferred, len - transferred, pos + transferred)
            if (bytesRead === 0) {
              throw new SshError('SFTP', `Unexpected EOF reading remote "${remotePath}" at offset ${pos + transferred}`)
            }
            transferred += bytesRead
          }
          if (stopped || signal.aborted) break

          if (rateLimiter.isLimited) {
            await rateLimiter.acquire(transferred, workerAbort.signal)
          }
          if (stopped || signal.aborted) break

          let written = 0
          while (written < transferred && !stopped && !signal.aborted) {
            const res = await lh.write(buf, written, transferred - written, pos + written)
            written += res.bytesWritten
          }
        }
        if (stopped || signal.aborted) break

        bytesMoved += transferred
        markRangeComplete(pos, pos + transferred)
        onProgress(bytesMoved, offset)
      }
    }

    const workers = Array.from({ length: workerCount }, () => runWorker())
    const workersPromise = Promise.all(workers).then(() => undefined)
    workersPromiseRef = Promise.allSettled(workers)
    // Prevent unhandled rejection when abortPromise wins the race while workers unwind.
    workersPromise.catch(() => undefined)

    try {
      await Promise.race([workersPromise, abortPromise])
    } finally {
      stopped = true
      workerAbort.abort()
      if (onAbortHandler) {
        signal.removeEventListener('abort', onAbortHandler)
      }
    }
  } finally {
    // Close the remote handle first so any stuck SFTP read/write unwinds, then wait for all
    // workers to settle before closing the local FileHandle (closing a Node FileHandle with
    // in-flight read/write rejects with EBUSY and leaks the FD on Windows).
    if (remoteHandle) {
      await sftpClose(sftp, remoteHandle).catch(() => undefined)
    }
    if (workersPromiseRef) {
      await workersPromiseRef
    }
    if (localHandle) {
      await localHandle.close().catch(() => undefined)
    }
  }
}

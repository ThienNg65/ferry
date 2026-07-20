import { randomUUID } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { stat } from 'fs/promises'
import { Transform } from 'stream'
import * as path from 'path'
import { BrowserWindow } from 'electron'
import { SessionManager } from '../ssh/SessionManager'
import type { RemoteShell } from '../ssh/RemoteShell'
import { SshError } from '../ssh/errors'
import { listRecursive, mkdirRecursive as mkdirLocalRecursive } from '../fs/LocalFsService'
import { runConcurrent } from '../util/concurrency'
import { EVENT_CHANNELS, type TransferEvent, type TransferKind } from '../../shared/contract'

/** Exported so a terminal-event listener (see `onTerminalEvent`) gets full job context, not just the wire-format `TransferEvent`. */
export interface TransferJob {
  transferId: string
  sessionId: string
  kind: TransferKind
  localPath: string
  remotePath: string
  controller: AbortController
  /** True when this job moves a whole directory tree rather than a single file. */
  isTree: boolean
  /** Epoch ms when queued — close enough to "started" for History's purposes; queueing delay is usually negligible. */
  queuedAt: number
}

/**
 * Joins a `/`-separated relative path onto a local root using the OS-native separator.
 * Defense in depth against a malicious/compromised server supplying a `relPath` that resolves
 * outside `root` (the primary guard lives in `RemoteShell.readdirRecursive`, which already
 * rejects unsafe entry names before a `relPath` like this is ever built).
 */
function joinLocal(root: string, relPath: string): string {
  const resolvedRoot = path.resolve(root)
  const joined = path.resolve(root, ...relPath.split('/'))
  // `path.resolve` of a drive/filesystem root (e.g. "C:\" or "/") already ends in a separator —
  // appending another would make the prefix check below reject every legitimate path under it.
  const boundary = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep
  if (joined !== resolvedRoot && !joined.startsWith(boundary)) {
    throw new SshError('SFTP', `Refusing to resolve unsafe relative path "${relPath}" outside "${root}"`)
  }
  return path.join(root, ...relPath.split('/'))
}

/** Joins a `/`-separated relative path onto a remote (POSIX) root. */
function joinRemote(root: string, relPath: string): string {
  return `${root.replace(/\/$/, '')}/${relPath}`
}

/** Transfers running at once — the rest wait in the queue. */
const MAX_CONCURRENT = 3
/** Files (or mkdir calls) running at once within a single directory-tree job. Over a high-latency link, moving one file at a time makes wall time dominated by per-file round trips rather than bandwidth — see the roadmap's Phase 3 performance review. */
const TREE_ITEM_CONCURRENCY = 4
/** Minimum gap between progress broadcasts for a single transfer. */
const PROGRESS_THROTTLE_MS = 200

/**
 * Global rate limiter shared by every concurrent transfer, so a configured
 * cap is an app-wide ceiling (matching WinSCP's single "limit bandwidth"
 * setting) rather than a per-file allowance that multiplies with concurrency.
 *
 * Implemented as a virtual schedule rather than a capped token bucket: each
 * `acquire()` reserves the next available time slot proportional to its byte
 * count (synchronously, before awaiting anything, so concurrent callers never
 * race on the reservation) and resolves once that slot arrives. A request for
 * more bytes than one second's worth of budget (e.g. a stream chunk bigger
 * than a very low configured limit) just takes proportionally longer instead
 * of deadlocking against a hard bucket-capacity cap.
 */
export class RateLimiter {
  private limitBytesPerSec: number | null = null
  private nextAvailableAt = 0

  setLimitKBps(limitKBps: number | null): void {
    this.limitBytesPerSec = limitKBps && limitKBps > 0 ? limitKBps * 1024 : null
    this.nextAvailableAt = Date.now()
  }

  /** Resolves once `bytes` worth of budget is available. Resolves immediately when unlimited. */
  async acquire(bytes: number): Promise<void> {
    const limit = this.limitBytesPerSec
    if (!limit) {
      return
    }
    const now = Date.now()
    const slotStart = Math.max(now, this.nextAvailableAt)
    this.nextAvailableAt = slotStart + (bytes / limit) * 1000
    const waitMs = slotStart - now
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
}

/** A pass-through `Transform` that delays each chunk until `limiter` grants it enough budget — the actual throttling hook in the pipe chain. */
function createThrottleTransform(limiter: RateLimiter): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      limiter
        .acquire(chunk.length)
        .then(() => callback(null, chunk))
        .catch((e: Error) => callback(e))
    }
  })
}

/**
 * TransferQueue — bounded-concurrency upload/download queue.
 *
 * Uses SFTP read/write streams (not fastGet/fastPut) so cancellation is a
 * clean `stream.destroy()` and progress is derived from actual bytes moved,
 * not a coarse step callback. Progress events are throttled here — the
 * renderer must never see a flood of one-event-per-chunk updates.
 */
export class TransferQueue {
  private static instance: TransferQueue | null = null
  private readonly pending: TransferJob[] = []
  private readonly active = new Map<string, TransferJob>()
  private readonly rateLimiter = new RateLimiter()
  /** Additive side-channel for terminal (done/error/cancelled) events — currently just HistoryRecorder. Never allowed to affect a transfer's own outcome (see `notifyTerminal`). */
  private readonly terminalListeners: Array<(job: TransferJob, evt: TransferEvent) => void> = []

  static getInstance(): TransferQueue {
    if (TransferQueue.instance === null) {
      TransferQueue.instance = new TransferQueue()
    }
    return TransferQueue.instance
  }

  /** Subscribes to every transfer's terminal event (done/error/cancelled) — additive to the existing `webContents.send` broadcast, not a replacement for it. */
  onTerminalEvent(listener: (job: TransferJob, evt: TransferEvent) => void): void {
    this.terminalListeners.push(listener)
  }

  private notifyTerminal(job: TransferJob, evt: TransferEvent): void {
    for (const listener of this.terminalListeners) {
      try {
        listener(job, evt)
      } catch {
        // A listener's own failure (e.g. HistoryStore disk write) must never
        // surface as a transfer failure — this channel is purely additive.
      }
    }
  }

  /** Sets (or clears, with `null`) the app-wide transfer rate cap — applies to every transfer already in flight, not just new ones. */
  setBandwidthLimitKBps(limitKBps: number | null): void {
    this.rateLimiter.setLimitKBps(limitKBps)
  }

  /** Queues a single-file transfer and returns its id immediately; work happens in the background. */
  enqueue(sessionId: string, kind: TransferKind, localPath: string, remotePath: string): string {
    return this.push(sessionId, kind, localPath, remotePath, false)
  }

  /**
   * Queues a whole-directory transfer (recursive upload/download) and returns its id
   * immediately. Progress/state for the entire tree is reported under this single id,
   * aggregated across every file it contains — the renderer sees one queue row.
   */
  enqueueTree(sessionId: string, kind: TransferKind, localPath: string, remotePath: string): string {
    return this.push(sessionId, kind, localPath, remotePath, true)
  }

  private push(sessionId: string, kind: TransferKind, localPath: string, remotePath: string, isTree: boolean): string {
    const transferId = randomUUID()
    const job: TransferJob = {
      transferId,
      sessionId,
      kind,
      localPath,
      remotePath,
      controller: new AbortController(),
      isTree,
      queuedAt: Date.now()
    }
    this.pending.push(job)
    this.broadcast({ transferId, kind, state: 'queued' })
    this.pump()
    return transferId
  }

  /** Cancels a transfer, whether still queued or actively streaming. */
  cancel(transferId: string): void {
    const activeJob = this.active.get(transferId)
    if (activeJob) {
      activeJob.controller.abort()
      return
    }
    const idx = this.pending.findIndex((j) => j.transferId === transferId)
    if (idx !== -1) {
      const [job] = this.pending.splice(idx, 1)
      const evt: TransferEvent = { transferId: job.transferId, kind: job.kind, state: 'cancelled' }
      this.broadcast(evt)
      this.notifyTerminal(job, evt)
    }
  }

  private pump(): void {
    while (this.active.size < MAX_CONCURRENT && this.pending.length > 0) {
      const job = this.pending.shift()
      if (!job) {
        break
      }
      this.active.set(job.transferId, job)
      void this.run(job).finally(() => {
        this.active.delete(job.transferId)
        this.pump()
      })
    }
  }

  private async run(job: TransferJob): Promise<void> {
    if (job.isTree) {
      await this.runTree(job)
      return
    }

    const { transferId, kind } = job
    this.broadcast({ transferId, kind, state: 'started' })

    try {
      const shell = SessionManager.getInstance().shell(job.sessionId)
      const totalBytes =
        kind === 'upload' ? (await stat(job.localPath)).size : (await shell.stat(job.remotePath)).size

      const startedAt = Date.now()
      let lastEmit = 0
      const emitProgress = (bytesTransferred: number): void => {
        const now = Date.now()
        if (now - lastEmit < PROGRESS_THROTTLE_MS && bytesTransferred < totalBytes) {
          return
        }
        lastEmit = now
        const elapsedSec = (now - startedAt) / 1000
        const bytesPerSec = elapsedSec > 0 ? Math.round(bytesTransferred / elapsedSec) : 0
        const etaMs = bytesPerSec > 0 ? Math.round(((totalBytes - bytesTransferred) / bytesPerSec) * 1000) : 0
        this.broadcast({ transferId, kind, state: 'progress', bytesTransferred, totalBytes, bytesPerSec, etaMs })
      }

      await this.runFile({
        shell,
        kind,
        localPath: job.localPath,
        remotePath: job.remotePath,
        signal: job.controller.signal,
        onProgress: emitProgress
      })

      const doneEvt: TransferEvent = { transferId, kind, state: 'done', bytesTransferred: totalBytes, totalBytes }
      this.broadcast(doneEvt)
      this.notifyTerminal(job, doneEvt)
    } catch (e) {
      const cancelled = e instanceof SshError && e.code === 'CANCELLED'
      const message = e instanceof Error ? e.message : String(e)
      const evt: TransferEvent = { transferId, kind, state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : message }
      this.broadcast(evt)
      this.notifyTerminal(job, evt)
    }
  }

  /**
   * Streams a single file between local disk and the remote SFTP subsystem.
   * Shared by both a solo file job and each file inside a directory-tree job —
   * callers own progress reporting/broadcasting via `onProgress`.
   */
  private async runFile(opts: {
    shell: RemoteShell
    kind: TransferKind
    localPath: string
    remotePath: string
    signal: AbortSignal
    onProgress: (bytesTransferred: number) => void
  }): Promise<void> {
    const sftp = await opts.shell.sftp()
    await new Promise<void>((resolve, reject) => {
      const readStream =
        opts.kind === 'upload' ? createReadStream(opts.localPath) : sftp.createReadStream(opts.remotePath)
      const writeStream =
        opts.kind === 'upload' ? sftp.createWriteStream(opts.remotePath) : createWriteStream(opts.localPath)

      const throttle = createThrottleTransform(this.rateLimiter)

      let settled = false
      const finish = (err?: Error): void => {
        if (settled) {
          return
        }
        settled = true
        opts.signal.removeEventListener('abort', onAbort)
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      }
      const onAbort = (): void => {
        readStream.destroy()
        throttle.destroy()
        writeStream.destroy()
        finish(new SshError('CANCELLED', 'Transfer cancelled'))
      }
      if (opts.signal.aborted) {
        onAbort()
        return
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })

      let bytesMoved = 0
      readStream.on('data', (chunk: Buffer | string) => {
        bytesMoved += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
        opts.onProgress(bytesMoved)
      })
      readStream.on('error', (e: Error) => finish(e))
      throttle.on('error', (e: Error) => finish(e))
      writeStream.on('error', (e: Error) => finish(e))
      writeStream.on('close', () => finish())
      readStream.pipe(throttle).pipe(writeStream)
    })
  }

  /**
   * Walks a directory tree (local for uploads, remote for downloads), recreates its
   * directory structure at the destination, then transfers its files — up to
   * {@link TREE_ITEM_CONCURRENCY} at once, not one at a time, since a serial walk
   * makes wall time dominated by per-file round-trip latency rather than bandwidth
   * on anything but a very low-latency link — aggregating byte progress across the
   * whole tree under this job's single transferId.
   */
  private async runTree(job: TransferJob): Promise<void> {
    const { transferId, kind } = job
    this.broadcast({ transferId, kind, state: 'started' })

    try {
      const shell = SessionManager.getInstance().shell(job.sessionId)
      const tree = kind === 'upload' ? await listRecursive(job.localPath) : await shell.readdirRecursive(job.remotePath)

      if (kind === 'upload') {
        await shell.mkdirRecursive(job.remotePath)
      } else {
        await mkdirLocalRecursive(job.localPath)
      }

      const dirs = tree.filter((e) => e.isDir)
      const files = tree.filter((e) => !e.isDir)

      await runConcurrent(dirs, TREE_ITEM_CONCURRENCY, async (dir) => {
        if (job.controller.signal.aborted) {
          throw new SshError('CANCELLED', 'Transfer cancelled')
        }
        if (kind === 'upload') {
          await shell.mkdirRecursive(joinRemote(job.remotePath, dir.relPath))
        } else {
          await mkdirLocalRecursive(joinLocal(job.localPath, dir.relPath))
        }
      })

      const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
      let doneBytes = 0
      // Multiple files stream concurrently now, so "bytes so far" is doneBytes
      // (fully-finished files) plus whatever each still-in-flight file has moved.
      const inFlightBytes = new Map<number, number>()
      const startedAt = Date.now()
      let lastEmit = 0
      const emitProgress = (): void => {
        const now = Date.now()
        let inFlightTotal = 0
        for (const bytes of inFlightBytes.values()) {
          inFlightTotal += bytes
        }
        const bytesTransferred = doneBytes + inFlightTotal
        const isFinal = bytesTransferred >= totalBytes
        if (now - lastEmit < PROGRESS_THROTTLE_MS && !isFinal) {
          return
        }
        lastEmit = now
        const elapsedSec = (now - startedAt) / 1000
        const bytesPerSec = elapsedSec > 0 ? Math.round(bytesTransferred / elapsedSec) : 0
        const etaMs = bytesPerSec > 0 ? Math.round(((totalBytes - bytesTransferred) / bytesPerSec) * 1000) : 0
        this.broadcast({ transferId, kind, state: 'progress', bytesTransferred, totalBytes, bytesPerSec, etaMs })
      }

      await runConcurrent(
        files.map((file, index) => ({ file, index })),
        TREE_ITEM_CONCURRENCY,
        async ({ file, index }) => {
          if (job.controller.signal.aborted) {
            throw new SshError('CANCELLED', 'Transfer cancelled')
          }
          inFlightBytes.set(index, 0)
          await this.runFile({
            shell,
            kind,
            localPath: joinLocal(job.localPath, file.relPath),
            remotePath: joinRemote(job.remotePath, file.relPath),
            signal: job.controller.signal,
            onProgress: (bytesTransferred) => {
              inFlightBytes.set(index, bytesTransferred)
              emitProgress()
            }
          })
          inFlightBytes.delete(index)
          doneBytes += file.size
          emitProgress()
        }
      )

      const doneEvt: TransferEvent = { transferId, kind, state: 'done', bytesTransferred: totalBytes, totalBytes }
      this.broadcast(doneEvt)
      this.notifyTerminal(job, doneEvt)
    } catch (e) {
      const cancelled = (e instanceof SshError && e.code === 'CANCELLED') || job.controller.signal.aborted
      const message = e instanceof Error ? e.message : String(e)
      const evt: TransferEvent = { transferId, kind, state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : message }
      this.broadcast(evt)
      this.notifyTerminal(job, evt)
    }
  }

  private broadcast(evt: TransferEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.transferEvent, evt)
      }
    }
  }
}

import { randomUUID } from 'crypto'
import { lstat, rename, stat, unlink, utimes } from 'fs/promises'
import * as path from 'path'
import { host } from '../host/host'
import { SessionManager } from '../ssh/SessionManager'
import type { RemoteShell } from '../ssh/RemoteShell'
import { SshError } from '../ssh/errors'
import { commitRemoteFile } from '../fs/RemoteFsService'
import { cleanupStagedDropPath, listRecursive, mkdirRecursive as mkdirLocalRecursive } from '../fs/LocalFsService'
import { assertSafeLocalDownloadHandle, assertSafeLocalDownloadPath, ensureSafeLocalDownloadDirectory, prepareSafeLocalDownloadRoot } from './safeLocalDownload'
import { runConcurrent } from '../util/concurrency'
import { transferPipelined } from './sftpPipeline'
import { EVENT_CHANNELS, type TransferEvent, type TransferKind, type TransferState } from '../../shared/contract'

/** Exported so a terminal-event listener (see `onTerminalEvent`) gets full job context, not just the wire-format `TransferEvent`. */
export interface TransferJob {
  transferId: string
  sessionId: string
  connectionIdentity?: string
  retryError?: string
  restartRequired?: boolean
  reconnectRequired?: boolean
  kind: TransferKind
  localPath: string
  remotePath: string
  /** Canonical root for a tree download; retained to guard resume and cleanup paths. */
  localDownloadRoot?: string
  controller: AbortController
  /** True when this job moves a whole directory tree rather than a single file. */
  isTree: boolean
  createParents?: boolean
  /** Epoch ms when queued — close enough to "started" for History's purposes; queueing delay is usually negligible. */
  queuedAt: number
  resume?: boolean
  sourceStamp?: string
  /** Exclusively created temporary files and their contiguous verified byte offsets. */
  staging?: Map<string, { path: string; offset: number }>
  /** Completed relative paths for resumable directory-tree transfers. */
  completedFiles?: Set<string>
  /** Per-file source stamps (`size:mtime`) for validating `.part` resume in tree transfers. */
  sourceStamps?: Map<string, string>
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
const MAX_RETRYABLE = 200
const PAUSE_REASON = 'pause'

class TransferRestartRequired extends SshError {
  constructor(message: string) {
    super('VALIDATION', message)
  }
}
/** Maximum virtual bandwidth credit to absorb timer scheduling jitter without unbounded catch-up bursts. */
const MAX_BANDWIDTH_CATCH_UP_MS = 20

/**
 * Global FIFO bandwidth scheduler. Only granted work consumes virtual bandwidth.
 * Pending reservations can be cancelled without leaving holes in the schedule.
 */
export class RateLimiter {
  private limitBytesPerSec: number | null = null
  private nextAvailableAt = 0
  private pending: Array<{
    bytes: number
    signal?: AbortSignal
    resolve: () => void
    reject: (error: SshError) => void
    onAbort: () => void
  }> = []
  private timer: ReturnType<typeof setTimeout> | null = null

  get isLimited(): boolean {
    return this.limitBytesPerSec !== null
  }

  setLimitKBps(limitKBps: number | null): void {
    this.limitBytesPerSec = limitKBps && limitKBps > 0 ? limitKBps * 1024 : null
    this.nextAvailableAt = Date.now()
    this.schedule()
  }

  reset(): void {
    this.nextAvailableAt = Date.now()
  }

  /** Only granted requests reserve time; cancellation removes queued work immediately. */
  acquire(bytes: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new SshError('CANCELLED', 'Transfer cancelled'))
    }
    if (!this.limitBytesPerSec) {
      return Promise.resolve()
    }
    // Start a new burst at wall time after an actual idle period; do not bank unlimited bandwidth.
    if (this.pending.length === 0 && this.nextAvailableAt < Date.now()) {
      this.nextAvailableAt = Date.now()
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        bytes,
        signal,
        resolve,
        reject,
        onAbort: (): void => {
          const index = this.pending.indexOf(entry)
          if (index === -1) return
          this.pending.splice(index, 1)
          signal?.removeEventListener('abort', entry.onAbort)
          reject(new SshError('CANCELLED', 'Transfer cancelled'))
          this.schedule()
        }
      }
      this.pending.push(entry)
      signal?.addEventListener('abort', entry.onAbort, { once: true })
      this.schedule()
    })
  }

  private schedule(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    // Clamp once per scheduling pass, not once per grant. Preserving fractional
    // deadlines within the loop avoids losing sub-ms credit after late timers.
    this.nextAvailableAt = Math.max(this.nextAvailableAt, Date.now() - MAX_BANDWIDTH_CATCH_UP_MS)
    while (this.pending.length > 0) {
      const limit = this.limitBytesPerSec
      const now = Date.now()
      const waitMs = limit ? Math.max(0, this.nextAvailableAt - now) : 0
      if (waitMs > 0) {
        this.timer = setTimeout(() => {
          this.timer = null
          this.schedule()
        }, waitMs)
        return
      }
      const entry = this.pending.shift()!
      entry.signal?.removeEventListener('abort', entry.onAbort)
      if (limit) {
        this.nextAvailableAt += (entry.bytes / limit) * 1000
      }
      entry.resolve()
    }
  }
}

/**
 * TransferQueue — bounded-concurrency upload/download queue.
 *
 * Uses pipelined SFTP open/read/write/close (`transferPipelined`) rather than
 * `sftp.createWriteStream`/`fastPut` so throughput saturates WAN bandwidth while
 * preserving cancellation, contiguous-offset resume, rate limiting, and real byte progress.
 */
export class TransferQueue {
  private static instance: TransferQueue | null = null
  private readonly pending: TransferJob[] = []
  private readonly active = new Map<string, TransferJob>()
  private readonly retryable = new Map<string, TransferJob>()
  private readonly paused = new Set<string>()
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

  /** Recompute retry availability after a connection opens or closes. */
  static refreshRetryConnections(): void {
    const queue = TransferQueue.instance
    if (!queue) return
    const sessions = SessionManager.getInstance()
    for (const job of queue.retryable.values()) {
      const reconnectRequired = sessions.connectedTransferSession(job.sessionId, job.connectionIdentity) === null
      if (job.reconnectRequired === reconnectRequired) continue
      job.reconnectRequired = reconnectRequired
      queue.broadcast(queue.retryEvent(job))
    }
  }

  /** Sets (or clears, with `null`) the app-wide transfer rate cap — applies to every transfer already in flight, not just new ones. */
  setBandwidthLimitKBps(limitKBps: number | null): void {
    this.rateLimiter.setLimitKBps(limitKBps)
  }

  /** Queues a single-file transfer and returns its id immediately; work happens in the background. */
  enqueue(sessionId: string, kind: TransferKind, localPath: string, remotePath: string, createParents?: boolean): string {
    return this.push(sessionId, kind, localPath, remotePath, false, createParents)
  }

  /**
   * Queues a whole-directory transfer (recursive upload/download) and returns its id
   * immediately. Progress/state for the entire tree is reported under this single id,
   * aggregated across every file it contains — the renderer sees one queue row.
   */
  enqueueTree(sessionId: string, kind: TransferKind, localPath: string, remotePath: string): string {
    return this.push(sessionId, kind, localPath, remotePath, true)
  }

  private push(sessionId: string, kind: TransferKind, localPath: string, remotePath: string, isTree: boolean, createParents?: boolean): string {
    const transferId = randomUUID()
    const job: TransferJob = {
      transferId,
      sessionId,
      connectionIdentity: SessionManager.getInstance().transferIdentity(sessionId),
      kind,
      localPath,
      remotePath,
      controller: new AbortController(),
      isTree,
      createParents,
      queuedAt: Date.now(),
      resume: false
    }
    this.pending.push(job)
    this.broadcast(this.jobEvent(job, 'queued'))
    this.pump()
    return transferId
  }

  retry(transferId: string, restart = false): void {
    const old = this.retryable.get(transferId)
    if (!old) {
      throw new SshError('NOT_FOUND', 'Transfer cannot be retried')
    }
    const sessionId = SessionManager.getInstance().connectedTransferSession(old.sessionId, old.connectionIdentity)
    if (!sessionId) {
      throw new SshError('SSH_CONNECT', 'Reconnect to the original server and account to continue this transfer.')
    }
    if (old.restartRequired && !restart) {
      throw new TransferRestartRequired(old.retryError ?? 'The transfer must be restarted.')
    }
    this.retryable.delete(transferId)
    this.paused.delete(transferId)
    if (this.active.size === 0) {
      this.rateLimiter.reset()
    }
    const job: TransferJob = {
      ...old,
      sessionId,
      controller: new AbortController(),
      queuedAt: Date.now(),
      resume: !restart,
      retryError: undefined,
      restartRequired: undefined,
      reconnectRequired: undefined
    }
    if (restart) {
      this.cleanupStaging(job)
      job.localDownloadRoot = undefined
      job.sourceStamp = undefined
      job.completedFiles = undefined
      job.sourceStamps = undefined
    }
    this.pending.push(job)
    this.broadcast(this.jobEvent(job, 'queued', restart ? { bytesTransferred: 0, filesDone: 0 } : undefined))
    this.pump()
  }

  private retryEvent(job: TransferJob): TransferEvent {
    return this.jobEvent(job, this.paused.has(job.transferId) ? 'paused' : 'error', {
      error: job.retryError,
      restartRequired: job.restartRequired,
      reconnectRequired: job.reconnectRequired
    })
  }

  private rememberRetryable(job: TransferJob): void {
    this.retryable.delete(job.transferId)
    job.reconnectRequired =
      SessionManager.getInstance().connectedTransferSession(job.sessionId, job.connectionIdentity) === null
    this.retryable.set(job.transferId, job)
    if (this.retryable.size > MAX_RETRYABLE) {
      const oldestId = this.retryable.keys().next().value as string
      const oldestJob = this.retryable.get(oldestId)!
      this.retryable.delete(oldestId)
      this.paused.delete(oldestId)
      this.cleanupJobArtifacts(oldestJob)
    }
  }

  pause(transferId: string): void {
    const activeJob = this.active.get(transferId)
    if (activeJob) {
      activeJob.controller.abort(PAUSE_REASON)
      if (this.active.size <= 1) {
        this.rateLimiter.reset()
      }
      return
    }
    const idx = this.pending.findIndex((j) => j.transferId === transferId)
    if (idx !== -1) {
      const [job] = this.pending.splice(idx, 1)
      this.rememberRetryable(job)
      this.paused.add(transferId)
      if (this.active.size === 0) {
        this.rateLimiter.reset()
      }
      this.broadcast(this.retryEvent(job))
    }
  }

  private cleanupJobArtifacts(job: TransferJob): void {
    if (job.kind === 'upload') {
      void cleanupStagedDropPath(job.localPath).catch(() => undefined)
    }
    this.cleanupStaging(job)
  }

  private cleanupStaging(job: TransferJob): void {
    for (const part of job.staging?.values() ?? []) {
      try {
        const sessions = SessionManager.getInstance()
        const sessionId = sessions.connectedTransferSession(job.sessionId, job.connectionIdentity)
        const op = job.kind === 'upload'
          ? sessionId && sessions.shell(sessionId).unlink(part.path)
          : job.localDownloadRoot
            ? assertSafeLocalDownloadPath(job.localDownloadRoot, part.path).then(() => unlink(part.path))
            : unlink(part.path)
        if (!op) continue
        void op.catch(() => undefined)
      } catch {
        // The session may already be closed.
      }
    }
    job.staging?.clear()
  }

  /** Cancels a transfer, whether still queued or actively streaming. */
  cancel(transferId: string): void {
    const pausedJob = this.retryable.get(transferId)
    if (pausedJob && !this.paused.has(transferId)) {
      this.retryable.delete(transferId)
      this.cleanupJobArtifacts(pausedJob)
      return
    }
    if (pausedJob) {
      this.paused.delete(transferId)
      pausedJob.restartRequired = true
      pausedJob.retryError = undefined
      this.rememberRetryable(pausedJob)
      this.cleanupStaging(pausedJob)
      const evt = this.jobEvent(pausedJob, 'cancelled', { restartRequired: true })
      this.broadcast(evt)
      this.notifyTerminal(pausedJob, evt)
      return
    }
    const activeJob = this.active.get(transferId)
    if (activeJob) {
      activeJob.controller.abort()
      return
    }
    const idx = this.pending.findIndex((j) => j.transferId === transferId)
    if (idx !== -1) {
      const [job] = this.pending.splice(idx, 1)
      job.restartRequired = true
      job.retryError = undefined
      this.rememberRetryable(job)
      this.cleanupStaging(job)
      const evt = this.jobEvent(job, 'cancelled', { restartRequired: true })
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
    this.broadcast(this.jobEvent(job, 'started'))

    try {
      const shell = SessionManager.getInstance().shell(job.sessionId)
      const source = kind === 'upload' ? await stat(job.localPath) : await shell.stat(job.remotePath)
      const totalBytes = source.size ?? 0
      const stamp = `${totalBytes}:${kind === 'upload' ? (source as { mtimeMs: number }).mtimeMs : source.mtime}`
      if (job.resume && job.sourceStamp !== undefined && job.sourceStamp !== stamp) {
        throw new TransferRestartRequired('The source file changed. Restart the transfer to copy the current file.')
      }
      job.sourceStamp = stamp

      const startedAt = Date.now()
      let lastEmit = startedAt
      const emitProgress = (bytesTransferred: number, offset: number): void => {
        const now = Date.now()
        if (now - lastEmit < PROGRESS_THROTTLE_MS && bytesTransferred < totalBytes) {
          return
        }
        lastEmit = now
        const elapsedSec = (now - startedAt) / 1000
        const bytesPerSec = elapsedSec > 0 ? Math.round((bytesTransferred - offset) / elapsedSec) : 0
        const etaMs = bytesPerSec > 0 ? Math.round(((totalBytes - bytesTransferred) / bytesPerSec) * 1000) : 0
        this.broadcast({ transferId, kind, state: 'progress', bytesTransferred, totalBytes, bytesPerSec, etaMs, filesDone: 0, filesTotal: 1 })
      }

      if (job.createParents) {
        if (job.controller.signal.aborted) throw new SshError('CANCELLED', 'Transfer cancelled')
        if (kind === 'upload') await shell.mkdirRecursive(path.posix.dirname(job.remotePath))
        else await mkdirLocalRecursive(path.dirname(job.localPath))
      }
      job.staging ??= new Map()
      const remoteMtime =
        kind === 'download' && 'mtime' in source && typeof source.mtime === 'number' && Number.isFinite(source.mtime) && source.mtime > 0
          ? new Date(source.mtime * 1000)
          : undefined
      await this.runFile({
        shell,
        kind,
        localPath: job.localPath,
        remotePath: job.remotePath,
        signal: job.controller.signal,
        size: totalBytes,
        resume: job.resume === true,
        remoteMtime,
        staging: job.staging,
        onProgress: emitProgress
      })

      if (kind === 'upload') {
        await cleanupStagedDropPath(job.localPath).catch(() => undefined)
      }
      const doneEvt = this.jobEvent(job, 'done', { bytesTransferred: totalBytes, totalBytes, filesDone: 1, filesTotal: 1 })
      this.broadcast(doneEvt)
      this.notifyTerminal(job, doneEvt)
    } catch (e) {
      this.handleRunFailure(job, e)
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
    size: number
    resume: boolean
    remoteMtime?: Date
    localDownloadRoot?: string
    staging: NonNullable<TransferJob['staging']>
    onProgress: (bytesTransferred: number, offset: number) => void
  }): Promise<void> {
    const sftp = await opts.shell.sftp()
    const destPath = opts.kind === 'upload' ? opts.remotePath : opts.localPath
    let part = opts.staging.get(destPath)
    const localDownloadRoot = opts.kind === 'download' ? opts.localDownloadRoot : undefined
    if (localDownloadRoot) {
      await assertSafeLocalDownloadPath(localDownloadRoot, destPath)
    }
    if (part && localDownloadRoot) {
      await assertSafeLocalDownloadPath(localDownloadRoot, part.path)
    }
    let offset = 0
    if (part && opts.resume && part.offset > 0) {
      const partSize = await (opts.kind === 'upload' ? opts.shell.stat(part.path) : lstat(part.path))
        .then((info) => info.size)
        .catch((error: unknown) => {
          const code = (error as NodeJS.ErrnoException | undefined)?.code
          if (code === 'ENOENT' || code === 'NOT_FOUND') return 0
          throw error
        })
      if (partSize < part.offset || partSize > opts.size) {
        throw new TransferRestartRequired('The partial file is missing or has an unexpected size. Restart the transfer.')
      }
      offset = part.offset
    }
    if (!offset && part) {
      await this.removePart(opts, part.path)
      opts.staging.delete(destPath)
      part = undefined
    }
    const paths = opts.kind === 'upload' ? path.posix : path
    const fresh = !part
    const staging = part ?? { path: paths.join(paths.dirname(destPath), `.ferry-transfer-${randomUUID()}.part`), offset: 0 }
    await transferPipelined({
      sftp,
      kind: opts.kind,
      localPath: opts.kind === 'upload' ? opts.localPath : staging.path,
      remotePath: opts.kind === 'upload' ? staging.path : opts.remotePath,
      size: opts.size,
      offset,
      signal: opts.signal,
      rateLimiter: this.rateLimiter,
      // Display the contiguous prefix the next attempt can actually reuse.
      onProgress: (_bytesMoved, startOffset) => opts.onProgress(staging.offset, startOffset),
      onContigOffset: (contig) => { staging.offset = contig },
      beforeLocalOpen: localDownloadRoot ? () => assertSafeLocalDownloadPath(localDownloadRoot, staging.path) : undefined,
      afterLocalOpen: localDownloadRoot
        ? (handle) => assertSafeLocalDownloadHandle(localDownloadRoot, staging.path, handle)
        : undefined,
      onDestinationCreated: fresh ? () => { opts.staging.set(destPath, staging) } : undefined
    })
    if (opts.signal.aborted) throw new SshError('CANCELLED', 'Transfer cancelled')
    if (opts.kind === 'upload') {
      await commitRemoteFile(opts.shell, staging.path, destPath)
    } else {
      if (localDownloadRoot) {
        await assertSafeLocalDownloadPath(localDownloadRoot, staging.path)
        await assertSafeLocalDownloadPath(localDownloadRoot, destPath)
      }
      await rename(staging.path, destPath)
      if (localDownloadRoot) {
        await assertSafeLocalDownloadPath(localDownloadRoot, destPath)
      }
      if (opts.remoteMtime) {
        await utimes(destPath, opts.remoteMtime, opts.remoteMtime).catch(() => undefined)
      }
    }
    opts.staging.delete(destPath)
  }

  private async removePart(opts: { shell: RemoteShell; kind: TransferKind; localDownloadRoot?: string }, partPath: string): Promise<void> {
    if (opts.kind === 'upload') {
      await opts.shell.unlink(partPath).catch(() => undefined)
    } else {
      if (opts.localDownloadRoot) {
        await assertSafeLocalDownloadPath(opts.localDownloadRoot, partPath)
      }
      await unlink(partPath).catch(() => undefined)
    }
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
    this.broadcast(this.jobEvent(job, 'started'))

    try {
      const shell = SessionManager.getInstance().shell(job.sessionId)
      const tree = kind === 'upload' ? await listRecursive(job.localPath) : await shell.readdirRecursive(job.remotePath)
      const files = tree.filter((e) => !e.isDir)
      const stampFor = (file: (typeof files)[number]): string => `${file.size}:${file.mtimeMs ?? ''}`
      if (job.resume && job.sourceStamps?.size) {
        const currentStamps = new Map(files.map((file) => [file.relPath, stampFor(file)]))
        for (const [relativePath, stamp] of job.sourceStamps) {
          if (currentStamps.get(relativePath) !== stamp) {
            throw new TransferRestartRequired('A source file in the folder changed. Restart the transfer to copy the current folder.')
          }
        }
      }

      const localDownloadRoot = kind === 'download'
        ? job.localDownloadRoot ?? await prepareSafeLocalDownloadRoot(job.localPath)
        : undefined
      if (localDownloadRoot) {
        job.localDownloadRoot = localDownloadRoot
        await ensureSafeLocalDownloadDirectory(localDownloadRoot, localDownloadRoot)
      }
      if (kind === 'upload') {
        await shell.mkdirRecursive(job.remotePath)
      }

      const dirs = tree.filter((e) => e.isDir)

      await runConcurrent(dirs, TREE_ITEM_CONCURRENCY, async (dir) => {
        if (job.controller.signal.aborted) {
          throw new SshError('CANCELLED', 'Transfer cancelled')
        }
        if (kind === 'upload') {
          await shell.mkdirRecursive(joinRemote(job.remotePath, dir.relPath))
        } else {
          if (!localDownloadRoot) {
            throw new SshError('VALIDATION', 'The local download folder could not be resolved safely.')
          }
          await ensureSafeLocalDownloadDirectory(localDownloadRoot, joinLocal(localDownloadRoot, dir.relPath))
        }
      })

      job.staging ??= new Map()
      job.completedFiles ??= new Set()
      job.sourceStamps ??= new Map()

      const completedSet = job.completedFiles
      if (localDownloadRoot && job.resume) {
        await runConcurrent(
          files.filter((file) => completedSet.has(file.relPath)),
          TREE_ITEM_CONCURRENCY,
          async (file) => assertSafeLocalDownloadPath(localDownloadRoot, joinLocal(localDownloadRoot, file.relPath))
        )
      }
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
      let doneBytes = 0
      let filesDone = 0
      const pendingFiles: Array<{ file: (typeof files)[number]; index: number }> = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        if (job.resume && completedSet.has(f.relPath)) {
          doneBytes += f.size
          filesDone += 1
        } else {
          pendingFiles.push({ file: f, index: i })
        }
      }
      // Multiple files stream concurrently now, so "bytes so far" is doneBytes
      // (fully-finished files) plus whatever each still-in-flight file has moved.
      const inFlightBytes = new Map<number, number>()
      const startedAt = Date.now()
      let lastEmit = startedAt
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
        this.broadcast({ transferId, kind, state: 'progress', bytesTransferred, totalBytes, bytesPerSec, etaMs, filesDone, filesTotal: files.length })
      }

      await runConcurrent(
        pendingFiles,
        TREE_ITEM_CONCURRENCY,
        async ({ file, index }) => {
          if (job.controller.signal.aborted) {
            throw new SshError('CANCELLED', 'Transfer cancelled')
          }
          job.sourceStamps!.set(file.relPath, stampFor(file))
          inFlightBytes.set(index, 0)
          await this.runFile({
            shell,
            kind,
            localPath: joinLocal(localDownloadRoot ?? job.localPath, file.relPath),
            localDownloadRoot,
            remotePath: joinRemote(job.remotePath, file.relPath),
            signal: job.controller.signal,
            size: file.size,
            resume: job.resume === true,
            remoteMtime:
              kind === 'download' && typeof file.mtimeMs === 'number' && Number.isFinite(file.mtimeMs) && file.mtimeMs > 0
                ? new Date(file.mtimeMs)
                : undefined,
            staging: job.staging!,
            onProgress: (bytesTransferred) => {
              inFlightBytes.set(index, bytesTransferred)
              emitProgress()
            }
          })
          completedSet.add(file.relPath)
          inFlightBytes.delete(index)
          doneBytes += file.size
          filesDone += 1
          lastEmit = 0
          emitProgress()
        }
      )

      if (kind === 'upload') {
        await cleanupStagedDropPath(job.localPath).catch(() => undefined)
      }
      this.cleanupStaging(job)
      const doneEvt = this.jobEvent(job, 'done', { bytesTransferred: totalBytes, totalBytes, filesDone: files.length, filesTotal: files.length })
      this.broadcast(doneEvt)
      this.notifyTerminal(job, doneEvt)
    } catch (e) {
      this.handleRunFailure(job, e)
    }
  }

  private handleRunFailure(job: TransferJob, error: unknown): void {
    const cancelled = (error instanceof SshError && error.code === 'CANCELLED') || job.controller.signal.aborted
    const paused = cancelled && job.controller.signal.reason === PAUSE_REASON
    if (paused) this.paused.add(job.transferId)
    job.retryError = cancelled ? undefined : error instanceof Error ? error.message : String(error)
    job.restartRequired = (cancelled && !paused) || error instanceof TransferRestartRequired
    this.rememberRetryable(job)
    if (cancelled && !paused) this.cleanupStaging(job)
    const event =
      paused || !cancelled ? this.retryEvent(job) : this.jobEvent(job, 'cancelled', { restartRequired: true })
    this.broadcast(event)
    if (!paused) this.notifyTerminal(job, event)
  }

  private jobEvent(
    job: TransferJob,
    state: TransferState,
    extra?: Partial<Omit<TransferEvent, 'transferId' | 'kind' | 'state'>>
  ): TransferEvent {
    return {
      transferId: job.transferId,
      kind: job.kind,
      state,
      sessionId: job.sessionId,
      localPath: job.localPath,
      remotePath: job.remotePath,
      isDir: job.isTree,
      ...extra
    }
  }

  private broadcast(evt: TransferEvent): void {
    host().broadcast(EVENT_CHANNELS.transferEvent, evt)
  }
}

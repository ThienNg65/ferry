import { randomUUID } from 'crypto'
import { rename, stat, unlink } from 'fs/promises'
import * as path from 'path'
import { host } from '../host/host'
import { SessionManager } from '../ssh/SessionManager'
import type { RemoteShell } from '../ssh/RemoteShell'
import { SshError } from '../ssh/errors'
import { commitRemoteFile } from '../fs/RemoteFsService'
import { cleanupStagedDropPath, listRecursive, mkdirRecursive as mkdirLocalRecursive } from '../fs/LocalFsService'
import { runConcurrent } from '../util/concurrency'
import { transferPipelined } from './sftpPipeline'
import { EVENT_CHANNELS, type TransferEvent, type TransferKind, type TransferState } from '../../shared/contract'

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

  /** Only granted requests reserve time; cancellation removes queued work immediately. */
  acquire(bytes: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new SshError('CANCELLED', 'Transfer cancelled'))
    }
    if (!this.limitBytesPerSec) {
      return Promise.resolve()
    }
    // Start a new burst at wall time after an actual idle period; do not bank unlimited bandwidth.
    if (this.pending.length === 0 && this.nextAvailableAt < Date.now() - MAX_BANDWIDTH_CATCH_UP_MS) {
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

  retry(transferId: string): void {
    const old = this.retryable.get(transferId)
    if (!old) {
      throw new SshError('NOT_FOUND', 'Transfer cannot be retried')
    }
    this.retryable.delete(transferId)
    this.paused.delete(transferId)
    const job: TransferJob = { ...old, controller: new AbortController(), queuedAt: Date.now(), resume: true }
    this.pending.push(job)
    this.broadcast(this.jobEvent(job, 'queued'))
    this.pump()
  }

  private rememberRetryable(job: TransferJob): void {
    this.retryable.delete(job.transferId)
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
      return
    }
    const idx = this.pending.findIndex((j) => j.transferId === transferId)
    if (idx !== -1) {
      const [job] = this.pending.splice(idx, 1)
      this.rememberRetryable(job)
      this.paused.add(transferId)
      this.broadcast(this.jobEvent(job, 'paused'))
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
        const op = job.kind === 'upload'
          ? SessionManager.getInstance().shell(job.sessionId).unlink(part.path)
          : unlink(part.path)
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
      this.retryable.delete(transferId)
      this.paused.delete(transferId)
      const evt = this.jobEvent(pausedJob, 'cancelled')
      this.broadcast(evt)
      this.notifyTerminal(pausedJob, evt)
      this.cleanupJobArtifacts(pausedJob)
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
      const evt = this.jobEvent(job, 'cancelled')
      this.broadcast(evt)
      this.notifyTerminal(job, evt)
      this.cleanupJobArtifacts(job)
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
      const resume = job.resume === true && (job.sourceStamp === undefined || job.sourceStamp === stamp)
      job.sourceStamp = stamp

      const startedAt = Date.now()
      let lastEmit = 0
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
      await this.runFile({
        shell,
        kind,
        localPath: job.localPath,
        remotePath: job.remotePath,
        signal: job.controller.signal,
        size: totalBytes,
        resume,
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
      const cancelled = (e instanceof SshError && e.code === 'CANCELLED') || job.controller.signal.aborted
      const message = e instanceof Error ? e.message : String(e)
      const pausedNow = cancelled && job.controller.signal.reason === PAUSE_REASON
      if (!cancelled || pausedNow) {
        this.rememberRetryable(job)
      }
      if (pausedNow) {
        this.paused.add(transferId)
        this.broadcast(this.jobEvent(job, 'paused'))
        return
      }
      if (cancelled) this.cleanupJobArtifacts(job)
      const evt = this.jobEvent(job, cancelled ? 'cancelled' : 'error', { error: cancelled ? undefined : message })
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
    size: number
    resume: boolean
    staging: NonNullable<TransferJob['staging']>
    onProgress: (bytesTransferred: number, offset: number) => void
  }): Promise<void> {
    const sftp = await opts.shell.sftp()
    const destPath = opts.kind === 'upload' ? opts.remotePath : opts.localPath
    let part = opts.staging.get(destPath)
    const partSize = part && opts.resume
      ? await (opts.kind === 'upload' ? opts.shell.stat(part.path) : stat(part.path)).then((s) => s.size, () => 0)
      : 0
    const offset = part && partSize <= opts.size ? Math.min(partSize, part.offset) : 0
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
      onProgress: opts.onProgress,
      onContigOffset: (contig) => { staging.offset = contig },
      onDestinationCreated: fresh ? () => { opts.staging.set(destPath, staging) } : undefined
    })
    if (opts.signal.aborted) throw new SshError('CANCELLED', 'Transfer cancelled')
    if (opts.kind === 'upload') {
      await commitRemoteFile(opts.shell, staging.path, destPath)
    } else {
      await rename(staging.path, destPath)
    }
    opts.staging.delete(destPath)
  }

  private async removePart(opts: { shell: RemoteShell; kind: TransferKind }, partPath: string): Promise<void> {
    if (opts.kind === 'upload') {
      await opts.shell.unlink(partPath).catch(() => undefined)
    } else {
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

      job.staging ??= new Map()
      job.completedFiles ??= new Set()
      job.sourceStamps ??= new Map()

      const completedSet = job.completedFiles
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
      let doneBytes = 0
      let filesDone = 0
      const pendingFiles: Array<{ file: (typeof files)[number]; index: number }> = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const stamp = `${f.size}:${f.mtimeMs ?? ''}`
        const prevStamp = job.sourceStamps.get(f.relPath)
        if (job.resume && completedSet.has(f.relPath) && prevStamp === stamp) {
          doneBytes += f.size
          filesDone += 1
        } else {
          if (prevStamp !== undefined && prevStamp !== stamp) {
            completedSet.delete(f.relPath)
          }
          pendingFiles.push({ file: f, index: i })
        }
      }
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
        this.broadcast({ transferId, kind, state: 'progress', bytesTransferred, totalBytes, bytesPerSec, etaMs, filesDone, filesTotal: files.length })
      }

      await runConcurrent(
        pendingFiles,
        TREE_ITEM_CONCURRENCY,
        async ({ file, index }) => {
          if (job.controller.signal.aborted) {
            throw new SshError('CANCELLED', 'Transfer cancelled')
          }
          const stamp = `${file.size}:${file.mtimeMs ?? ''}`
          const prevStamp = job.sourceStamps!.get(file.relPath)
          const resumeFile = job.resume === true && (prevStamp === undefined || prevStamp === stamp)
          job.sourceStamps!.set(file.relPath, stamp)
          inFlightBytes.set(index, 0)
          await this.runFile({
            shell,
            kind,
            localPath: joinLocal(job.localPath, file.relPath),
            remotePath: joinRemote(job.remotePath, file.relPath),
            signal: job.controller.signal,
            size: file.size,
            resume: resumeFile,
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
      const cancelled = (e instanceof SshError && e.code === 'CANCELLED') || job.controller.signal.aborted
      const message = e instanceof Error ? e.message : String(e)
      const pausedNow = cancelled && job.controller.signal.reason === PAUSE_REASON
      if (!cancelled || pausedNow) {
        this.rememberRetryable(job)
      }
      if (pausedNow) {
        this.paused.add(transferId)
        this.broadcast(this.jobEvent(job, 'paused'))
        return
      }
      if (cancelled) this.cleanupJobArtifacts(job)
      const evt = this.jobEvent(job, cancelled ? 'cancelled' : 'error', { error: cancelled ? undefined : message })
      this.broadcast(evt)
      this.notifyTerminal(job, evt)
    }
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

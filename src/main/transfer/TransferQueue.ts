import { randomUUID } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { stat } from 'fs/promises'
import { BrowserWindow } from 'electron'
import { SessionManager } from '../ssh/SessionManager'
import { ActivityLog } from '../activity/ActivityLog'
import { SshError } from '../ssh/errors'
import { EVENT_CHANNELS, type TransferEvent, type TransferKind } from '../../shared/contract'

interface TransferJob {
  transferId: string
  sessionId: string
  kind: TransferKind
  localPath: string
  remotePath: string
  controller: AbortController
}

/** Transfers running at once — the rest wait in the queue. */
const MAX_CONCURRENT = 3
/** Minimum gap between progress broadcasts for a single transfer. */
const PROGRESS_THROTTLE_MS = 200

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

  static getInstance(): TransferQueue {
    if (TransferQueue.instance === null) {
      TransferQueue.instance = new TransferQueue()
    }
    return TransferQueue.instance
  }

  /** Queues a transfer and returns its id immediately; work happens in the background. */
  enqueue(sessionId: string, kind: TransferKind, localPath: string, remotePath: string): string {
    const transferId = randomUUID()
    const job: TransferJob = { transferId, sessionId, kind, localPath, remotePath, controller: new AbortController() }
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
      this.broadcast({ transferId: job.transferId, kind: job.kind, state: 'cancelled' })
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
    const { transferId, kind } = job
    this.broadcast({ transferId, kind, state: 'started' })
    ActivityLog.getInstance().emit(
      'transfer-start',
      kind === 'upload' ? `Uploading to ${job.remotePath}` : `Downloading ${job.remotePath}`,
      { sessionId: job.sessionId }
    )

    try {
      const shell = SessionManager.getInstance().shell(job.sessionId)
      const sftp = await shell.sftp()
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

      await new Promise<void>((resolve, reject) => {
        const readStream =
          kind === 'upload' ? createReadStream(job.localPath) : sftp.createReadStream(job.remotePath)
        const writeStream =
          kind === 'upload' ? sftp.createWriteStream(job.remotePath) : createWriteStream(job.localPath)

        let settled = false
        const finish = (err?: Error): void => {
          if (settled) {
            return
          }
          settled = true
          job.controller.signal.removeEventListener('abort', onAbort)
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        }
        const onAbort = (): void => {
          readStream.destroy()
          writeStream.destroy()
          finish(new SshError('CANCELLED', 'Transfer cancelled'))
        }
        job.controller.signal.addEventListener('abort', onAbort, { once: true })

        let bytesMoved = 0
        readStream.on('data', (chunk: Buffer | string) => {
          bytesMoved += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
          emitProgress(bytesMoved)
        })
        readStream.on('error', (e: Error) => finish(e))
        writeStream.on('error', (e: Error) => finish(e))
        writeStream.on('close', () => finish())
        readStream.pipe(writeStream)
      })

      this.broadcast({ transferId, kind, state: 'done', bytesTransferred: totalBytes, totalBytes })
      ActivityLog.getInstance().emit(
        'transfer-done',
        kind === 'upload' ? `Uploaded to ${job.remotePath}` : `Downloaded to ${job.localPath}`,
        { sessionId: job.sessionId }
      )
    } catch (e) {
      const cancelled = e instanceof SshError && e.code === 'CANCELLED'
      const message = e instanceof Error ? e.message : String(e)
      this.broadcast({ transferId, kind, state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : message })
      if (!cancelled) {
        ActivityLog.getInstance().emit('transfer-error', `Transfer failed: ${message}`, {
          sessionId: job.sessionId,
          level: 'error'
        })
      }
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

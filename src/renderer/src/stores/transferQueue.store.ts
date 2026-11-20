import { defineStore } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { TransferEnqueueResult, TransferEvent, TransferKind, TransferState } from '@shared/contract'
import { invoke, onEvent } from '../api'
import { useNotify } from '../composables/useNotify'
import { useLocalFsStore } from './localFs.store'
import { useRemoteFsStore } from './remoteFs.store'

const REFRESH_DEBOUNCE_MS = 100
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function parentPosixDir(remotePath: string): string {
  const trimmed = remotePath.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  if (idx < 0) return ''
  return idx === 0 ? '/' : trimmed.slice(0, idx)
}

function parentLocalDir(localPath: string): string {
  const trimmed = localPath.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (idx < 0) return ''
  if (idx === 0) return '/'
  if (idx === 2 && /^[A-Za-z]:/.test(trimmed)) return trimmed.slice(0, 3)
  return trimmed.slice(0, idx)
}

function scheduleDestinationRefresh(key: string, fn: () => Promise<void>): void {
  const prev = refreshTimers.get(key)
  if (prev) clearTimeout(prev)
  refreshTimers.set(
    key,
    setTimeout(() => {
      refreshTimers.delete(key)
      void fn()
    }, REFRESH_DEBOUNCE_MS)
  )
}

export interface TransferItemState {
  transferId: string
  sessionId: string
  kind: TransferKind
  state: TransferState
  localPath: string
  remotePath: string
  isDir: boolean
  bytesTransferred: number
  totalBytes: number
  bytesPerSec: number
  etaMs: number
  filesDone: number
  filesTotal: number
  error?: string
  reconnectRequired?: boolean
  restartRequired?: boolean
}

interface TransferQueueState {
  items: Map<string, TransferItemState>
  unsubscribe: (() => void) | null
}

export const useTransferQueueStore = defineStore('transferQueue', {
  state: (): TransferQueueState => ({
    items: new Map(),
    unsubscribe: null
  }),

  getters: {
    list: (state): TransferItemState[] => Array.from(state.items.values()).reverse(),
    summary(): { filesDone: number; filesTotal: number; percent: number } {
      let filesDone = 0
      let filesTotal = 0
      let bytes = 0
      let totalBytes = 0
      for (const item of this.items.values()) {
        filesDone += item.filesDone
        filesTotal += item.filesTotal
        bytes += item.bytesTransferred
        totalBytes += item.totalBytes
      }
      return { filesDone, filesTotal, percent: totalBytes > 0 ? Math.min(100, Math.round((bytes / totalBytes) * 100)) : 0 }
    },
    /** Transfers currently queued or moving bytes — drives the dock tab badge. */
    activeCount: (state): number => {
      let count = 0
      for (const item of state.items.values()) {
        if (item.state === 'queued' || item.state === 'started' || item.state === 'progress') {
          count += 1
        }
      }
      return count
    }
  },

  actions: {
    ensureSubscription(): void {
      if (this.unsubscribe) {
        return
      }
      const notify = useNotify()
      this.unsubscribe = onEvent<TransferEvent>(EVENT_CHANNELS.transferEvent, (evt) => {
        const existing = this.items.get(evt.transferId)
        const item: TransferItemState = {
          transferId: evt.transferId,
          sessionId: evt.sessionId ?? existing?.sessionId ?? '',
          kind: evt.kind,
          state: evt.state,
          localPath: evt.localPath ?? existing?.localPath ?? '',
          remotePath: evt.remotePath ?? existing?.remotePath ?? '',
          isDir: evt.isDir ?? existing?.isDir ?? false,
          bytesTransferred: evt.bytesTransferred ?? existing?.bytesTransferred ?? 0,
          totalBytes: evt.totalBytes ?? existing?.totalBytes ?? 0,
          bytesPerSec: evt.bytesPerSec ?? 0,
          etaMs: evt.etaMs ?? 0,
          filesDone: evt.filesDone ?? existing?.filesDone ?? 0,
          filesTotal: evt.filesTotal ?? existing?.filesTotal ?? 0,
          error: evt.error,
          reconnectRequired: evt.reconnectRequired,
          restartRequired: evt.restartRequired
        }
        this.items.set(evt.transferId, item)
        const name = basename(item.remotePath || item.localPath || '')
        if (evt.state === 'done') {
          notify.success(evt.kind === 'download' ? 'Download complete' : 'Upload complete', name)
          if (item.kind === 'upload' && item.sessionId && item.remotePath) {
            const targetDir = parentPosixDir(item.remotePath)
            if (targetDir) {
              const remoteFs = useRemoteFsStore()
              scheduleDestinationRefresh(`remote:${item.sessionId}:${targetDir}`, () =>
                remoteFs.refreshSessionIfViewing(item.sessionId, targetDir)
              )
            }
          } else if (item.kind === 'download' && item.localPath) {
            const targetDir = parentLocalDir(item.localPath)
            if (targetDir) {
              const localFs = useLocalFsStore()
              scheduleDestinationRefresh(`local:${targetDir}`, () => localFs.refreshIfViewing(targetDir))
            }
          }
        } else if (evt.state === 'error' && existing?.state !== 'error') {
          notify.error(evt.kind === 'download' ? 'Download failed' : 'Upload failed', evt.error ?? name)
        }
      })
    },

    async enqueue(
      sessionId: string,
      kind: TransferKind,
      localPath: string,
      remotePath: string,
      isDir = false,
      createParents?: boolean
    ): Promise<void> {
      this.ensureSubscription()
      const result = await invoke<TransferEnqueueResult>(INVOKE_CHANNELS.transferEnqueue, {
        sessionId,
        kind,
        localPath,
        remotePath,
        isDir,
        ...(createParents ? { createParents } : {})
      })
      // Main-side push()/run() can broadcast 'queued'/'started' transfer
      // events synchronously before this invoke() resolves. Only seed the
      // initial snapshot if nothing has arrived yet, or if it hasn't
      // progressed past 'queued' — never clobber state that's already moved
      // on (started/progress/done/error), which for a fast/small transfer
      // could otherwise permanently erase a terminal state no further event
      // will ever correct.
      const existing = this.items.get(result.transferId)
      if (!existing || existing.state === 'queued') {
        this.items.set(result.transferId, {
          transferId: result.transferId,
          sessionId,
          kind,
          state: 'queued',
          localPath,
          remotePath,
          isDir,
          bytesTransferred: 0,
          totalBytes: 0,
          bytesPerSec: 0,
          etaMs: 0,
          filesDone: 0,
          filesTotal: 0
        })
      } else {
        existing.sessionId ||= sessionId
        existing.localPath ||= localPath
        existing.remotePath ||= remotePath
        existing.isDir ||= isDir
      }
    },

    async cancel(transferId: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.transferCancel, transferId)
    },

    async pause(transferId: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.transferPause, transferId)
    },

    async retry(transferId: string, restart = false): Promise<void> {
      try {
        await invoke<void>(INVOKE_CHANNELS.transferRetry, transferId, restart)
      } catch (error) {
        const item = this.items.get(transferId)
        if (item) item.error = error instanceof Error ? error.message : String(error)
      }
    },

    /** Removes completed, failed, and cancelled transfers from the in-memory queue view. */
    clearFinished(): void {
      for (const [id, item] of this.items.entries()) {
        if (item.state === 'done' || item.state === 'error' || item.state === 'cancelled') {
          this.items.delete(id)
        }
      }
    }
  }
})

import { defineStore } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { TransferEnqueueResult, TransferEvent, TransferKind, TransferState } from '@shared/contract'
import { invoke, onEvent } from '../api'
import { useNotify } from '../composables/useNotify'

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export interface TransferItemState {
  transferId: string
  kind: TransferKind
  state: TransferState
  localPath: string
  remotePath: string
  bytesTransferred: number
  totalBytes: number
  bytesPerSec: number
  etaMs: number
  error?: string
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
    list: (state): TransferItemState[] => Array.from(state.items.values()).reverse()
  },

  actions: {
    ensureSubscription(): void {
      if (this.unsubscribe) {
        return
      }
      const notify = useNotify()
      this.unsubscribe = onEvent<TransferEvent>(EVENT_CHANNELS.transferEvent, (evt) => {
        const existing = this.items.get(evt.transferId)
        this.items.set(evt.transferId, {
          transferId: evt.transferId,
          kind: evt.kind,
          state: evt.state,
          localPath: existing?.localPath ?? '',
          remotePath: existing?.remotePath ?? '',
          bytesTransferred: evt.bytesTransferred ?? existing?.bytesTransferred ?? 0,
          totalBytes: evt.totalBytes ?? existing?.totalBytes ?? 0,
          bytesPerSec: evt.bytesPerSec ?? 0,
          etaMs: evt.etaMs ?? 0,
          error: evt.error
        })
        const name = basename(existing?.remotePath || existing?.localPath || '')
        if (evt.state === 'done') {
          notify.success(evt.kind === 'download' ? 'Download complete' : 'Upload complete', name)
        } else if (evt.state === 'error') {
          notify.error(evt.kind === 'download' ? 'Download failed' : 'Upload failed', evt.error ?? name)
        }
      })
    },

    async enqueue(sessionId: string, kind: TransferKind, localPath: string, remotePath: string): Promise<void> {
      this.ensureSubscription()
      const result = await invoke<TransferEnqueueResult>(INVOKE_CHANNELS.transferEnqueue, {
        sessionId,
        kind,
        localPath,
        remotePath
      })
      this.items.set(result.transferId, {
        transferId: result.transferId,
        kind,
        state: 'queued',
        localPath,
        remotePath,
        bytesTransferred: 0,
        totalBytes: 0,
        bytesPerSec: 0,
        etaMs: 0
      })
    },

    async cancel(transferId: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.transferCancel, transferId)
    }
  }
})

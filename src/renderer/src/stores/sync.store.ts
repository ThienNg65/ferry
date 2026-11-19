import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { SyncOptions, SyncPlan, SyncRunRequest, SyncRunResult } from '@shared/contract'
import { invoke } from '../api'

export const useSyncStore = defineStore('sync', {
  actions: {
    async preview(options: SyncOptions): Promise<SyncPlan> {
      return invoke<SyncPlan>(INVOKE_CHANNELS.syncPreview, options)
    },

    async run(request: SyncRunRequest): Promise<SyncRunResult> {
      return invoke<SyncRunResult>(INVOKE_CHANNELS.syncRun, request)
    }
  }
})

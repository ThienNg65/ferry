import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { SyncOptions, SyncPlan, SyncRunResult } from '@shared/contract'
import { invoke } from '../api'

export const useSyncStore = defineStore('sync', {
  actions: {
    async preview(options: SyncOptions): Promise<SyncPlan> {
      return invoke<SyncPlan>(INVOKE_CHANNELS.syncPreview, options)
    },

    async run(options: SyncOptions): Promise<SyncRunResult> {
      return invoke<SyncRunResult>(INVOKE_CHANNELS.syncRun, options)
    }
  }
})

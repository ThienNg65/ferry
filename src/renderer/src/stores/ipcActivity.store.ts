import { defineStore } from 'pinia'

interface IpcActivityState {
  count: number
}

/** Tracks how many IPC `invoke()` calls are currently in flight — see `api.ts`'s `invoke()`. */
export const useIpcActivityStore = defineStore('ipcActivity', {
  state: (): IpcActivityState => ({ count: 0 }),

  getters: {
    isBusy: (state): boolean => state.count > 0
  },

  actions: {
    increment(): void {
      this.count += 1
    },
    decrement(): void {
      this.count = Math.max(0, this.count - 1)
    }
  }
})

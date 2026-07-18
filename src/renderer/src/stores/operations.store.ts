import { defineStore } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { OperationEvent, OperationKind, OperationState } from '@shared/contract'
import { invoke, onEvent } from '../api'

/** How long a successfully-finished row lingers in the Activity list before auto-dropping. */
const DONE_ROW_TTL_MS = 10_000

const RUNNING_STATES: ReadonlySet<OperationState> = new Set(['started', 'progress'])

export interface OperationItemState {
  operationId: string
  kind: OperationKind
  state: OperationState
  label: string
  sessionId?: string
  startedAt: number
  cancellable: boolean
  progressCurrent?: number
  progressTotal?: number
  progressUnit?: 'bytes' | 'items'
  error?: string
}

interface OperationsState {
  items: Map<string, OperationItemState>
  unsubscribe: (() => void) | null
}

/**
 * Renderer mirror of the main-process OperationRegistry, feeding the Activity
 * dock tab. Deliberately does NOT toast — the invoking call sites (FilePane's
 * compress/extract, the delete callers) already toast outcomes with richer
 * context, and doubling up would be noise.
 *
 * Subscribe from App.vue's onMounted (not lazily): operations originate
 * main-side from any invoke, so the subscription must exist before the first
 * operation starts or the dock badge misses events.
 */
export const useOperationsStore = defineStore('operations', {
  state: (): OperationsState => ({
    items: new Map(),
    unsubscribe: null
  }),

  getters: {
    list: (state): OperationItemState[] => Array.from(state.items.values()).reverse(),
    runningCount: (state): number => {
      let count = 0
      for (const item of state.items.values()) {
        if (RUNNING_STATES.has(item.state)) {
          count += 1
        }
      }
      return count
    },
    firstRunningLabel(): string | null {
      const running = this.list.find((item) => RUNNING_STATES.has(item.state))
      if (running) {
        return running.label
      }
      return null
    }
  },

  actions: {
    ensureSubscription(): void {
      if (this.unsubscribe) {
        return
      }
      this.unsubscribe = onEvent<OperationEvent>(EVENT_CHANNELS.operationEvent, (evt) => {
        const existing = this.items.get(evt.operationId)
        this.items.set(evt.operationId, {
          operationId: evt.operationId,
          kind: evt.kind,
          state: evt.state,
          label: evt.label,
          sessionId: evt.sessionId,
          startedAt: evt.startedAt,
          cancellable: evt.cancellable,
          progressCurrent: evt.progressCurrent ?? existing?.progressCurrent,
          progressTotal: evt.progressTotal ?? existing?.progressTotal,
          progressUnit: evt.progressUnit ?? existing?.progressUnit,
          error: evt.error
        })
        if (evt.state === 'done') {
          // Successful rows self-clean; error/cancelled rows stay until
          // clearFinished() so the user can read what happened.
          setTimeout(() => {
            if (this.items.get(evt.operationId)?.state === 'done') {
              this.items.delete(evt.operationId)
            }
          }, DONE_ROW_TTL_MS)
        }
      })
    },

    async cancel(operationId: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.operationCancel, operationId)
    },

    clearFinished(): void {
      for (const [id, item] of this.items) {
        if (!RUNNING_STATES.has(item.state)) {
          this.items.delete(id)
        }
      }
    }
  }
})

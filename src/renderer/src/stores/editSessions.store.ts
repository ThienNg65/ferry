import { defineStore } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { EditEvent, OpenEditSnapshot } from '@shared/contract'
import { invoke, onEvent } from '../api'
import { useNotify } from '../composables/useNotify'

export interface OpenEdit {
  editId: string
  sessionId: string
  remotePath: string
  localTempPath: string
  dirty: boolean
  sessionClosed: boolean
}

interface EditSessionsState {
  unsubscribe: (() => void) | null
  edits: OpenEdit[]
  hydrated: boolean
}

/**
 * Mirrors main-process EditSessionManager's lifecycle events: fires the
 * confirm/fail/disconnect toasts, and (since Milestone 2) tracks the list of
 * currently open edits for the "Open Edits" dock tab. The event stream alone
 * only covers edits opened after the store subscribes, so `hydrate()` calls
 * `edit:list` once up front to pick up any edits already open.
 */
export const useEditSessionsStore = defineStore('editSessions', {
  state: (): EditSessionsState => ({
    unsubscribe: null,
    edits: [],
    hydrated: false
  }),

  getters: {
    activeCount: (state): number => state.edits.length
  },

  actions: {
    ensureSubscription(): void {
      if (this.unsubscribe) {
        return
      }
      const notify = useNotify()
      this.unsubscribe = onEvent<EditEvent>(EVENT_CHANNELS.editEvent, (evt) => {
        const name = evt.localTempPath.split(/[/\\]/).pop() ?? evt.localTempPath
        switch (evt.state) {
          case 'reuploaded':
            notify.success('Re-uploaded', name)
            break
          case 'upload-error':
            notify.error('Re-upload failed', `${name}: ${evt.error ?? 'unknown error'}`)
            break
          case 'session-closed':
            notify.error('Session closed', `${name} — further changes won't be uploaded`)
            break
          default:
            break
        }
        this.applyEvent(evt)
      })
      if (!this.hydrated) {
        this.hydrated = true
        void this.hydrate()
      }
    },

    async hydrate(): Promise<void> {
      const snapshot = await invoke<OpenEditSnapshot[]>(INVOKE_CHANNELS.editList)
      this.edits = snapshot.map((s) => ({ ...s }))
    },

    applyEvent(evt: EditEvent): void {
      if (evt.state === 'closed') {
        this.edits = this.edits.filter((e) => e.editId !== evt.editId)
        return
      }
      const existing = this.edits.find((e) => e.editId === evt.editId)
      if (evt.state === 'opened') {
        if (!existing && evt.sessionId && evt.remotePath) {
          this.edits.push({
            editId: evt.editId,
            sessionId: evt.sessionId,
            remotePath: evt.remotePath,
            localTempPath: evt.localTempPath,
            dirty: false,
            sessionClosed: false
          })
        }
        return
      }
      if (!existing) {
        return
      }
      if (evt.state === 'reuploading') {
        existing.dirty = true
      } else if (evt.state === 'reuploaded') {
        existing.dirty = false
      } else if (evt.state === 'session-closed') {
        existing.sessionClosed = true
      }
    },

    async close(editId: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.editClose, editId)
      this.edits = this.edits.filter((e) => e.editId !== editId)
    }
  }
})

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
  conflict: boolean
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
        this.applyEvent(evt)
        switch (evt.state) {
          case 'reuploaded':
            notify.success('Re-uploaded', name)
            break
          case 'upload-error': {
            const sessionClosed = this.edits.find((edit) => edit.editId === evt.editId)?.sessionClosed
            const recovery = sessionClosed
              ? 'Your changes are still in the local copy.'
              : 'Your changes are still local. Save the file again to retry.'
            notify.error('Re-upload failed', `${name}: ${evt.error ?? 'unknown error'}. ${recovery}`)
            break
          }
          case 'remote-changed':
            notify.prompt('File changed on the server', `${name} was modified remotely since you opened it.`, [
              { label: 'Overwrite', onClick: () =>
                  void invoke<void>(INVOKE_CHANNELS.editForceReupload, evt.editId).catch((e: Error) => notify.error('Overwrite failed', e.message))
              },
              { label: 'Discard my edit', onClick: () => void this.close(evt.editId).catch(() => {}) }
            ])
            break
          case 'session-closed':
            notify.error('Session closed', `${name} — further changes won't be uploaded`)
            break
          default:
            break
        }
      })
      if (!this.hydrated) {
        this.hydrated = true
        void this.hydrate().catch(() => {
          this.hydrated = false
        })
      }
    },

    async hydrate(): Promise<void> {
      const snapshot = await invoke<OpenEditSnapshot[]>(INVOKE_CHANNELS.editList)
      this.edits = snapshot.map((s) => ({ ...s, conflict: false }))
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
            sessionClosed: false,
            conflict: false
          })
        }
        return
      }
      if (!existing) {
        return
      }
      if (evt.state === 'remote-changed') {
        existing.dirty = true
        existing.conflict = true
      } else if (evt.state === 'reuploading' || evt.state === 'upload-error') {
        existing.dirty = true
      } else if (evt.state === 'reuploaded') {
        existing.dirty = false
        existing.conflict = false
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

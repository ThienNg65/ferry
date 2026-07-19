import { defineStore } from 'pinia'
import { EVENT_CHANNELS } from '@shared/contract'
import type { EditEvent } from '@shared/contract'
import { onEvent } from '../api'
import { useNotify } from '../composables/useNotify'

interface EditSessionsState {
  unsubscribe: (() => void) | null
}

/**
 * Toast-only mirror of main-process EditSessionManager's lifecycle events.
 * Deliberately does NOT track per-edit state itself — the download/re-upload
 * progress already shows up in the Activity dock via the ordinary
 * OperationRegistry events (edit-download/edit-reupload kinds); this store's
 * only job is the confirm/fail/disconnect toast, a separate UX signal.
 */
export const useEditSessionsStore = defineStore('editSessions', {
  state: (): EditSessionsState => ({
    unsubscribe: null
  }),

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
      })
    }
  }
})

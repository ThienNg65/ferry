import { createPinia, setActivePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import type { EditEvent } from '@shared/contract'
import { onEvent } from '../api'
import { useNotify } from '../composables/useNotify'
import { useEditSessionsStore } from './editSessions.store'

vi.mock('../api', () => ({ invoke: vi.fn(), onEvent: vi.fn(() => () => {}) }))
vi.mock('../composables/useNotify', () => ({ useNotify: vi.fn() }))

it('marks a remote-changed edit dirty until overwrite succeeds', () => {
  setActivePinia(createPinia())
  const notify = { success: vi.fn(), error: vi.fn(), prompt: vi.fn() }
  vi.mocked(useNotify).mockReturnValue(notify)
  const store = useEditSessionsStore()
  store.hydrated = true
  vi.mocked(onEvent).mockClear()
  store.ensureSubscription()
  const onEditEvent = vi.mocked(onEvent).mock.calls[0][1]
  const edit = { editId: 'edit-2', sessionId: 'session-1', remotePath: '/srv/conflict.txt', localTempPath: 'conflict.txt' }
  const emit = (state: EditEvent['state']) => onEditEvent({ ...edit, state } satisfies EditEvent)

  emit('opened')
  expect(store.edits[0].conflict).toBe(false)
  emit('remote-changed')

  expect(store.edits[0].dirty).toBe(true)
  expect(store.edits[0].conflict).toBe(true)
  expect(notify.prompt).toHaveBeenCalledWith(
    'File changed on the server',
    'conflict.txt was modified remotely since you opened it.',
    expect.any(Array)
  )

  emit('reuploaded')

  expect(store.edits[0].dirty).toBe(false)
  expect(store.edits[0].conflict).toBe(false)
})

it('keeps an interrupted editor save unsaved and tells the user how to retry', () => {
  setActivePinia(createPinia())
  const notify = { success: vi.fn(), error: vi.fn(), prompt: vi.fn() }
  vi.mocked(useNotify).mockReturnValue(notify)
  const store = useEditSessionsStore()
  store.hydrated = true
  vi.mocked(onEvent).mockClear()
  store.ensureSubscription()
  const onEditEvent = vi.mocked(onEvent).mock.calls[0][1]
  const edit = { editId: 'edit-1', sessionId: 'session-1', remotePath: '/srv/edit.txt', localTempPath: 'edit.txt' }
  const emit = (state: EditEvent['state'], error?: string) => onEditEvent({ ...edit, state, error } satisfies EditEvent)

  emit('opened')
  emit('upload-error', 'Upload stream closed before finishing')

  expect(store.edits[0].dirty).toBe(true)
  expect(notify.error).toHaveBeenCalledWith(
    'Re-upload failed',
    'edit.txt: Upload stream closed before finishing. Your changes are still local. Save the file again to retry.'
  )
  expect(notify.success).not.toHaveBeenCalled()

  emit('reuploading')
  emit('reuploaded')

  expect(store.edits[0].dirty).toBe(false)
  expect(notify.success).toHaveBeenCalledWith('Re-uploaded', 'edit.txt')
})

import { handle } from './envelope'
import { INVOKE_CHANNELS, type EditOpenRemoteRequest, type EditOpenResult, type OpenEditSnapshot } from '../../shared/contract'
import { EditSessionManager } from '../edit/EditSessionManager'
import { SshError } from '../ssh/errors'

/** Registers edit-in-external-editor handlers. */
export function registerEditHandlers(): void {
  handle<void>(INVOKE_CHANNELS.editOpenLocal, async (localPath) => {
    if (typeof localPath !== 'string' || localPath.length === 0) {
      throw new SshError('VALIDATION', 'edit:openLocal requires a non-empty path')
    }
    await EditSessionManager.getInstance().openLocal(localPath)
  })

  handle<EditOpenResult>(INVOKE_CHANNELS.editOpenRemote, async (req) => {
    const { sessionId, path, builtin } = req as EditOpenRemoteRequest
    return EditSessionManager.getInstance().openRemote(sessionId, path, builtin)
  })

  handle<void>(INVOKE_CHANNELS.editOpenExternal, async (req) => {
    const { editId } = req as { editId: string }
    await EditSessionManager.getInstance().openExternal(editId)
  })

  handle<void>(INVOKE_CHANNELS.editClose, async (editId) => {
    await EditSessionManager.getInstance().closeEdit(editId as string)
  })

  handle<OpenEditSnapshot[]>(INVOKE_CHANNELS.editList, async () => {
    return EditSessionManager.getInstance().listEdits()
  })
}

import { handle } from './envelope'
import { INVOKE_CHANNELS, type EditOpenRemoteRequest, type EditOpenResult } from '../../shared/contract'
import { EditSessionManager } from '../edit/EditSessionManager'

/** Registers edit-in-external-editor handlers. */
export function registerEditHandlers(): void {
  handle<void>(INVOKE_CHANNELS.editOpenLocal, async (localPath) => {
    await EditSessionManager.getInstance().openLocal(localPath as string)
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
}

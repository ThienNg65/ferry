import { handle } from './envelope'
import { requireNonEmptyString, requireObject } from './validation'
import { INVOKE_CHANNELS, type EditOpenRemoteRequest, type EditOpenResult, type OpenEditSnapshot } from '../../shared/contract'
import { EditSessionManager } from '../edit/EditSessionManager'

/** Registers edit-in-external-editor handlers. */
export function registerEditHandlers(): void {
  handle<void>(INVOKE_CHANNELS.editOpenLocal, async (localPath) => {
    await EditSessionManager.getInstance().openLocal(requireNonEmptyString(localPath, 'localPath', INVOKE_CHANNELS.editOpenLocal))
  })

  handle<EditOpenResult>(INVOKE_CHANNELS.editOpenRemote, async (req) => {
    const obj = requireObject(req, INVOKE_CHANNELS.editOpenRemote) as unknown as EditOpenRemoteRequest
    const sessionId = requireNonEmptyString(obj.sessionId, 'sessionId', INVOKE_CHANNELS.editOpenRemote)
    const remotePath = requireNonEmptyString(obj.path, 'path', INVOKE_CHANNELS.editOpenRemote)
    return EditSessionManager.getInstance().openRemote(sessionId, remotePath, obj.builtin === true, Boolean(obj.viaSudo))
  })

  handle<void>(INVOKE_CHANNELS.editOpenExternal, async (req) => {
    const obj = requireObject(req, INVOKE_CHANNELS.editOpenExternal)
    await EditSessionManager.getInstance().openExternal(requireNonEmptyString(obj.editId, 'editId', INVOKE_CHANNELS.editOpenExternal))
  })

  handle<void>(INVOKE_CHANNELS.editClose, async (editId) => {
    await EditSessionManager.getInstance().closeEdit(requireNonEmptyString(editId, 'editId', INVOKE_CHANNELS.editClose))
  })

  handle<void>(INVOKE_CHANNELS.editForceReupload, async (editId) => {
    await EditSessionManager.getInstance().forceReupload(requireNonEmptyString(editId, 'editId', INVOKE_CHANNELS.editForceReupload))
  })

  handle<OpenEditSnapshot[]>(INVOKE_CHANNELS.editList, async () => {
    return EditSessionManager.getInstance().listEdits()
  })
}

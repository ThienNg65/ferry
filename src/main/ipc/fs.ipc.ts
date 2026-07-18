import * as path from 'path'
import { handle } from './envelope'
import {
  INVOKE_CHANNELS,
  type DeleteManyResult,
  type FileListResult,
  type FileReadResult
} from '../../shared/contract'
import * as LocalFs from '../fs/LocalFsService'
import * as RemoteFs from '../fs/RemoteFsService'
import { OperationRegistry } from '../operations/OperationRegistry'
import { runConcurrent } from '../util/concurrency'

/** Request payload for `fs:remote:deleteMany`. */
interface DeleteManyRequest {
  sessionId: string
  paths: string[]
}

/** Deletes running at once within one batch-delete operation. */
const DELETE_CONCURRENCY = 4

/** Registers local and remote (SFTP) filesystem IPC handlers. */
export function registerFsHandlers(): void {
  handle<FileListResult>(INVOKE_CHANNELS.fsLocalList, (dirPath) => LocalFs.list(dirPath as string | undefined))
  handle<void>(INVOKE_CHANNELS.fsLocalMkdir, (dirPath) => LocalFs.mkdir(dirPath as string))
  handle<void>(INVOKE_CHANNELS.fsLocalRename, (fromPath, toPath) =>
    LocalFs.rename(fromPath as string, toPath as string)
  )
  handle<void>(INVOKE_CHANNELS.fsLocalDelete, (targetPath, isDir) =>
    LocalFs.remove(targetPath as string, Boolean(isDir))
  )
  handle<FileReadResult>(INVOKE_CHANNELS.fsLocalReadFile, (filePath) => LocalFs.readFileText(filePath as string))

  handle<FileListResult>(INVOKE_CHANNELS.fsRemoteList, (sessionId, dirPath) =>
    RemoteFs.listRemote(sessionId as string, dirPath as string | undefined)
  )
  handle<void>(INVOKE_CHANNELS.fsRemoteMkdir, (sessionId, dirPath) =>
    RemoteFs.mkdirRemote(sessionId as string, dirPath as string)
  )
  handle<void>(INVOKE_CHANNELS.fsRemoteRename, (sessionId, fromPath, toPath) =>
    RemoteFs.renameRemote(sessionId as string, fromPath as string, toPath as string)
  )
  // Deletes are deliberately NOT cancellable: aborting the channel mid-`rm -rf`
  // doesn't stop the remote rm and would mislead the user about what survived.
  handle<void>(INVOKE_CHANNELS.fsRemoteDelete, (sessionId, targetPath) =>
    OperationRegistry.getInstance().run(
      {
        kind: 'delete-remote',
        label: `Deleting ${path.posix.basename(targetPath as string)}`,
        sessionId: sessionId as string,
        cancellable: false
      },
      () => RemoteFs.removeRemote(sessionId as string, targetPath as string)
    )
  )
  // Batch delete as ONE logical operation (one Activity row, one listing patch)
  // instead of the renderer fanning out N parallel fs:remote:delete calls.
  handle<DeleteManyResult>(INVOKE_CHANNELS.fsRemoteDeleteMany, async (req) => {
    const request = req as DeleteManyRequest
    const paths = Array.isArray(request.paths) ? request.paths.map(String) : []
    return OperationRegistry.getInstance().run(
      {
        kind: 'delete-remote-batch',
        label: `Deleting ${paths.length} items`,
        sessionId: request.sessionId,
        cancellable: false
      },
      async ({ reportProgress }) => {
        const result: DeleteManyResult = { deletedPaths: [], failures: [] }
        let done = 0
        // Workers catch their own failures so one bad path never stops the batch.
        await runConcurrent(paths, DELETE_CONCURRENCY, async (targetPath) => {
          try {
            await RemoteFs.removeRemote(request.sessionId, targetPath)
            result.deletedPaths.push(targetPath)
          } catch (e) {
            result.failures.push({ path: targetPath, error: e instanceof Error ? e.message : String(e) })
          }
          done += 1
          reportProgress(done, paths.length, 'items')
        })
        if (paths.length > 0 && result.deletedPaths.length === 0) {
          // Nothing succeeded — surface as an error (there is nothing for the
          // renderer to patch, and the Activity row should read as failed).
          throw new Error(`Could not delete: ${result.failures.map((f) => f.path).join(', ')}`)
        }
        return result
      }
    )
  })
  handle<void>(INVOKE_CHANNELS.fsRemoteChmod, (sessionId, targetPath, mode) =>
    RemoteFs.chmodRemote(sessionId as string, targetPath as string, mode as string)
  )
  handle<FileReadResult>(INVOKE_CHANNELS.fsRemoteReadFile, (sessionId, filePath) =>
    RemoteFs.readFile(sessionId as string, filePath as string)
  )
}

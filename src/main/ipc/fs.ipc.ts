import { handle } from './envelope'
import { INVOKE_CHANNELS, type FileListResult, type FileReadResult } from '../../shared/contract'
import * as LocalFs from '../fs/LocalFsService'
import * as RemoteFs from '../fs/RemoteFsService'

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
  handle<void>(INVOKE_CHANNELS.fsRemoteDelete, (sessionId, targetPath) =>
    RemoteFs.removeRemote(sessionId as string, targetPath as string)
  )
  handle<FileReadResult>(INVOKE_CHANNELS.fsRemoteReadFile, (sessionId, filePath) =>
    RemoteFs.readFile(sessionId as string, filePath as string)
  )
}

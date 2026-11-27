import * as path from 'path'
import { handle } from './envelope'
import {
  optionalString,
  requireArray,
  requireBoolean,
  requireNonEmptyString,
  requireObject,
  requireString
} from './validation'
import {
  INVOKE_CHANNELS,
  type CopyManyResult,
  type DeleteManyResult,
  type FileEntry,
  type FileListResult,
  type FileReadResult,
  type LocalUploadScanResult,
  type MonitorDiskUsage,
  type RemoteAdminRequest,
  type StageDropBeginRequest,
  type StageDropBeginResult,
  type StageDropRequest
} from '../../shared/contract'
import * as LocalFs from '../fs/LocalFsService'
import * as RemoteFs from '../fs/RemoteFsService'
import { OperationRegistry } from '../operations/OperationRegistry'
import { runConcurrent } from '../util/concurrency'

/** Deletes running at once within one batch-delete operation. */
const DELETE_CONCURRENCY = 4

/** Registers local and remote (SFTP) filesystem IPC handlers. */
export function registerFsHandlers(): void {
  // NOTE: the fsLocal* handlers below accept any renderer-supplied path with no
  // scoping/sandboxing to a root directory. This is deliberate, not an oversight —
  // Ferry's local pane is a general-purpose file browser (like the OS file picker),
  // so it must be able to reach anywhere on disk the user's own account can. There
  // is no v-html/XSS sink in the renderer that could smuggle in a hostile path, so
  // this isn't currently exploitable. Do not "fix" this into a restricted sandbox —
  // that would break normal file-browsing.
  handle<FileListResult>(INVOKE_CHANNELS.fsLocalList, (dirPath) =>
    LocalFs.list(optionalString(dirPath, 'dirPath', INVOKE_CHANNELS.fsLocalList))
  )
  handle<void>(INVOKE_CHANNELS.fsLocalTouch, (filePath) =>
    LocalFs.touch(requireNonEmptyString(filePath, 'filePath', INVOKE_CHANNELS.fsLocalTouch))
  )
  handle<void>(INVOKE_CHANNELS.fsRemoteTouch, (sessionId, filePath) => {
    const channel = INVOKE_CHANNELS.fsRemoteTouch
    return RemoteFs.touchRemote(
      requireNonEmptyString(sessionId, 'sessionId', channel),
      requireNonEmptyString(filePath, 'filePath', channel)
    )
  })
  handle<void>(INVOKE_CHANNELS.fsLocalMkdir, (dirPath) =>
    LocalFs.mkdir(requireNonEmptyString(dirPath, 'dirPath', INVOKE_CHANNELS.fsLocalMkdir))
  )
  handle<void>(INVOKE_CHANNELS.fsLocalRename, (fromPath, toPath, replace) => {
    const channel = INVOKE_CHANNELS.fsLocalRename
    const from = requireNonEmptyString(fromPath, 'fromPath', channel)
    const to = requireNonEmptyString(toPath, 'toPath', channel)
    if (replace !== undefined) {
      return LocalFs.rename(from, to, requireBoolean(replace, 'replace', channel))
    }
    return LocalFs.rename(from, to)
  })
  handle<void>(INVOKE_CHANNELS.fsLocalDelete, (targetPath, isDir) =>
    LocalFs.remove(requireNonEmptyString(targetPath, 'targetPath', INVOKE_CHANNELS.fsLocalDelete), Boolean(isDir))
  )
  handle<CopyManyResult>(INVOKE_CHANNELS.fsLocalCopy, (req) => {
    const channel = INVOKE_CHANNELS.fsLocalCopy
    const request = requireObject(req, channel)
    const rawPaths = requireArray(request.sourcePaths, 'sourcePaths', channel)
    const sourcePaths = rawPaths.map((p) => requireNonEmptyString(p, 'sourcePaths[]', channel))
    const targetDir = requireNonEmptyString(request.targetDir, 'targetDir', channel)
    const label =
      sourcePaths.length === 1
        ? `Copying ${path.basename(sourcePaths[0])}`
        : `Copying ${sourcePaths.length} items`
    return OperationRegistry.getInstance().run(
      {
        kind: 'copy-local',
        label,
        cancellable: true
      },
      async ({ signal, reportProgress }) => {
        const result = await LocalFs.copyLocal(sourcePaths, targetDir, {
          signal,
          onProgress: (done, total) => reportProgress(done, total, 'items')
        })
        if (sourcePaths.length > 0 && result.copied.length === 0) {
          throw new Error(`Could not copy: ${result.failures.map((f) => f.error).join('; ')}`)
        }
        return result
      }
    )
  })
  handle<FileEntry[]>(INVOKE_CHANNELS.fsLocalStageDrop, (req) => {
    const channel = INVOKE_CHANNELS.fsLocalStageDrop
    const request = requireObject(req, channel)
    const entries = requireArray(request.entries, 'entries', channel)
    for (const entry of entries) {
      const item = requireObject(entry, channel)
      requireNonEmptyString(item.relativePath, 'entries.relativePath', channel)
      requireBoolean(item.isDir, 'entries.isDir', channel)
      optionalString(item.modifiedAt, 'entries.modifiedAt', channel)
    }
    return LocalFs.stageDroppedEntries(req as StageDropRequest)
  })
  handle<StageDropBeginResult>(INVOKE_CHANNELS.fsLocalStageDropBegin, (req) => {
    const channel = INVOKE_CHANNELS.fsLocalStageDropBegin
    if (req !== undefined && req !== null) {
      const request = requireObject(req, channel)
      if (request.dirs !== undefined) {
        const dirs = requireArray(request.dirs, 'dirs', channel)
        for (const dir of dirs) {
          requireNonEmptyString(dir, 'dirs[]', channel)
        }
      }
    }
    return LocalFs.beginStageDrop(req as StageDropBeginRequest | undefined)
  })
  handle<FileEntry[]>(INVOKE_CHANNELS.fsLocalStageDropFinish, (req) => {
    const channel = INVOKE_CHANNELS.fsLocalStageDropFinish
    const request = requireObject(req, channel)
    return LocalFs.finishStageDrop(requireNonEmptyString(request.stageId, 'stageId', channel))
  })
  handle<void>(INVOKE_CHANNELS.fsLocalStageDropAbort, (req) => {
    const channel = INVOKE_CHANNELS.fsLocalStageDropAbort
    const request = requireObject(req, channel)
    return LocalFs.abortStageDrop(requireNonEmptyString(request.stageId, 'stageId', channel))
  })
  handle<void>(INVOKE_CHANNELS.fsLocalCleanupStagedDrop, (req) => {
    const channel = INVOKE_CHANNELS.fsLocalCleanupStagedDrop
    const request = requireObject(req, channel)
    const rawPaths = requireArray(request.paths, 'paths', channel)
    const paths = rawPaths.map((p) => requireNonEmptyString(p, 'paths[]', channel))
    return LocalFs.cleanupStagedDropPaths(paths)
  })
  handle<LocalUploadScanResult>(INVOKE_CHANNELS.fsLocalScanUploadPaths, (req) => {
    const channel = INVOKE_CHANNELS.fsLocalScanUploadPaths
    const request = requireObject(req, channel)
    const rawPaths = requireArray(request.paths, 'paths', channel)
    const paths = rawPaths.slice(0, 50).map((p) => requireNonEmptyString(p, 'paths[]', channel))
    return LocalFs.scanUploadPaths(paths)
  })
  handle<FileReadResult>(INVOKE_CHANNELS.fsLocalReadFile, (filePath, maxBytes) =>
    LocalFs.readFileText(
      requireNonEmptyString(filePath, 'filePath', INVOKE_CHANNELS.fsLocalReadFile),
      maxBytes as number | undefined
    )
  )
  handle<void>(INVOKE_CHANNELS.fsLocalWriteFile, (req) => {
    const channel = INVOKE_CHANNELS.fsLocalWriteFile
    const request = requireObject(req, channel)
    const filePath = requireNonEmptyString(request.path, 'path', channel)
    const content = requireString(request.content, 'content', channel)
    return LocalFs.writeFileText(filePath, content)
  })

  handle<FileListResult>(INVOKE_CHANNELS.fsRemoteList, (sessionId, dirPath, isPrefetch) => {
    const channel = INVOKE_CHANNELS.fsRemoteList
    return RemoteFs.listRemote(
      requireNonEmptyString(sessionId, 'sessionId', channel),
      optionalString(dirPath, 'dirPath', channel),
      Boolean(isPrefetch)
    )
  })
  handle<MonitorDiskUsage | null>(INVOKE_CHANNELS.fsRemoteDiskUsage, (sessionId, targetPath) => {
    const channel = INVOKE_CHANNELS.fsRemoteDiskUsage
    return RemoteFs.diskUsageRemote(
      requireNonEmptyString(sessionId, 'sessionId', channel),
      optionalString(targetPath, 'targetPath', channel) ?? '/'
    )
  })
  handle<void>(INVOKE_CHANNELS.fsRemoteMkdir, (sessionId, dirPath) => {
    const channel = INVOKE_CHANNELS.fsRemoteMkdir
    return RemoteFs.mkdirRemote(
      requireNonEmptyString(sessionId, 'sessionId', channel),
      requireNonEmptyString(dirPath, 'dirPath', channel)
    )
  })
  handle<void>(INVOKE_CHANNELS.fsRemoteRename, (sessionId, fromPath, toPath, replace) => {
    const channel = INVOKE_CHANNELS.fsRemoteRename
    const sid = requireNonEmptyString(sessionId, 'sessionId', channel)
    const from = requireNonEmptyString(fromPath, 'fromPath', channel)
    const to = requireNonEmptyString(toPath, 'toPath', channel)
    if (replace !== undefined) {
      return RemoteFs.renameRemote(sid, from, to, requireBoolean(replace, 'replace', channel))
    }
    return RemoteFs.renameRemote(sid, from, to)
  })
  handle<CopyManyResult>(INVOKE_CHANNELS.fsRemoteCopy, (req) => {
    const channel = INVOKE_CHANNELS.fsRemoteCopy
    const request = requireObject(req, channel)
    const sessionId = requireNonEmptyString(request.sessionId, 'sessionId', channel)
    const rawPaths = requireArray(request.sourcePaths, 'sourcePaths', channel)
    const sourcePaths = rawPaths.map((p) => requireNonEmptyString(p, 'sourcePaths[]', channel))
    const targetDir = requireNonEmptyString(request.targetDir, 'targetDir', channel)
    const label =
      sourcePaths.length === 1
        ? `Copying ${path.posix.basename(sourcePaths[0])}`
        : `Copying ${sourcePaths.length} items`
    return OperationRegistry.getInstance().run(
      {
        kind: 'copy-remote',
        label,
        sessionId,
        cancellable: true
      },
      async ({ signal, reportProgress }) => {
        const result = await RemoteFs.copyRemote(sessionId, sourcePaths, targetDir, {
          signal,
          onProgress: (done, total) => reportProgress(done, total, 'items')
        })
        if (sourcePaths.length > 0 && result.copied.length === 0) {
          throw new Error(`Could not copy: ${result.failures.map((f) => f.error).join('; ')}`)
        }
        return result
      }
    )
  })
  // Deletes are deliberately NOT cancellable: aborting the channel mid-`rm -rf`
  // doesn't stop the remote rm and would mislead the user about what survived.
  handle<void>(INVOKE_CHANNELS.fsRemoteDelete, (sessionId, targetPath) => {
    const channel = INVOKE_CHANNELS.fsRemoteDelete
    const sid = requireNonEmptyString(sessionId, 'sessionId', channel)
    const target = requireNonEmptyString(targetPath, 'targetPath', channel)
    return OperationRegistry.getInstance().run(
      {
        kind: 'delete-remote',
        label: `Deleting ${path.posix.basename(target)}`,
        sessionId: sid,
        cancellable: false
      },
      () => RemoteFs.removeRemote(sid, target)
    )
  })
  // Batch delete as ONE logical operation (one Activity row, one listing patch)
  // instead of the renderer fanning out N parallel fs:remote:delete calls.
  handle<DeleteManyResult>(INVOKE_CHANNELS.fsRemoteDeleteMany, async (req) => {
    const channel = INVOKE_CHANNELS.fsRemoteDeleteMany
    const request = requireObject(req, channel)
    const sessionId = requireNonEmptyString(request.sessionId, 'sessionId', channel)
    const rawPaths = requireArray(request.paths, 'paths', channel)
    const paths = rawPaths.map((p) => requireNonEmptyString(p, 'paths[]', channel))
    return OperationRegistry.getInstance().run(
      {
        kind: 'delete-remote-batch',
        label: `Deleting ${paths.length} items`,
        sessionId,
        cancellable: false
      },
      async ({ reportProgress }) => {
        const result: DeleteManyResult = { deletedPaths: [], failures: [] }
        let done = 0
        // Workers catch their own failures so one bad path never stops the batch.
        await runConcurrent(paths, DELETE_CONCURRENCY, async (targetPath) => {
          try {
            await RemoteFs.removeRemote(sessionId, targetPath)
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
  handle<void>(INVOKE_CHANNELS.fsRemoteAdmin, (req) => {
    const channel = INVOKE_CHANNELS.fsRemoteAdmin
    const obj = requireObject(req, channel)
    const sessionId = requireNonEmptyString(obj.sessionId, 'sessionId', channel)
    const targetPath = requireNonEmptyString(obj.path, 'path', channel)
    const mode = optionalString(obj.mode, 'mode', channel)
    const owner = optionalString(obj.owner, 'owner', channel)
    const group = optionalString(obj.group, 'group', channel)
    const recursive = obj.recursive === undefined ? undefined : requireBoolean(obj.recursive, 'recursive', channel)
    const request: RemoteAdminRequest = {
      sessionId,
      path: targetPath,
      ...(mode !== undefined ? { mode } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(recursive !== undefined ? { recursive } : {})
    }
    return OperationRegistry.getInstance().run(
      {
        kind: 'chmod-remote',
        label: `Changing permissions on ${path.posix.basename(targetPath)}`,
        sessionId,
        cancellable: false
      },
      () => RemoteFs.adminRemote(request)
    )
  })
  handle<void>(INVOKE_CHANNELS.fsRemoteChmod, (sessionId, targetPath, mode) => {
    const channel = INVOKE_CHANNELS.fsRemoteChmod
    return RemoteFs.chmodRemote(
      requireNonEmptyString(sessionId, 'sessionId', channel),
      requireNonEmptyString(targetPath, 'targetPath', channel),
      requireNonEmptyString(mode, 'mode', channel)
    )
  })
  handle<FileReadResult>(INVOKE_CHANNELS.fsRemoteReadFile, (sessionId, filePath) => {
    const channel = INVOKE_CHANNELS.fsRemoteReadFile
    return RemoteFs.readFile(
      requireNonEmptyString(sessionId, 'sessionId', channel),
      requireNonEmptyString(filePath, 'filePath', channel)
    )
  })
}

import * as path from 'path'
import { handle } from './envelope'
import { requireNonEmptyString, requireObject } from './validation'
import {
  INVOKE_CHANNELS,
  type CompressLocalRequest,
  type CompressRemoteRequest,
  type UnzipResult
} from '../../shared/contract'
import * as CompressService from '../archive/CompressService'
import { OperationRegistry } from '../operations/OperationRegistry'

/** Registers the "Compress to zip" (local + remote) handlers. */
export function registerArchiveHandlers(): void {
  handle<void>(INVOKE_CHANNELS.archiveCompressLocal, (req) => {
    const request = requireObject(req, INVOKE_CHANNELS.archiveCompressLocal) as unknown as CompressLocalRequest
    const sourcePath = requireNonEmptyString(request.sourcePath, 'sourcePath', INVOKE_CHANNELS.archiveCompressLocal)
    const destPath = requireNonEmptyString(request.destPath, 'destPath', INVOKE_CHANNELS.archiveCompressLocal)
    return OperationRegistry.getInstance().run(
      {
        kind: 'compress-local',
        label: `Compressing ${path.basename(sourcePath)}`,
        cancellable: true
      },
      ({ signal, reportProgress }) =>
        CompressService.compressLocal(sourcePath, destPath, {
          signal,
          onProgress: (processed, total) => reportProgress(processed, total, 'bytes')
        })
    )
  })

  handle<UnzipResult>(INVOKE_CHANNELS.archiveCompressRemote, (req) => {
    const request = requireObject(req, INVOKE_CHANNELS.archiveCompressRemote) as unknown as CompressRemoteRequest
    const sessionId = requireNonEmptyString(request.sessionId, 'sessionId', INVOKE_CHANNELS.archiveCompressRemote)
    const sourcePath = requireNonEmptyString(request.sourcePath, 'sourcePath', INVOKE_CHANNELS.archiveCompressRemote)
    const destPath = requireNonEmptyString(request.destPath, 'destPath', INVOKE_CHANNELS.archiveCompressRemote)
    return OperationRegistry.getInstance().run(
      {
        kind: 'compress-remote',
        label: `Compressing ${path.posix.basename(sourcePath)}`,
        sessionId,
        cancellable: true
      },
      ({ signal }) => CompressService.compressRemote(sessionId, sourcePath, destPath, signal)
    )
  })
}

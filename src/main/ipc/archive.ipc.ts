import * as path from 'path'
import { handle } from './envelope'
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
    const request = req as CompressLocalRequest
    return OperationRegistry.getInstance().run(
      {
        kind: 'compress-local',
        label: `Compressing ${path.basename(request.sourcePath)}`,
        cancellable: true
      },
      ({ signal, reportProgress }) =>
        CompressService.compressLocal(request.sourcePath, request.destPath, {
          signal,
          onProgress: (processed, total) => reportProgress(processed, total, 'bytes')
        })
    )
  })

  handle<UnzipResult>(INVOKE_CHANNELS.archiveCompressRemote, (req) => {
    const request = req as CompressRemoteRequest
    return OperationRegistry.getInstance().run(
      {
        kind: 'compress-remote',
        label: `Compressing ${path.posix.basename(request.sourcePath)}`,
        sessionId: request.sessionId,
        cancellable: true
      },
      ({ signal }) => CompressService.compressRemote(request.sessionId, request.sourcePath, request.destPath, signal)
    )
  })
}

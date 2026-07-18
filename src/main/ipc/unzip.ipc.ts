import * as path from 'path'
import { handle } from './envelope'
import { INVOKE_CHANNELS, type UnzipResult } from '../../shared/contract'
import * as UnzipService from '../unzip/UnzipService'
import { OperationRegistry } from '../operations/OperationRegistry'

/** Request payload for `unzip:run`. */
interface UnzipRunRequest {
  sessionId: string
  archivePath: string
  targetDir: string
}

/** Registers the remote-unzip ("Extract Here") handler. */
export function registerUnzipHandlers(): void {
  handle<UnzipResult>(INVOKE_CHANNELS.unzipRun, async (req) => {
    const request = req as UnzipRunRequest
    return OperationRegistry.getInstance().run(
      {
        kind: 'extract-remote',
        label: `Extracting ${path.posix.basename(request.archivePath)}`,
        sessionId: request.sessionId,
        cancellable: true
      },
      ({ signal }) => UnzipService.extractRemote(request.sessionId, request.archivePath, request.targetDir, signal)
    )
  })
}

import * as path from 'path'
import { handle } from './envelope'
import { requireNonEmptyString, requireObject } from './validation'
import { INVOKE_CHANNELS, type UnzipResult, type UnzipRunRequest } from '../../shared/contract'
import * as UnzipService from '../unzip/UnzipService'
import { OperationRegistry } from '../operations/OperationRegistry'

/** Registers the remote-unzip ("Extract Here") handler. */
export function registerUnzipHandlers(): void {
  handle<UnzipResult>(INVOKE_CHANNELS.unzipRun, async (req) => {
    const request = requireObject(req, INVOKE_CHANNELS.unzipRun) as unknown as UnzipRunRequest
    const sessionId = requireNonEmptyString(request.sessionId, 'sessionId', INVOKE_CHANNELS.unzipRun)
    const archivePath = requireNonEmptyString(request.archivePath, 'archivePath', INVOKE_CHANNELS.unzipRun)
    const targetDir = requireNonEmptyString(request.targetDir, 'targetDir', INVOKE_CHANNELS.unzipRun)
    return OperationRegistry.getInstance().run(
      {
        kind: 'extract-remote',
        label: `Extracting ${path.posix.basename(archivePath)}`,
        sessionId,
        cancellable: true
      },
      ({ signal }) => UnzipService.extractRemote(sessionId, archivePath, targetDir, signal)
    )
  })
}

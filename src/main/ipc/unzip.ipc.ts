import { handle } from './envelope'
import { INVOKE_CHANNELS, type UnzipResult } from '../../shared/contract'
import * as UnzipService from '../unzip/UnzipService'

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
    return UnzipService.extractRemote(request.sessionId, request.archivePath, request.targetDir)
  })
}

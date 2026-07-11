import { handle } from './envelope'
import { INVOKE_CHANNELS, type UnzipResult } from '../../shared/contract'
import * as UnzipService from '../unzip/UnzipService'
import { ActivityLog } from '../activity/ActivityLog'

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
    ActivityLog.getInstance().emit('unzip-start', `Extracting ${request.archivePath}`, {
      sessionId: request.sessionId
    })
    try {
      const result = await UnzipService.extractRemote(request.sessionId, request.archivePath, request.targetDir)
      ActivityLog.getInstance().emit('unzip-done', `Extracted ${request.archivePath} to ${request.targetDir}`, {
        sessionId: request.sessionId
      })
      return result
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      ActivityLog.getInstance().emit('unzip-error', `Extract failed: ${message}`, {
        sessionId: request.sessionId,
        level: 'error'
      })
      throw e
    }
  })
}

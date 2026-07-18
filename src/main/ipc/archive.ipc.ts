import { handle } from './envelope'
import { INVOKE_CHANNELS, type UnzipResult } from '../../shared/contract'
import * as CompressService from '../archive/CompressService'

/** Request payload for `archive:compressLocal`. */
interface CompressLocalRequest {
  sourcePath: string
  destPath: string
}

/** Request payload for `archive:compressRemote`. */
interface CompressRemoteRequest {
  sessionId: string
  sourcePath: string
  destPath: string
}

/** Registers the "Compress to zip" (local + remote) handlers. */
export function registerArchiveHandlers(): void {
  handle<void>(INVOKE_CHANNELS.archiveCompressLocal, (req) => {
    const request = req as CompressLocalRequest
    return CompressService.compressLocal(request.sourcePath, request.destPath)
  })

  handle<UnzipResult>(INVOKE_CHANNELS.archiveCompressRemote, (req) => {
    const request = req as CompressRemoteRequest
    return CompressService.compressRemote(request.sessionId, request.sourcePath, request.destPath)
  })
}

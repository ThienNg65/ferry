import { handle } from './envelope'
import { INVOKE_CHANNELS } from '../../shared/contract'
import { MonitorManager } from '../monitor/MonitorManager'

/** Request payload for `monitor:start`. */
interface MonitorStartRequest {
  sessionId: string
  intervalMs?: number
}

/** Registers the remote resource monitor's start/stop handlers. */
export function registerMonitorHandlers(): void {
  handle<void>(INVOKE_CHANNELS.monitorStart, (req) => {
    const request = req as MonitorStartRequest
    MonitorManager.getInstance().start(request.sessionId, request.intervalMs)
  })
  handle<void>(INVOKE_CHANNELS.monitorStop, (sessionId) => {
    MonitorManager.getInstance().stop(sessionId as string)
  })
}

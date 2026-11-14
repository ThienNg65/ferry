import { handle } from './envelope'
import { requireNonEmptyString, requireObject } from './validation'
import { INVOKE_CHANNELS, type MonitorStartRequest } from '../../shared/contract'
import { MonitorManager } from '../monitor/MonitorManager'

/** Registers the remote resource monitor's start/stop handlers. */
export function registerMonitorHandlers(): void {
  handle<void>(INVOKE_CHANNELS.monitorStart, (req) => {
    const request = requireObject(req, INVOKE_CHANNELS.monitorStart) as unknown as MonitorStartRequest
    const sessionId = requireNonEmptyString(request.sessionId, 'sessionId', INVOKE_CHANNELS.monitorStart)
    MonitorManager.getInstance().start(sessionId, request.intervalMs)
  })
  handle<void>(INVOKE_CHANNELS.monitorStop, (sessionId) => {
    MonitorManager.getInstance().stop(requireNonEmptyString(sessionId, 'sessionId', INVOKE_CHANNELS.monitorStop))
  })
}

import { clearDiskUsageCache } from '../fs/RemoteFsService'
import { EditSessionManager } from '../edit/EditSessionManager'
import { MonitorManager } from '../monitor/MonitorManager'
import { OperationRegistry } from '../operations/OperationRegistry'
import { TailManager } from '../tail/TailManager'
import { TerminalManager } from '../terminal/TerminalManager'
import { SessionManager } from './SessionManager'

let registered = false

export function registerSessionTeardown(): void {
  if (registered) return
  registered = true
  const sessions = SessionManager.getInstance()
  sessions.onSessionClosed('pre', (id) => TailManager.getInstance().stopAllForSession(id))
  sessions.onSessionClosed('post', (id) => TerminalManager.getInstance().closeAllForSession(id))
  sessions.onSessionClosed('post', (id) => OperationRegistry.getInstance().cancelAllForSession(id))
  sessions.onSessionClosed('post', (id) => MonitorManager.getInstance().stopAllForSession(id))
  sessions.onSessionClosed('post', (id) => EditSessionManager.getInstance().closeAllForSession(id))
  sessions.onSessionClosed('post', (id) => clearDiskUsageCache(id))
}

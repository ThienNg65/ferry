import { TransferQueue, type TransferJob } from '../transfer/TransferQueue'
import { OperationRegistry } from '../operations/OperationRegistry'
import { SessionManager } from '../ssh/SessionManager'
import { SiteStore } from '../sites/SiteStore'
import { HistoryStore } from './HistoryStore'
import type { HistoryEntry, OperationEvent, TransferEvent } from '../../shared/contract'

function siteNameFor(sessionId: string | undefined): string | undefined {
  if (!sessionId) {
    return undefined
  }
  const siteId = SessionManager.getInstance().siteIdForSession(sessionId)
  return siteId ? SiteStore.getInstance().getRaw(siteId)?.name : undefined
}

function basename(fullPath: string): string {
  return fullPath.split(/[/\\]/).filter(Boolean).pop() ?? fullPath
}

function labelForTransfer(job: TransferJob): string {
  const verb = job.kind === 'upload' ? 'Upload' : 'Download'
  const name = basename(job.kind === 'upload' ? job.localPath : job.remotePath)
  return `${verb} ${name}`
}

let initialized = false

/**
 * Wires TransferQueue's and OperationRegistry's terminal (done/error/
 * cancelled) events into HistoryStore — call once at app bootstrap. Both
 * registries only ever invoke their `onTerminalEvent` listeners with an
 * already-terminal state (see their own `notifyTerminal` call sites), so
 * this never needs to filter out queued/started/progress events itself.
 */
export function initHistoryRecorder(): void {
  if (initialized) {
    return
  }
  initialized = true

  TransferQueue.getInstance().onTerminalEvent((job: TransferJob, evt: TransferEvent) => {
    const finishedAt = Date.now()
    HistoryStore.getInstance().record({
      kind: 'transfer',
      label: labelForTransfer(job),
      direction: job.kind,
      sessionId: job.sessionId,
      siteName: siteNameFor(job.sessionId),
      bytes: evt.bytesTransferred,
      startedAt: job.queuedAt,
      finishedAt,
      status: evt.state as HistoryEntry['status'],
      error: evt.error
    })
  })

  OperationRegistry.getInstance().onTerminalEvent((evt: OperationEvent) => {
    HistoryStore.getInstance().record({
      kind: 'operation',
      label: evt.label,
      operationKind: evt.kind,
      sessionId: evt.sessionId,
      siteName: siteNameFor(evt.sessionId),
      startedAt: evt.startedAt,
      finishedAt: Date.now(),
      status: evt.state as HistoryEntry['status'],
      error: evt.error
    })
  })
}

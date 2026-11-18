import type { Readable } from 'stream'
import { setHost } from '../main/host/host'
import { registerSidecarHandlers } from '../main/ipc/registerSidecar'
import { initHistoryRecorder } from '../main/history/HistoryRecorder'
import { HistoryStore } from '../main/history/HistoryStore'
import { EditSessionManager } from '../main/edit/EditSessionManager'
import { AppSettingsStore } from '../main/app/AppSettingsStore'
import { TransferQueue } from '../main/transfer/TransferQueue'
import { KnownHostsStore } from '../main/ssh/KnownHostsStore'
import { initAutoUpdater } from '../main/update/AutoUpdater'
import { registerUpdaterExitHandler } from '../main/update/SidecarUpdater'
import { cleanupAllStagedDrops } from '../main/fs/LocalFsService'
import { host } from '../main/host/host'
import { createNodeHost } from './nodeHost'
import { serve, type WriteLine } from './protocol'

export function initSidecarServices(): void {
  registerUpdaterExitHandler(requestSidecarShutdown)
  initHistoryRecorder()
  const settings = AppSettingsStore.getInstance().get()
  TransferQueue.getInstance().setBandwidthLimitKBps(settings.bandwidthLimitKBps)
  const retention = settings.historyRetentionDays === undefined ? 90 : settings.historyRetentionDays
  HistoryStore.getInstance().pruneExpired(retention)
  try {
    KnownHostsStore.getInstance()
  } catch (e) {
    console.error('sidecar: known_hosts.json unreadable at startup:', e)
  }
  void cleanupAllStagedDrops().catch(() => undefined)
  if (host().isPackaged && settings.termsAcceptance !== null) {
    setTimeout(() => void initAutoUpdater(), 5000).unref?.()
  }
}

export async function shutdownSidecarServices(): Promise<void> {
  HistoryStore.getInstance().flush()
  await EditSessionManager.getInstance().disposeAll()
  await cleanupAllStagedDrops().catch(() => undefined)
}

type ShutdownHandler = (code?: number) => Promise<void> | void
let shutdownHandler: ShutdownHandler | null = null

/** Registers the active runtime's shutdown handler so subsystems (e.g. auto-updater) can exit cleanly. */
export function registerShutdownHandler(handler: ShutdownHandler | null): void {
  shutdownHandler = handler
}

/** Triggers clean sidecar service disposal and process exit via the registered runtime handler. */
export async function requestSidecarShutdown(code = 0): Promise<void> {
  if (shutdownHandler) {
    await shutdownHandler(code)
    return
  }
  await shutdownSidecarServices().catch(() => undefined)
  process.exit(code)
}

export function startSidecar(input: Readable, write: WriteLine, exit: (code: number) => void): void {
  let ready = false
  let closing = false
  const runShutdown = async (code = 0): Promise<void> => {
    if (closing) {
      return
    }
    closing = true
    if (ready) {
      await shutdownSidecarServices()
    }
    exit(code)
  }
  registerShutdownHandler(runShutdown)
  registerSidecarHandlers()
  serve(input, write, {
    init({ key, dataDir }) {
      setHost(createNodeHost(Buffer.from(key, 'base64'), dataDir, write))
      ready = true
      initSidecarServices()
    },
    shutdown: () => runShutdown(0)
  })
}

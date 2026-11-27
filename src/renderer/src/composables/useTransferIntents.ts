import { ref } from 'vue'
import { INVOKE_CHANNELS, type FileEntry } from '@shared/contract'
import { invoke } from '../api'
import { useCompanionStore } from '../stores/companion.store'
import { useLocalFsStore } from '../stores/localFs.store'
import { useMonitorStore } from '../stores/monitor.store'
import { useRemoteFsStore } from '../stores/remoteFs.store'
import { useSessionsStore } from '../stores/sessions.store'
import { useTransferQueueStore } from '../stores/transferQueue.store'
import { evaluateTransferPreFlight } from '../utils/companionGuardrails'
import { resolveConflicts, type ConflictChoice } from '../utils/resolveConflicts'
import { useConfirm } from './useConfirm'
import { useNotify } from './useNotify'

export interface TransferIntent {
  sessionId: string
  direction: 'upload' | 'download'
  localPath: string
  remotePath: string
  isDir: boolean
  targetName: string
  sourceSize: number | null
  sourceModifiedAt: string | null
  createParents?: boolean
}

export function useTransferIntents() {
  const companion = useCompanionStore()
  const localFs = useLocalFsStore()
  const remoteFs = useRemoteFsStore()
  const sessions = useSessionsStore()
  const transfers = useTransferQueueStore()
  const monitor = useMonitorStore()
  const notify = useNotify()
  const confirm = useConfirm()

  const transferConflict = ref<{
    intents: TransferIntent[]
    targets: FileEntry[]
    conflicts: Array<{ intent: TransferIntent; target: FileEntry }>
  } | null>(null)

  function buildTransferIntent(sourceSide: 'local' | 'remote', entry: { path: string; name: string; isDir: boolean; size?: number; modifiedAt?: string | null }, sessionId: string, targetDir?: string): TransferIntent | null {
    if (entry.name.includes('/') || entry.name.includes('\\') || entry.name === '..' || entry.name === '.') {
      notify.error('Security Warning', 'Invalid file name detected. Transfer aborted.')
      return null
    }
    const source = { sourceSize: entry.size ?? null, sourceModifiedAt: entry.modifiedAt ?? null }
    if (sourceSide === 'local') {
      const remoteBase = targetDir ?? remoteFs.currentPath
      if (!remoteBase) {
        return null
      }
      const remoteTarget = `${remoteBase.replace(/\/+$/, '')}/${entry.name}`
      return { sessionId, direction: 'upload', localPath: entry.path, remotePath: remoteTarget, isDir: entry.isDir, targetName: entry.name, ...source }
    } else {
      const localBase = targetDir ?? localFs.currentPath
      if (!localBase) {
        return null
      }
      const localDir = localBase.replace(/[/\\]+$/, '')
      const sep = localBase.includes('\\') ? '\\' : '/'
      const localTarget = `${localDir}${sep}${entry.name}`
      return { sessionId, direction: 'download', localPath: localTarget, remotePath: entry.path, isDir: entry.isDir, targetName: entry.name, ...source }
    }
  }

  async function checkAndQueueTransfers(intents: TransferIntent[], targetStore: { entries: FileEntry[] }): Promise<void> {
    const conflicts: Array<{ intent: TransferIntent; target: FileEntry }> = []
    for (const intent of intents) {
      const caseInsensitive = intent.direction === 'download' && intent.localPath.includes('\\')
      const needle = caseInsensitive ? intent.targetName.toLowerCase() : intent.targetName
      const target = targetStore.entries.find((e) => (caseInsensitive ? e.name.toLowerCase() : e.name) === needle)
      if (target) {
        conflicts.push({ intent, target })
      }
    }
    if (conflicts.length > 0) {
      if (transferConflict.value) {
        cleanupUnusedStagedPaths(transferConflict.value.intents, [])
      }
      transferConflict.value = { intents, targets: [...targetStore.entries], conflicts }
      return
    }
    await enqueueIntents(intents)
  }

  async function enqueueIntents(intents: TransferIntent[]): Promise<void> {
    if (intents.length === 0) return
    const preFlight = evaluateTransferPreFlight(intents, monitor.latest?.disk)
    if (preFlight.warnings.length > 0 && !companion.quietMode) {
      const proceed = await confirm({
        title: 'Ferry Companion — Pre-Flight Safety Check',
        body: preFlight.warnings.join('\n\n'),
        items: preFlight.sensitiveFiles.length > 0 ? preFlight.sensitiveFiles : undefined,
        confirmLabel: 'Transfer anyway',
        confirmColor: 'warning'
      })
      if (!proceed) {
        cleanupUnusedStagedPaths(intents, [])
        return
      }
    }
    for (const intent of intents) {
      await transfers.enqueue(intent.sessionId, intent.direction, intent.localPath, intent.remotePath, intent.isDir, intent.createParents)
    }
  }

  function cleanupUnusedStagedPaths(allIntents: TransferIntent[], keptIntents: TransferIntent[]): void {
    const keptPaths = new Set(keptIntents.map((i) => i.localPath))
    const unusedPaths = allIntents
      .filter((i) => i.direction === 'upload' && !keptPaths.has(i.localPath))
      .map((i) => i.localPath)
    if (unusedPaths.length > 0) {
      void invoke<void>(INVOKE_CHANNELS.fsLocalCleanupStagedDrop, { paths: unusedPaths }).catch(() => undefined)
    }
  }

  function dismissTransferConflict(): void {
    const conflict = transferConflict.value
    if (!conflict) return
    transferConflict.value = null
    cleanupUnusedStagedPaths(conflict.intents, [])
  }

  async function resolveTransferConflict(choice: ConflictChoice): Promise<void> {
    const conflict = transferConflict.value
    if (!conflict) return
    transferConflict.value = null
    const resolved = resolveConflicts(conflict.intents, conflict.targets, choice)
    cleanupUnusedStagedPaths(conflict.intents, resolved)
    await enqueueIntents(resolved)
  }

  /** Uploads or downloads `entry`, which belongs to `sourceSide`, into the other pane's current directory. */
  async function transferEntry(sourceSide: 'local' | 'remote', entry: FileEntry): Promise<void> {
    const sessionId = sessions.activeSessionId
    if (!sessionId) return
    const intent = buildTransferIntent(sourceSide, entry, sessionId)
    if (!intent) return
    const targetStore = sourceSide === 'local' ? remoteFs : localFs
    await checkAndQueueTransfers([intent], targetStore)
  }


  return {
    transferConflict,
    buildTransferIntent,
    checkAndQueueTransfers,
    enqueueIntents,
    dismissTransferConflict,
    resolveTransferConflict,
    transferEntry
  }
}

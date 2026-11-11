import { ref } from 'vue'
import type { FileEntry } from '@shared/contract'
import { useLocalFsStore } from '../stores/localFs.store'
import { useRemoteFsStore } from '../stores/remoteFs.store'
import { useSessionsStore } from '../stores/sessions.store'
import { useTransferQueueStore } from '../stores/transferQueue.store'
import { resolveConflicts, type ConflictChoice } from '../utils/resolveConflicts'
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
}

export function useTransferIntents() {
  const localFs = useLocalFsStore()
  const remoteFs = useRemoteFsStore()
  const sessions = useSessionsStore()
  const transfers = useTransferQueueStore()
  const notify = useNotify()

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
      const remoteTarget = `${(targetDir ?? remoteFs.currentPath).replace(/\/$/, '')}/${entry.name}`
      return { sessionId, direction: 'upload', localPath: entry.path, remotePath: remoteTarget, isDir: entry.isDir, targetName: entry.name, ...source }
    } else {
      const localBase = targetDir ?? localFs.currentPath
      const localDir = localBase.replace(/[/\\]$/, '')
      const sep = localBase.includes('\\') ? '\\' : '/'
      const localTarget = `${localDir}${sep}${entry.name}`
      return { sessionId, direction: 'download', localPath: localTarget, remotePath: entry.path, isDir: entry.isDir, targetName: entry.name, ...source }
    }
  }

  async function checkAndQueueTransfers(intents: TransferIntent[], targetStore: { entries: FileEntry[] }): Promise<void> {
    const conflicts: Array<{ intent: TransferIntent; target: FileEntry }> = []
    for (const intent of intents) {
      const target = targetStore.entries.find((e) => e.name === intent.targetName)
      if (target) {
        conflicts.push({ intent, target })
      }
    }
    if (conflicts.length > 0) {
      transferConflict.value = { intents, targets: [...targetStore.entries], conflicts }
      return
    }
    await enqueueIntents(intents)
  }

  async function enqueueIntents(intents: TransferIntent[]): Promise<void> {
    for (const intent of intents) {
      await transfers.enqueue(intent.sessionId, intent.direction, intent.localPath, intent.remotePath, intent.isDir)
    }
  }

  async function resolveTransferConflict(choice: ConflictChoice): Promise<void> {
    const conflict = transferConflict.value
    if (!conflict) return
    transferConflict.value = null
    await enqueueIntents(resolveConflicts(conflict.intents, conflict.targets, choice))
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
    resolveTransferConflict,
    transferEntry
  }
}

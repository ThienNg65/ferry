import { computed } from 'vue'
import { useSessionsStore } from '../stores/sessions.store'
import { useTransferQueueStore } from '../stores/transferQueue.store'
import { useRemoteFsStore } from '../stores/remoteFs.store'
import { useLocalFsStore } from '../stores/localFs.store'
import { useIpcActivityStore } from '../stores/ipcActivity.store'
import { useOperationsStore } from '../stores/operations.store'

const BUSY_TRANSFER_STATES = new Set(['queued', 'started', 'progress'])

/**
 * Aggregates every source of "something is happening" into one busy flag +
 * label, for the title-bar indicator. `isBusy` is driven by the generic
 * in-flight IPC counter (`ipcActivity.store.ts`, via `api.ts`'s `invoke()`),
 * so it covers every current and future operation automatically — extract,
 * mkdir, delete, tail-open, terminal-open, site CRUD, etc., not just the few
 * sources below. Those specific sources exist only to produce a nicer LABEL
 * when they're the actual reason; anything else falls back to "Working…".
 */
export function useGlobalActivity() {
  const ipcActivity = useIpcActivityStore()
  const sessions = useSessionsStore()
  const transfers = useTransferQueueStore()
  const remoteFs = useRemoteFsStore()
  const localFs = useLocalFsStore()
  const operations = useOperationsStore()

  const isConnecting = computed(() => sessions.tabs.some((t) => t.connecting))
  const activeTransferCount = computed(
    () => transfers.list.filter((t) => BUSY_TRANSFER_STATES.has(t.state)).length
  )
  const isBusy = computed(() => ipcActivity.isBusy || isConnecting.value || activeTransferCount.value > 0)
  const label = computed(() => {
    if (!isBusy.value) {
      return ''
    }
    if (isConnecting.value) {
      return 'Connecting…'
    }
    if (activeTransferCount.value > 0) {
      return `${activeTransferCount.value} transfer${activeTransferCount.value > 1 ? 's' : ''} in progress`
    }
    if (operations.firstRunningLabel) {
      return operations.firstRunningLabel
    }
    if (remoteFs.loading || localFs.loading) {
      return 'Loading directory…'
    }
    return 'Working…'
  })

  return { isBusy, label }
}

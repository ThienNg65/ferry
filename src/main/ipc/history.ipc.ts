import { handle } from './envelope'
import { INVOKE_CHANNELS, type HistoryEntry, type HistoryQuery } from '../../shared/contract'
import { HistoryStore } from '../history/HistoryStore'

/** Registers read/clear handlers for persisted transfer/operation history — populated by HistoryRecorder, not written to here. */
export function registerHistoryHandlers(): void {
  handle<HistoryEntry[]>(INVOKE_CHANNELS.historyList, (query) => {
    return HistoryStore.getInstance().list(query as HistoryQuery | undefined)
  })

  handle<void>(INVOKE_CHANNELS.historyClear, () => {
    HistoryStore.getInstance().clear()
  })
}

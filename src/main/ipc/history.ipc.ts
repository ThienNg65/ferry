import { handle } from './envelope'
import { failValidation, optionalString, requireEnum, requireObject } from './validation'
import { INVOKE_CHANNELS, type HistoryEntry, type HistoryQuery } from '../../shared/contract'
import { HistoryStore } from '../history/HistoryStore'

const HISTORY_STATUSES: readonly NonNullable<HistoryQuery['status']>[] = ['done', 'error', 'cancelled']

function validateHistoryQuery(query: unknown): HistoryQuery | undefined {
  if (query === undefined) {
    return undefined
  }
  const obj = requireObject(query, INVOKE_CHANNELS.historyList)
  if (obj.status !== undefined) {
    requireEnum(obj.status, HISTORY_STATUSES, 'status', INVOKE_CHANNELS.historyList)
  }
  if (obj.search !== undefined) {
    optionalString(obj.search, 'search', INVOKE_CHANNELS.historyList)
  }
  if (obj.limit !== undefined) {
    if (typeof obj.limit !== 'number' || !Number.isInteger(obj.limit) || obj.limit < 1) {
      failValidation(INVOKE_CHANNELS.historyList, `${INVOKE_CHANNELS.historyList} requires "limit" to be a positive integer`)
    }
  }
  return obj as HistoryQuery
}

/** Registers read/clear handlers for persisted transfer/operation history — populated by HistoryRecorder, not written to here. */
export function registerHistoryHandlers(): void {
  handle<HistoryEntry[]>(INVOKE_CHANNELS.historyList, (query) => {
    return HistoryStore.getInstance().list(validateHistoryQuery(query))
  })

  handle<void>(INVOKE_CHANNELS.historyClear, () => {
    HistoryStore.getInstance().clear()
  })
}

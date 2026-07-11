import { handle } from './envelope'
import { INVOKE_CHANNELS, type ActivityEntry } from '../../shared/contract'
import { ActivityLog } from '../activity/ActivityLog'

/** Registers the activity-log history backfill handler. */
export function registerActivityHandlers(): void {
  handle<ActivityEntry[]>(INVOKE_CHANNELS.activityHistory, () => {
    return ActivityLog.getInstance().history()
  })
}

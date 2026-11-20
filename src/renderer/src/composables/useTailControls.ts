import { shallowRef } from 'vue'
import type { TailStreamStatus } from '../stores/tailStreams.store'

export interface TailControls {
  tailId: string
  status: TailStreamStatus
  ended: boolean
  error: string | undefined
  autoScroll: boolean
  newLinesCount: number
  linesPerSec: number
  visibleCount: number
  totalCount: number
  bufferPct: number
  maxLines: number
  restarting: boolean
  menuItems: unknown[][]
  toggleAutoScroll: () => void
  restart: () => void
}

/** The visible tail viewer publishes its status and actions here; the dock's tab strip renders them. */
export const tailControls = shallowRef<TailControls | null>(null)

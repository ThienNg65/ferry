<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTailStreamsStore } from '../../stores/tailStreams.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useTransferQueueStore } from '../../stores/transferQueue.store'
import { useOperationsStore } from '../../stores/operations.store'
import { useUiStore } from '../../stores/ui.store'
import { useEditSessionsStore } from '../../stores/editSessions.store'
import { useDockState, type DockTab } from '../../composables/useDockState'
import { MIN_DOCK_HEIGHT, clampDockHeight } from '../../stores/ui.store'
import { onTablistKeydown } from '../../utils/tablistKeys'
import TransferQueue from '../transfers/TransferQueue.vue'
import LogTailViewer from '../logs/LogTailViewer.vue'
import TerminalView from '../terminal/TerminalView.vue'
import ActivityPanel from '../activity/ActivityPanel.vue'
import MonitorPanel from '../monitor/MonitorPanel.vue'
import OpenEditsPanel from '../edits/OpenEditsPanel.vue'

const tailStreams = useTailStreamsStore()
const sessions = useSessionsStore()
const transfers = useTransferQueueStore()
const operations = useOperationsStore()
const ui = useUiStore()
const editSessions = useEditSessionsStore()

// Dock open/tab state is shared via useDockState so other components (e.g.
// the TitleBar busy indicator) can open the dock on a specific tab.
const { collapsed, tab, terminalEverShown, isMaximized, openDock } = useDockState()
const terminalActive = computed(() => !collapsed.value && tab.value === 'terminal')

// The dock starts collapsed; a newly queued transfer opens it on Transfers.
watch(
  () => transfers.items.size,
  (size, prev) => {
    if (size > prev && collapsed.value) {
      openDock('transfers')
    }
  }
)

/** Clicking an already-open dock tab collapses the dock; clicking any tab while collapsed expands to it. */
function onTabClick(target: DockTab): void {
  if (!collapsed.value && tab.value === target) {
    collapsed.value = true
    return
  }
  openDock(target)
}

const COLLAPSED_HEIGHT = 36

// Drag-to-resize: liveHeight tracks the drag in real time (bound directly to
// the container's inline style) so localStorage only gets written once, at
// drag-end, rather than on every pointermove. ui.dockHeight is the persisted
// value read/written outside a drag.
const dragging = ref(false)
const liveHeight = ref(ui.dockHeight)
let dragStartY = 0
let dragStartHeight = 0
let dragRaf: number | null = null
let latestPointerY = 0

function onResizeStart(e: PointerEvent): void {
  isMaximized.value = false
  dragging.value = true
  dragStartY = e.clientY
  latestPointerY = e.clientY
  dragStartHeight = ui.dockHeight
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}

function onResizeMove(e: PointerEvent): void {
  if (!dragging.value) {
    return
  }
  latestPointerY = e.clientY
  if (dragRaf !== null) {
    return
  }
  dragRaf = requestAnimationFrame(() => {
    dragRaf = null
    if (!dragging.value) return
    // Dragging the handle up should make the dock taller.
    liveHeight.value = clampDockHeight(dragStartHeight + (dragStartY - latestPointerY), window.innerHeight)
  })
}

function onResizeEnd(e: PointerEvent): void {
  if (!dragging.value) {
    return
  }
  if (dragRaf !== null) {
    cancelAnimationFrame(dragRaf)
    dragRaf = null
  }
  dragging.value = false
  ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  liveHeight.value = clampDockHeight(dragStartHeight + (dragStartY - latestPointerY), window.innerHeight)
  ui.setDockHeight(liveHeight.value)
  liveHeight.value = ui.dockHeight
}

function setHeight(px: number): void {
  isMaximized.value = false
  ui.setDockHeight(px)
  liveHeight.value = ui.dockHeight
}

function onResizeKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    setHeight(clampDockHeight(ui.dockHeight + (e.key === 'ArrowUp' ? 16 : -16), window.innerHeight))
  }
}

function resetHeight(): void {
  setHeight(MIN_DOCK_HEIGHT)
}

function onWindowResize(): void {
  ui.setDockHeight(ui.dockHeight)
  liveHeight.value = ui.dockHeight
}

onMounted(() => window.addEventListener('resize', onWindowResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  if (dragRaf !== null) {
    cancelAnimationFrame(dragRaf)
    dragRaf = null
  }
})

const isFullHeight = computed(() => !collapsed.value && isMaximized.value)
const dockHeightPx = computed(() => (collapsed.value ? COLLAPSED_HEIGHT : liveHeight.value))

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function sessionLabel(sessionId: string): string | null {
  const tab = sessions.tabs.find((t) => t.sessionId === sessionId)
  return tab?.label ?? tab?.hostLabel ?? null
}
</script>

<template>
  <div
    class="ferry-dock-shell flex flex-col overflow-hidden border-t border-default"
    :class="[isFullHeight ? 'min-h-0 flex-1' : 'shrink-0', dragging || isMaximized ? '' : 'ferry-dock-expandable']"
    :style="isFullHeight ? undefined : { height: `${dockHeightPx}px` }"
  >
    <div
      v-if="!collapsed && !isMaximized"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize dock"
      tabindex="0"
      :aria-valuenow="liveHeight"
      :aria-valuemin="MIN_DOCK_HEIGHT"
      class="h-1.5 shrink-0 cursor-row-resize hover:bg-primary/50 focus-visible:bg-primary/50 focus-visible:outline-none transition-colors"
      :class="dragging ? 'bg-primary' : ''"
      @keydown="onResizeKey"
      @dblclick="resetHeight"
      @pointerdown="onResizeStart"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
    />
    <div
      class="flex items-center justify-between bg-muted px-2 py-1 select-none"
      @dblclick.self="collapsed = !collapsed"
    >
      <div class="flex items-center gap-1" role="tablist" aria-label="Dock panels" @keydown="onTablistKeydown($event)">
        <UChip :text="transfers.activeCount" :show="transfers.activeCount > 0" size="lg" color="primary">
          <UButton
            class="ferry-dock-tab"
            label="Transfers"
            role="tab"
            :aria-selected="!collapsed && tab === 'transfers'"
            size="xs"
            :color="!collapsed && tab === 'transfers' ? 'primary' : 'neutral'"
            :variant="!collapsed && tab === 'transfers' ? 'soft' : 'ghost'"
            @click="onTabClick('transfers')"
          />
        </UChip>
        <UChip :text="operations.runningCount" :show="operations.runningCount > 0" size="lg" color="primary">
          <UButton
            class="ferry-dock-tab"
            label="Activity"
            role="tab"
            :aria-selected="!collapsed && tab === 'activity'"
            size="xs"
            :color="!collapsed && tab === 'activity' ? 'primary' : 'neutral'"
            :variant="!collapsed && tab === 'activity' ? 'soft' : 'ghost'"
            @click="onTabClick('activity')"
          />
        </UChip>
        <UChip :text="tailStreams.tabs.length" :show="tailStreams.tabs.length > 0" size="lg" color="primary">
          <UButton
            class="ferry-dock-tab"
            label="Log Tail"
            role="tab"
            :aria-selected="!collapsed && tab === 'tail'"
            size="xs"
            :color="!collapsed && tab === 'tail' ? 'primary' : 'neutral'"
            :variant="!collapsed && tab === 'tail' ? 'soft' : 'ghost'"
            @click="onTabClick('tail')"
          />
        </UChip>
        <UButton
          class="ferry-dock-tab"
            label="Terminal"
          role="tab"
          :aria-selected="!collapsed && tab === 'terminal'"
          size="xs"
          :color="!collapsed && tab === 'terminal' ? 'primary' : 'neutral'"
          :variant="!collapsed && tab === 'terminal' ? 'soft' : 'ghost'"
          @click="onTabClick('terminal')"
        />
        <UButton
          class="ferry-dock-tab"
            label="Monitor"
          role="tab"
          :aria-selected="!collapsed && tab === 'monitor'"
          size="xs"
          :color="!collapsed && tab === 'monitor' ? 'primary' : 'neutral'"
          :variant="!collapsed && tab === 'monitor' ? 'soft' : 'ghost'"
          @click="onTabClick('monitor')"
        />
        <UChip :text="editSessions.activeCount" :show="editSessions.activeCount > 0" size="lg" color="primary">
          <UButton
            class="ferry-dock-tab"
            label="Edits"
            role="tab"
            :aria-selected="!collapsed && tab === 'edits'"
            size="xs"
            :color="!collapsed && tab === 'edits' ? 'primary' : 'neutral'"
            :variant="!collapsed && tab === 'edits' ? 'soft' : 'ghost'"
            @click="onTabClick('edits')"
          />
        </UChip>
      </div>
      <UTooltip :text="collapsed ? 'Expand dock' : 'Collapse dock'">
        <UButton
          :icon="collapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="collapsed ? 'Expand dock' : 'Collapse dock'"
          @click="collapsed = !collapsed"
        />
      </UTooltip>
    </div>
    <Transition name="dock-fade">
      <div v-if="!collapsed && tab !== 'terminal'" class="flex min-h-0 flex-1 flex-col border-t border-muted">
        <Transition name="dock-panel" mode="out-in">
          <TransferQueue v-if="tab === 'transfers'" />
          <ActivityPanel v-else-if="tab === 'activity'" />
          <MonitorPanel v-else-if="tab === 'monitor'" />
          <OpenEditsPanel v-else-if="tab === 'edits'" />
          <div v-else-if="tab === 'tail'" class="flex min-h-0 flex-1 flex-col">
            <!-- Tail Tabs Header Bar -->
          <div v-if="tailStreams.tabs.length > 0" class="flex items-center justify-between border-b border-muted bg-muted/30 px-2 py-1">
            <div class="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1 min-w-0" role="tablist" aria-label="Open log tails" @keydown="onTablistKeydown($event, true)">
              <div
                v-for="openTail in tailStreams.tabs"
                :key="openTail.tailId"
                role="tab"
                :aria-selected="tailStreams.activeTailId === openTail.tailId"
                :tabindex="tailStreams.activeTailId === openTail.tailId ? 0 : -1"
                class="group flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs cursor-pointer border transition-all"
                :class="
                  tailStreams.activeTailId === openTail.tailId
                    ? 'bg-default border-default text-default font-medium shadow-xs ring-1 ring-primary/20'
                    : 'border-transparent text-muted hover:bg-muted/60 hover:text-default'
                "
                @click="tailStreams.activeTailId = openTail.tailId"
                @keydown.enter.self="tailStreams.activeTailId = openTail.tailId"
                @keydown.space.self.prevent="tailStreams.activeTailId = openTail.tailId"
                @auxclick.middle.prevent="tailStreams.close(openTail.tailId)"
              >
                <!-- Live status indicator dot -->
                <span
                  v-if="!tailStreams.endedMap[openTail.tailId] && !tailStreams.errorMap[openTail.tailId]"
                  class="relative flex size-2 shrink-0"
                >
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
                  <span class="relative inline-flex size-2 rounded-full bg-success" />
                </span>
                <span
                  v-else-if="tailStreams.errorMap[openTail.tailId]"
                  class="size-2 rounded-full bg-error shrink-0"
                />
                <span
                  v-else
                  class="size-2 rounded-full bg-warning shrink-0"
                />

                <UIcon name="i-lucide-file-text" class="size-3.5 shrink-0 opacity-70 group-hover:opacity-100" />

                <UTooltip :text="`${openTail.remotePath} (${(tailStreams.linesMap[openTail.tailId]?.length || 0).toLocaleString()} lines)`">
                  <span class="max-w-[150px] truncate select-none">
                    {{ basename(openTail.remotePath) }}
                  </span>
                </UTooltip>

                <span
                  v-if="sessions.tabs.length > 1 && sessionLabel(openTail.sessionId)"
                  class="hidden sm:inline-block max-w-[90px] truncate rounded bg-muted px-1 py-0.2 text-[10px] font-mono text-dimmed"
                >
                  {{ sessionLabel(openTail.sessionId) }}
                </span>

                <!-- Unread badge if inactive tab has incoming lines -->
                <span
                  v-if="tailStreams.unreadMap[openTail.tailId] && tailStreams.activeTailId !== openTail.tailId"
                  class="rounded-full bg-primary/20 px-1 py-0.2 text-2xs font-mono font-bold text-primary"
                >
                  +{{ tailStreams.unreadMap[openTail.tailId] }}
                </span>

                <UTooltip text="Close tab (Middle-click)">
                  <button
                    type="button"
                    class="rounded p-0.5 text-muted opacity-60 hover:opacity-100 hover:bg-muted transition-opacity cursor-pointer"
                    @click.stop="tailStreams.close(openTail.tailId)"
                  >
                    <UIcon name="i-lucide-x" class="size-3" />
                  </button>
                </UTooltip>
              </div>
            </div>

            <div v-if="tailStreams.tabs.length > 1" class="shrink-0 pl-2 flex items-center gap-1">
              <UTooltip text="Close other tabs">
                <UButton
                  aria-label="Close other tabs"
                  icon="i-lucide-list-x"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="tailStreams.activeTailId && tailStreams.closeOthers(tailStreams.activeTailId)"
                />
              </UTooltip>
              <UTooltip text="Close all tail tabs">
                <UButton
                  aria-label="Close all tail tabs"
                  icon="i-lucide-x-circle"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="tailStreams.closeAll()"
                />
              </UTooltip>
            </div>
          </div>

          <div class="min-h-0 flex-1">
            <LogTailViewer
              v-if="tailStreams.activeTailId"
              :key="tailStreams.activeTailId"
              :tail-id="tailStreams.activeTailId"
            />
            <div v-else class="flex h-full flex-col items-center justify-center gap-2 px-3 py-6 text-center select-none">
              <div class="rounded-full bg-muted/60 p-3 ring-1 ring-default/20">
                <UIcon name="i-lucide-scroll-text" class="size-6 text-muted" />
              </div>
              <p class="text-xs font-semibold text-default">No active log streams</p>
              <p class="text-2xs text-muted max-w-sm">
                Right-click any log or text file in the Remote file pane and select <span class="font-medium text-default">"Tail this file live"</span> to stream real-time output.
              </p>
            </div>
          </div>
          </div>
        </Transition>
      </div>
    </Transition>
    <div v-show="terminalActive" class="flex min-h-0 flex-1 flex-col border-t border-muted">
      <TerminalView v-if="terminalEverShown" :active="terminalActive" />
    </div>
  </div>
</template>

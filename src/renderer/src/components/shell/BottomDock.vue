<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTailStreamsStore } from '../../stores/tailStreams.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useTransferQueueStore } from '../../stores/transferQueue.store'
import { useOperationsStore } from '../../stores/operations.store'
import {
  DEFAULT_DOCK_WIDTH,
  MIN_DOCK_HEIGHT,
  MIN_DOCK_WIDTH,
  clampDockHeight,
  clampDockWidth,
  useUiStore
} from '../../stores/ui.store'
import { useEditSessionsStore } from '../../stores/editSessions.store'
import { TERMINAL_SEARCH_EVENT } from '../../stores/terminalStreams.store'
import { useDockState, type DockTab } from '../../composables/useDockState'
import { onTablistKeydown } from '../../utils/tablistKeys'
import TransferQueue from '../transfers/TransferQueue.vue'
import LogTailViewer from '../logs/LogTailViewer.vue'
import LogTailControls from '../logs/LogTailControls.vue'
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
const { collapsed, tab, terminalEverShown, isMaximized, openDock, toggleMaximize } = useDockState()
const terminalActive = computed(() => !collapsed.value && tab.value === 'terminal')
const tailActive = computed(() => !collapsed.value && tab.value === 'tail')
const tailMounted = computed(() => tailStreams.tabs.length > 0 || (tailStreams.openingCount ?? 0) > 0 || tailActive.value)

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

const COLLAPSED_SIZE = 36
const isRight = computed(() => ui.dockPosition === 'right')

const dockTabs = computed(() => [
  { id: 'transfers' as const, label: 'Transfers', icon: 'i-lucide-arrow-up-down', tooltip: 'File transfers', badge: transfers.activeCount },
  { id: 'activity' as const, label: 'Activity', icon: 'i-lucide-list-checks', tooltip: 'Background operations', badge: operations.runningCount },
  { id: 'tail' as const, label: 'Log Tail', icon: 'i-lucide-scroll-text', tooltip: 'Live remote log tail', badge: tailStreams.tabs.length },
  { id: 'terminal' as const, label: 'Terminal', icon: 'i-lucide-terminal', tooltip: 'Terminal (Ctrl+`)', badge: 0 },
  { id: 'monitor' as const, label: 'Monitor', icon: 'i-lucide-activity', tooltip: 'Remote resource monitor', badge: 0 },
  { id: 'edits' as const, label: 'Edits', icon: 'i-lucide-file-pen', tooltip: 'External file edits', badge: editSessions.activeCount }
])

// Drag-to-resize: liveHeight / liveWidth track the drag in real time (bound
// directly to the container's inline style) so localStorage only gets written
// once, at drag-end, rather than on every pointermove.
const dragging = ref(false)
const liveHeight = ref(ui.dockHeight)
const liveWidth = ref(ui.dockWidth)
let dragStartY = 0
let dragStartX = 0
let dragStartHeight = 0
let dragStartWidth = 0
let dragRaf: number | null = null
let latestPointerY = 0
let latestPointerX = 0

function onResizeStart(e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  isMaximized.value = false
  dragging.value = true
  dragStartY = e.clientY
  dragStartX = e.clientX
  latestPointerY = e.clientY
  latestPointerX = e.clientX
  dragStartHeight = ui.dockHeight
  dragStartWidth = ui.dockWidth
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
  window.addEventListener('pointercancel', onResizeEnd)
}

function onResizeMove(e: PointerEvent): void {
  if (!dragging.value) {
    return
  }
  latestPointerY = e.clientY
  latestPointerX = e.clientX
  if (dragRaf !== null) {
    return
  }
  dragRaf = requestAnimationFrame(() => {
    dragRaf = null
    if (!dragging.value) return
    if (isRight.value) {
      // Dragging the left handle further left makes the right dock wider.
      liveWidth.value = clampDockWidth(dragStartWidth + (dragStartX - latestPointerX), window.innerWidth)
    } else {
      // Dragging the handle up makes the bottom dock taller.
      liveHeight.value = clampDockHeight(dragStartHeight + (dragStartY - latestPointerY), window.innerHeight)
    }
  })
}

function detachResizeListeners(): void {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  window.removeEventListener('pointercancel', onResizeEnd)
}

function onResizeEnd(): void {
  if (!dragging.value) {
    return
  }
  if (dragRaf !== null) {
    cancelAnimationFrame(dragRaf)
    dragRaf = null
  }
  dragging.value = false
  detachResizeListeners()
  if (isRight.value) {
    liveWidth.value = clampDockWidth(dragStartWidth + (dragStartX - latestPointerX), window.innerWidth)
    ui.setDockWidth(liveWidth.value)
    liveWidth.value = ui.dockWidth
  } else {
    liveHeight.value = clampDockHeight(dragStartHeight + (dragStartY - latestPointerY), window.innerHeight)
    ui.setDockHeight(liveHeight.value)
    liveHeight.value = ui.dockHeight
  }
}

function setHeight(px: number): void {
  isMaximized.value = false
  ui.setDockHeight(px)
  liveHeight.value = ui.dockHeight
}

function setWidth(px: number): void {
  isMaximized.value = false
  ui.setDockWidth(px)
  liveWidth.value = ui.dockWidth
}

function onResizeKey(e: KeyboardEvent): void {
  if (isRight.value) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      setWidth(clampDockWidth(ui.dockWidth + (e.key === 'ArrowLeft' ? 16 : -16), window.innerWidth))
    }
    return
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    setHeight(clampDockHeight(ui.dockHeight + (e.key === 'ArrowUp' ? 16 : -16), window.innerHeight))
  }
}

function resetSize(): void {
  if (isRight.value) {
    setWidth(DEFAULT_DOCK_WIDTH)
  } else {
    setHeight(MIN_DOCK_HEIGHT)
  }
}

function onWindowResize(): void {
  ui.setDockHeight(ui.dockHeight)
  liveHeight.value = ui.dockHeight
  ui.setDockWidth(ui.dockWidth)
  liveWidth.value = ui.dockWidth
  if (isMaximized.value) measureMax()
}

onMounted(() => window.addEventListener('resize', onWindowResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  detachResizeListeners()
  if (dragRaf !== null) {
    cancelAnimationFrame(dragRaf)
    dragRaf = null
  }
})

// Maximize animates to a measured pixel size (everything the dock and its growing siblings share),
// so it eases like a normal resize instead of snapping to `flex: 1`.
const dockEl = ref<HTMLElement | null>(null)
const maxPx = ref(0)

function measureMax(): void {
  const el = dockEl.value
  const parent = el?.parentElement
  if (!el || !parent) return
  const horizontal = isRight.value
  let available = horizontal ? parent.clientWidth : parent.clientHeight
  for (const child of Array.from(parent.children)) {
    if (child !== el && !(Number.parseFloat(getComputedStyle(child).flexGrow) > 0)) {
      available -= horizontal ? (child as HTMLElement).offsetWidth : (child as HTMLElement).offsetHeight
    }
  }
  maxPx.value = Math.max(0, available)
}

watch(isMaximized, (on) => {
  if (on) measureMax()
}, { flush: 'pre' })

watch(isRight, () => {
  if (isMaximized.value) {
    void nextTick(measureMax)
  }
})

function onDockKeydown(e: KeyboardEvent): void {
  // Esc restores a maximized dock; the terminal keeps Esc for the shell.
  if (e.key !== 'Escape' || e.defaultPrevented || !isMaximized.value || tab.value === 'terminal') return
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return
  isMaximized.value = false
}

const dockSizePx = computed(() => {
  if (collapsed.value) return COLLAPSED_SIZE
  if (isMaximized.value) {
    return maxPx.value || Math.round((isRight.value ? window.innerWidth : window.innerHeight) * 0.8)
  }
  return isRight.value ? liveWidth.value : liveHeight.value
})

const dockShellStyle = computed(() =>
  isRight.value ? { width: `${dockSizePx.value}px` } : { height: `${dockSizePx.value}px` }
)

const compactRightTabs = computed(() => isRight.value && !isMaximized.value && liveWidth.value < 500)

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function sessionLabel(sessionId: string): string | null {
  const tab = sessions.tabs.find((t) => t.sessionId === sessionId)
  return tab?.label ?? tab?.hostLabel ?? null
}

function openTerminalSearch(): void {
  window.dispatchEvent(new CustomEvent(TERMINAL_SEARCH_EVENT))
}

function onTabStripWheel(e: WheelEvent): void {
  const el = e.currentTarget as HTMLElement | null
  if (!el || el.scrollWidth <= el.clientWidth || e.deltaY === 0) return
  el.scrollLeft += e.deltaY
  e.preventDefault()
}
</script>

<template>
  <div
    ref="dockEl"
    class="ferry-dock-shell flex shrink-0 overflow-hidden border-default"
    :class="[
      dragging || tab === 'terminal' ? '' : 'ferry-dock-expandable',
      isRight ? 'flex-row border-l' : 'flex-col border-t'
    ]"
    :style="dockShellStyle"
    @keydown="onDockKeydown"
  >
    <div
      v-if="!collapsed && !isMaximized"
      role="separator"
      :aria-orientation="isRight ? 'vertical' : 'horizontal'"
      aria-label="Resize dock"
      tabindex="0"
      :aria-valuenow="isRight ? liveWidth : liveHeight"
      :aria-valuemin="isRight ? MIN_DOCK_WIDTH : MIN_DOCK_HEIGHT"
      class="shrink-0 touch-none select-none hover:bg-primary/50 focus-visible:bg-primary/50 focus-visible:outline-none transition-colors"
      :class="[
        isRight ? 'h-full w-1.5 cursor-col-resize' : 'h-1.5 w-full cursor-row-resize',
        dragging ? 'bg-primary' : ''
      ]"
      @keydown="onResizeKey"
      @dblclick="resetSize"
      @pointerdown="onResizeStart"
    />

    <div
      v-if="isRight && collapsed"
      class="ml-auto flex h-full w-9 shrink-0 flex-col items-center gap-1.5 py-1.5 select-none"
      :class="ui.glassUiEnabled ? 'ferry-glass-chrome' : 'bg-muted'"
    >
      <UTooltip text="Expand dock" :content="{ side: 'left' }">
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Expand dock"
          @click="collapsed = false"
        />
      </UTooltip>
      <UTooltip text="Dock to bottom" :content="{ side: 'left' }">
        <UButton
          icon="i-lucide-panel-bottom"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Toggle dock side (bottom / right)"
          @click="ui.toggleDockPosition()"
        />
      </UTooltip>
      <div class="my-0.5 h-px w-5 bg-default" />
      <UTooltip v-for="panel in dockTabs" :key="panel.id" :text="panel.tooltip" :content="{ side: 'left' }">
        <UChip :text="panel.badge" :show="panel.badge > 0" size="lg" color="primary">
          <UButton
            :icon="panel.icon"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="panel.label"
            @click="openDock(panel.id)"
          />
        </UChip>
      </UTooltip>
    </div>

    <div v-show="!(isRight && collapsed)" class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        class="@container flex min-h-9 items-center justify-between gap-1 px-2 py-1 select-none"
        :class="ui.glassUiEnabled ? 'ferry-glass-chrome' : 'bg-muted'"
        @dblclick.self="collapsed = !collapsed"
      >
        <div
          class="ferry-scroll-fade-x scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto"
          :class="compactRightTabs ? 'gap-0.5' : 'gap-1'"
          role="tablist"
          aria-label="Dock panels"
          @keydown="onTablistKeydown($event)"
          @wheel="onTabStripWheel"
        >
          <UTooltip v-for="panel in dockTabs" :key="panel.id" :text="panel.tooltip">
            <button
              type="button"
              class="ferry-dock-tab inline-flex min-h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-md text-xs transition-colors focus-visible:outline-2 focus-visible:outline-primary"
              :class="[
                !compactRightTabs
                  ? 'px-2.5 py-1'
                  : !collapsed && tab === panel.id
                    ? 'px-2 py-1'
                    : 'min-w-7 justify-center px-1.5 py-1',
                !collapsed && tab === panel.id ? 'font-medium text-highlighted' : 'text-muted hover:bg-elevated/60 hover:text-default'
              ]"
              role="tab"
              :aria-selected="!collapsed && tab === panel.id"
              :aria-label="panel.label"
              @click="onTabClick(panel.id)"
            >
              <UIcon
                :name="panel.icon"
                class="size-3.5 shrink-0"
                :class="!collapsed && tab === panel.id ? 'text-primary' : 'text-muted'"
              />
              <span v-if="!compactRightTabs || (!collapsed && tab === panel.id)">{{ panel.label }}</span>
              <span
                v-if="panel.badge > 0"
                class="rounded-full bg-primary/15 px-1.5 py-0.2 font-mono text-3xs font-semibold tabular-nums text-primary"
              >
                {{ panel.badge }}
              </span>
            </button>
          </UTooltip>
        </div>
        <span class="mx-0.5 h-3.5 w-px shrink-0 border-l border-muted/70" aria-hidden="true" />
        <div class="flex shrink-0 items-center gap-0.5">
          <template v-if="!collapsed && tab === 'terminal'">
            <span
              v-if="sessions.activeTab.hostLabel"
              class="mr-1 hidden max-w-44 truncate font-mono text-2xs text-muted @[560px]:inline"
              :title="sessions.activeTab.hostLabel"
            >
              {{ sessions.activeTab.hostLabel }}
            </span>
            <UTooltip text="Find in terminal (Ctrl+Shift+F)">
              <UButton
                icon="i-lucide-search"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Search terminal"
                @click="openTerminalSearch"
              />
            </UTooltip>
          </template>
          <kbd
            v-if="collapsed && !isRight"
            class="mr-1.5 hidden rounded bg-default/70 px-1.5 py-0.5 font-mono text-3xs text-muted @[460px]:inline-block"
          >
            Ctrl+`
          </kbd>
          <UTooltip :text="isRight ? 'Dock to bottom' : 'Dock to right'">
            <UButton
              :icon="isRight ? 'i-lucide-panel-bottom' : 'i-lucide-panel-right'"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Toggle dock side (bottom / right)"
              @click="ui.toggleDockPosition()"
            />
          </UTooltip>
          <UTooltip :text="isMaximized ? 'Restore dock size (Esc)' : 'Maximize dock'">
            <UButton
              :icon="isMaximized ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
              :color="isMaximized ? 'primary' : 'neutral'"
              :variant="isMaximized ? 'soft' : 'ghost'"
              size="xs"
              :aria-label="isMaximized ? 'Restore dock size' : 'Maximize dock'"
              :aria-pressed="isMaximized"
              @click="toggleMaximize"
            />
          </UTooltip>
          <UTooltip :text="collapsed ? 'Expand dock' : 'Collapse dock'">
            <UButton
              :icon="isRight ? 'i-lucide-chevron-right' : (collapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down')"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="collapsed ? 'Expand dock' : 'Collapse dock'"
              @click="collapsed = !collapsed"
            />
          </UTooltip>
        </div>
      </div>
    <!-- Terminal & Log Tail use v-show; removing the other flex pane immediately avoids
         briefly splitting the available height while xterm is being fitted, and keeps
         open tail viewers (scroll, filters, search) alive across collapse/tab switches. -->
    <Transition name="dock-fade" :css="tab !== 'terminal' && tab !== 'tail'">
      <div
        v-if="!collapsed && tab !== 'terminal' && tab !== 'tail'"
        class="flex min-h-0 flex-1 flex-col border-t border-muted"
        :class="ui.glassUiEnabled ? 'ferry-glass-well' : ''"
      >
        <Transition name="dock-panel" mode="out-in">
          <TransferQueue v-if="tab === 'transfers'" />
          <ActivityPanel v-else-if="tab === 'activity'" />
          <MonitorPanel v-else-if="tab === 'monitor'" />
          <OpenEditsPanel v-else-if="tab === 'edits'" />
        </Transition>
      </div>
    </Transition>
    <div
      v-if="tailMounted"
      v-show="tailActive"
      class="flex min-h-0 flex-1 flex-col border-t border-muted"
      :class="ui.glassUiEnabled ? 'ferry-glass-well' : ''"
    >
      <!-- Tail Tabs Header Bar -->
      <div v-if="tailStreams.tabs.length > 0" class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-muted bg-muted/30 px-2 py-1">
        <div class="flex min-w-[120px] flex-1 items-center gap-1 overflow-x-auto scrollbar-none" role="tablist" aria-label="Open log tails" @keydown="onTablistKeydown($event, true)">
          <div
            v-for="openTail in tailStreams.tabs"
            :key="openTail.tailId"
            class="group flex shrink-0 items-center rounded-md border transition-all"
            :class="
              tailStreams.activeTailId === openTail.tailId
                ? 'bg-default border-default text-default font-medium shadow-xs ring-1 ring-primary/20'
                : 'border-transparent text-muted hover:bg-muted/60 hover:text-default'
            "
            @auxclick.middle.prevent="tailStreams.close(openTail.tailId)"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="tailStreams.activeTailId === openTail.tailId"
              :tabindex="tailStreams.activeTailId === openTail.tailId ? 0 : -1"
              class="flex min-w-0 cursor-pointer items-center gap-1.5 py-1 pl-2.5 pr-1 text-xs focus-visible:outline-2 focus-visible:outline-primary rounded-l-md"
              @click="tailStreams.activeTailId = openTail.tailId"
              @keydown.enter="tailStreams.activeTailId = openTail.tailId"
              @keydown.space.prevent="tailStreams.activeTailId = openTail.tailId"
            >
              <!-- Live status indicator dot -->
              <UIcon
                v-if="tailStreams.statusMap?.[openTail.tailId] === 'connecting'"
                name="i-lucide-loader-2"
                class="size-3 shrink-0 animate-spin text-primary"
              />
              <span
                v-else-if="!tailStreams.endedMap[openTail.tailId] && !tailStreams.errorMap[openTail.tailId]"
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
                class="hidden sm:inline-block max-w-[90px] truncate rounded bg-muted px-1 py-0.2 text-3xs font-mono text-muted"
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
            </button>

            <UTooltip text="Close tab (Middle-click)">
              <button
                type="button"
                :aria-label="`Close ${basename(openTail.remotePath)}`"
                class="mr-1 rounded p-0.5 text-muted opacity-60 hover:opacity-100 hover:bg-muted transition-opacity cursor-pointer"
                @click="tailStreams.close(openTail.tailId)"
              >
                <UIcon name="i-lucide-x" class="size-3" />
              </button>
            </UTooltip>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <!-- Status and actions of the visible tail, published by LogTailViewer. -->
          <LogTailControls />

          <template v-if="tailStreams.tabs.length > 1">
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
          </template>
        </div>
      </div>

      <div class="min-h-0 flex-1">
        <!-- All viewers stay mounted so scroll, filters and search survive switching tail tabs. -->
        <LogTailViewer
          v-for="openTail in tailStreams.tabs"
          v-show="tailStreams.activeTailId === openTail.tailId"
          :key="openTail.tailId"
          :tail-id="openTail.tailId"
          :active="tailActive && tailStreams.activeTailId === openTail.tailId"
        />
        <div
          v-if="(tailStreams.openingCount ?? 0) > 0 && tailStreams.tabs.length === 0"
          role="status"
          aria-live="polite"
          class="flex h-full flex-col items-center justify-center gap-2 px-3 py-6 text-center select-none"
        >
          <div class="rounded-full bg-primary/10 p-3 ring-1 ring-primary/20">
            <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-primary" />
          </div>
          <p class="text-xs font-semibold text-default">Starting log stream…</p>
          <p class="text-2xs text-muted max-w-sm">
            Connecting to the remote host and opening the tail stream.
          </p>
        </div>
        <div v-else-if="!tailStreams.activeTailId" class="flex h-full flex-col items-center justify-center gap-2 px-3 py-6 text-center select-none">
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
    <div v-show="terminalActive" class="flex min-h-0 flex-1 flex-col border-t border-muted">
      <TerminalView v-if="terminalEverShown" :active="terminalActive" />
    </div>
    </div>
  </div>
</template>

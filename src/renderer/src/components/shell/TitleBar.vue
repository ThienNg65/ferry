<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { WindowIsMaximizedResult, WindowStateEvent } from '@shared/contract'
import { invoke, onEvent } from '../../api'
import { useGlobalActivity } from '../../composables/useGlobalActivity'
import { useUiStore } from '../../stores/ui.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useSettingsDialog } from '../../composables/useSettingsDialog'
import { useUpdateStore } from '../../stores/update.store'
import { useHistoryDialog } from '../../composables/useHistoryDialog'
import { useCommandPalette } from '../../composables/useCommandPalette'
import { useDockState } from '../../composables/useDockState'
import { isNeutralinoRuntime, registerTitleBarDragRegion } from '../../bridge/neutralinoApi'
import { flushWindowBoundsSnapshot } from '../../utils/windowBounds'

const { isBusy, label: activityLabel } = useGlobalActivity()
const ui = useUiStore()
const sessions = useSessionsStore()
const settingsDialog = useSettingsDialog()
const updateStore = useUpdateStore()
const historyDialog = useHistoryDialog()
const commandPalette = useCommandPalette()
const { openDock } = useDockState()

/** The dock only exists post-connect — the busy dot is a plain indicator otherwise. */
function showActivity(): void {
  if (sessions.status === 'connected') {
    openDock('activity')
  }
}

const titleBarRef = ref<HTMLElement | null>(null)
const isMaximized = ref(false)
let unsubscribe: (() => void) | null = null
let disposeDragRegion: (() => void) | null = null

onMounted(async () => {
  disposeDragRegion = registerTitleBarDragRegion(titleBarRef.value, {
    isMaximized: () => isMaximized.value,
    onUnmaximizeForDrag: async () => {
      if (isMaximized.value) {
        await invoke(INVOKE_CHANNELS.windowMaximizeToggle)
      }
    }
  })
  unsubscribe = onEvent<WindowStateEvent>(EVENT_CHANNELS.windowStateChange, (evt) => {
    isMaximized.value = evt.isMaximized
  })
  const result = await invoke<WindowIsMaximizedResult>(INVOKE_CHANNELS.windowIsMaximized)
  isMaximized.value = result.isMaximized
})

onUnmounted(() => {
  disposeDragRegion?.()
  unsubscribe?.()
})

function onTitleBarDblClick(event: MouseEvent): void {
  if (!isNeutralinoRuntime()) {
    return
  }
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, input, [role="button"]')) {
    return
  }
  toggleMaximize()
}

function minimize(): void {
  void invoke(INVOKE_CHANNELS.windowMinimize)
}
function toggleMaximize(): void {
  void invoke(INVOKE_CHANNELS.windowMaximizeToggle)
}
async function close(): Promise<void> {
  await flushWindowBoundsSnapshot()
  void invoke(INVOKE_CHANNELS.windowClose)
}
</script>

<template>
  <div
    ref="titleBarRef"
    class="grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-muted select-none"
    :style="isNeutralinoRuntime() ? undefined : '-webkit-app-region: drag'"
    @dblclick="onTitleBarDblClick"
  >
    <div class="flex items-center gap-0.5 pl-2" style="-webkit-app-region: no-drag" @pointerdown.stop>
      <UTooltip :text="ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'">
        <button
          type="button"
          aria-label="Toggle theme"
          class="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-accented hover:text-highlighted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          @click="ui.toggleTheme()"
        >
          <UIcon :name="ui.theme === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'" class="size-3.5" />
        </button>
      </UTooltip>
      <UTooltip text="History">
        <button
          type="button"
          aria-label="History"
          class="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-accented hover:text-highlighted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          @click="historyDialog.open()"
        >
          <UIcon name="i-lucide-history" class="size-3.5" />
        </button>
      </UTooltip>
      <UTooltip text="Settings">
        <button
          type="button"
          aria-label="Settings"
          class="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-accented hover:text-highlighted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          @click="settingsDialog.open()"
        >
          <UIcon name="i-lucide-settings" class="size-3.5" />
        </button>
      </UTooltip>
    </div>
    <div class="flex items-center gap-2 justify-self-center">
      <UTooltip v-if="isBusy" :text="activityLabel">
        <button
          type="button"
          aria-label="Show activity"
          class="flex items-center"
          :class="sessions.status === 'connected' ? 'cursor-pointer' : 'cursor-default'"
          style="-webkit-app-region: no-drag"
          @pointerdown.stop
          @click="showActivity"
        >
          <span class="size-2 rounded-full bg-primary animate-pulse" />
        </button>
      </UTooltip>
      <UTooltip v-if="updateStore.isDownloaded" :text="`Ferry v${updateStore.availableVersion} is ready — click to restart`">
        <button
          type="button"
          aria-label="Restart to update"
          class="flex items-center gap-1 rounded bg-success/20 px-1.5 py-0.5 text-2xs font-medium text-success transition-colors hover:bg-success/30"
          style="-webkit-app-region: no-drag"
          @pointerdown.stop
          @click="updateStore.installNow()"
        >
          <UIcon name="i-lucide-arrow-up-circle" class="size-3" />
          <span class="hidden sm:inline">Update ready</span>
        </button>
      </UTooltip>
      <UTooltip text="Command palette (Ctrl+K)">
        <button
          type="button"
          aria-label="Open command palette"
          class="flex items-center gap-1.5 rounded-md border border-default bg-default/70 px-2 py-0.5 text-2xs text-muted transition-colors hover:border-accented hover:bg-default hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
          style="-webkit-app-region: no-drag"
          @pointerdown.stop
          @click="commandPalette.open()"
        >
          <UIcon name="i-lucide-search" class="size-3" />
          <span class="hidden sm:inline">Search / Commands</span>
          <kbd class="rounded bg-muted px-1 py-0.2 font-mono text-[10px] text-dimmed">Ctrl+K</kbd>
        </button>
      </UTooltip>
    </div>
    <div class="flex h-full items-stretch justify-self-end" style="-webkit-app-region: no-drag" @pointerdown.stop>
      <UTooltip text="Minimize">
        <button
          type="button"
          aria-label="Minimize"
          class="flex w-[46px] items-center justify-center text-muted transition-colors hover:bg-accented hover:text-highlighted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          @click="minimize"
        >
          <UIcon name="i-lucide-minus" class="size-4" />
        </button>
      </UTooltip>
      <UTooltip :text="isMaximized ? 'Restore' : 'Maximize'">
        <button
          type="button"
          :aria-label="isMaximized ? 'Restore' : 'Maximize'"
          class="flex w-[46px] items-center justify-center text-muted transition-colors hover:bg-accented hover:text-highlighted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          @click="toggleMaximize"
        >
          <UIcon :name="isMaximized ? 'i-lucide-copy' : 'i-lucide-square'" class="size-3.5" />
        </button>
      </UTooltip>
      <UTooltip text="Close">
        <button
          type="button"
          aria-label="Close"
          class="flex w-[46px] items-center justify-center text-muted transition-colors hover:bg-error hover:text-inverted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-error"
          @click="close"
        >
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
      </UTooltip>
    </div>
  </div>
</template>

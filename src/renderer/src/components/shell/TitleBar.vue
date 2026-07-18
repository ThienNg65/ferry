<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { WindowIsMaximizedResult, WindowStateEvent } from '@shared/contract'
import { invoke, onEvent } from '../../api'
import { useGlobalActivity } from '../../composables/useGlobalActivity'
import { useUiStore } from '../../stores/ui.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useSettingsDialog } from '../../composables/useSettingsDialog'
import { useDockState } from '../../composables/useDockState'

const { isBusy, label: activityLabel } = useGlobalActivity()
const ui = useUiStore()
const sessions = useSessionsStore()
const settingsDialog = useSettingsDialog()
const { openDock } = useDockState()

/** The dock only exists post-connect — the busy dot is a plain indicator otherwise. */
function showActivity(): void {
  if (sessions.status === 'connected') {
    openDock('activity')
  }
}
const isMaximized = ref(false)
let unsubscribe: (() => void) | null = null

onMounted(async () => {
  unsubscribe = onEvent<WindowStateEvent>(EVENT_CHANNELS.windowStateChange, (evt) => {
    isMaximized.value = evt.isMaximized
  })
  const result = await invoke<WindowIsMaximizedResult>(INVOKE_CHANNELS.windowIsMaximized)
  isMaximized.value = result.isMaximized
})

onUnmounted(() => {
  unsubscribe?.()
})

function minimize(): void {
  void invoke(INVOKE_CHANNELS.windowMinimize)
}
function toggleMaximize(): void {
  void invoke(INVOKE_CHANNELS.windowMaximizeToggle)
}
function close(): void {
  void invoke(INVOKE_CHANNELS.windowClose)
}
</script>

<template>
  <div
    class="grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-muted bg-muted/80 backdrop-blur"
    style="-webkit-app-region: drag"
  >
    <div class="flex items-center" style="-webkit-app-region: no-drag">
      <UTooltip :text="ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'">
        <button
          type="button"
          aria-label="Toggle theme"
          class="flex size-9 items-center justify-center text-muted transition-colors hover:bg-accented hover:text-highlighted"
          @click="ui.toggleTheme()"
        >
          <UIcon :name="ui.theme === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'" class="size-3.5" />
        </button>
      </UTooltip>
      <UTooltip text="Settings">
        <button
          type="button"
          aria-label="Settings"
          class="flex size-9 items-center justify-center text-muted transition-colors hover:bg-accented hover:text-highlighted"
          @click="settingsDialog.open()"
        >
          <UIcon name="i-lucide-settings" class="size-3.5" />
        </button>
      </UTooltip>
    </div>
    <div class="flex items-center gap-1.5 justify-self-center">
      <Transition name="fade">
        <UTooltip v-if="isBusy" :text="activityLabel">
          <button
            type="button"
            aria-label="Show activity"
            class="flex items-center"
            :class="sessions.status === 'connected' ? 'cursor-pointer' : 'cursor-default'"
            style="-webkit-app-region: no-drag"
            @click="showActivity"
          >
            <span class="size-2 rounded-full bg-primary animate-pulse" />
          </button>
        </UTooltip>
      </Transition>
      <span class="text-xs font-medium text-toned">Ferry</span>
    </div>
    <div class="flex h-full items-stretch justify-self-end" style="-webkit-app-region: no-drag">
      <UTooltip text="Minimize">
        <button
          type="button"
          aria-label="Minimize"
          class="flex w-11 items-center justify-center text-muted transition-colors hover:bg-accented hover:text-highlighted"
          @click="minimize"
        >
          <UIcon name="i-lucide-minus" class="size-4" />
        </button>
      </UTooltip>
      <UTooltip :text="isMaximized ? 'Restore' : 'Maximize'">
        <button
          type="button"
          :aria-label="isMaximized ? 'Restore' : 'Maximize'"
          class="flex w-11 items-center justify-center text-muted transition-colors hover:bg-accented hover:text-highlighted"
          @click="toggleMaximize"
        >
          <UIcon :name="isMaximized ? 'i-lucide-copy' : 'i-lucide-square'" class="size-3.5" />
        </button>
      </UTooltip>
      <UTooltip text="Close">
        <button
          type="button"
          aria-label="Close"
          class="flex w-11 items-center justify-center text-muted transition-colors hover:bg-red-500 hover:text-white"
          @click="close"
        >
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
      </UTooltip>
    </div>
  </div>
</template>

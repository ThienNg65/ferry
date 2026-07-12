<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { WindowIsMaximizedResult, WindowStateEvent } from '@shared/contract'
import { invoke, onEvent } from '../../api'

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
    class="grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-muted bg-default/80 backdrop-blur"
    style="-webkit-app-region: drag"
  >
    <div></div>
    <span class="justify-self-center text-xs font-medium text-muted">Ferry</span>
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

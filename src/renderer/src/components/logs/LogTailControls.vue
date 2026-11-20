<script setup lang="ts">
import { computed } from 'vue'
import { tailControls } from '../../composables/useTailControls'

const status = computed(() => {
  const c = tailControls.value
  if (!c) return null
  if (c.error) return 'error' as const
  if (c.ended) return 'ended' as const
  return c.status ?? 'streaming'
})

const isConnecting = computed(() => status.value === 'connecting')
const isTerminal = computed(() => status.value === 'ended' || status.value === 'error')
const isStreaming = computed(() => status.value === 'streaming')

const statusTooltip = computed(() => {
  if (!tailControls.value) return undefined
  if (isConnecting.value) return 'Connecting to remote log stream…'
  if (isStreaming.value) {
    return tailControls.value.autoScroll ? 'Pause auto-scroll (Space)' : 'Resume live following (Space)'
  }
  return undefined
})

const statusLabel = computed(() => {
  const c = tailControls.value
  if (!c) return ''
  if (isConnecting.value) return 'Connecting'
  if (status.value === 'error') return 'Error'
  if (status.value === 'ended') return 'Ended'
  if (c.autoScroll) return 'Live'
  return c.newLinesCount > 0 ? `Paused (+${c.newLinesCount})` : 'Paused'
})
</script>

<template>
  <div v-if="tailControls" class="flex shrink-0 items-center gap-2.5 text-2xs select-none">
    <UTooltip :text="statusTooltip">
      <button
        type="button"
        :disabled="isTerminal || isConnecting"
        :aria-pressed="isStreaming ? tailControls.autoScroll : undefined"
        :aria-label="statusTooltip || statusLabel"
        class="flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-semibold transition-colors select-none"
        :class="[
          isStreaming ? 'cursor-pointer' : 'cursor-default',
          isConnecting
            ? 'border-primary/30 bg-primary/10 text-primary'
            : isStreaming
              ? tailControls.autoScroll
                ? 'border-success/30 bg-success/10 text-success hover:bg-success/15'
                : 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/20'
              : status === 'error'
                ? 'border-error/30 bg-error/10 text-error'
                : 'border-default bg-muted text-muted'
        ]"
        @click="tailControls.toggleAutoScroll()"
      >
        <UIcon v-if="isConnecting" name="i-lucide-loader-2" class="size-3 animate-spin" />
        <span v-else-if="isStreaming && tailControls.autoScroll" class="relative flex size-2">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span class="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        <span v-else-if="isStreaming" class="inline-flex size-2 rounded-full bg-warning" />
        <span v-else-if="status === 'error'" class="inline-flex size-2 rounded-full bg-error" />
        <span v-else class="inline-flex size-2 rounded-full bg-accented" />
        {{ statusLabel }}
      </button>
    </UTooltip>

    <span
      v-if="isStreaming"
      class="hidden font-mono text-3xs tabular-nums text-muted sm:inline"
      :class="{ 'opacity-50': tailControls.linesPerSec === 0 }"
    >
      {{ tailControls.linesPerSec.toLocaleString() }}/s
    </span>

    <UTooltip
      :text="`Rolling buffer: ${tailControls.totalCount.toLocaleString()} / ${tailControls.maxLines.toLocaleString()} lines (${tailControls.bufferPct}%)`"
    >
      <div class="flex items-center gap-1.5 font-mono text-3xs tabular-nums text-muted">
        <span>
          <span class="font-semibold text-default">{{ tailControls.visibleCount.toLocaleString() }}</span>
          <span v-if="tailControls.visibleCount !== tailControls.totalCount">
            / {{ tailControls.totalCount.toLocaleString() }}
          </span>
          lines
        </span>
        <div class="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full transition-all duration-300"
            :class="tailControls.bufferPct >= 90 ? 'bg-warning' : 'bg-primary/70'"
            :style="{ width: `${tailControls.bufferPct}%` }"
          />
        </div>
      </div>
    </UTooltip>

    <UButton
      v-if="tailControls.ended || tailControls.error"
      label="Restart"
      icon="i-lucide-rotate-cw"
      size="xs"
      color="primary"
      variant="soft"
      :loading="tailControls.restarting"
      @click="tailControls.restart()"
    />

    <UDropdownMenu :items="tailControls.menuItems as never" :content="{ align: 'end' }">
      <UButton aria-label="More log actions" icon="i-lucide-ellipsis" size="xs" color="neutral" variant="ghost" />
    </UDropdownMenu>
  </div>
</template>

<script setup lang="ts">
import { tailControls } from '../../composables/useTailControls'
</script>

<template>
  <div v-if="tailControls" class="flex shrink-0 items-center gap-2.5 text-2xs select-none">
    <UTooltip
      :text="
        !tailControls.ended && !tailControls.error
          ? tailControls.autoScroll
            ? 'Pause auto-scroll (Space)'
            : 'Resume live following (Space)'
          : undefined
      "
    >
      <button
        type="button"
        class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-semibold transition-colors select-none"
        :class="
          !tailControls.ended && !tailControls.error
            ? tailControls.autoScroll
              ? 'border-success/30 bg-success/10 text-success hover:bg-success/15'
              : 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/20'
            : tailControls.error
              ? 'border-error/30 bg-error/10 text-error'
              : 'border-default bg-muted text-muted'
        "
        @click="tailControls.toggleAutoScroll()"
      >
        <span v-if="!tailControls.ended && !tailControls.error && tailControls.autoScroll" class="relative flex size-2">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span class="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        <span v-else-if="!tailControls.ended && !tailControls.error" class="inline-flex size-2 rounded-full bg-warning" />
        <span v-else-if="tailControls.error" class="inline-flex size-2 rounded-full bg-error" />
        <span v-else class="inline-flex size-2 rounded-full bg-accented" />
        {{
          !tailControls.ended && !tailControls.error
            ? tailControls.autoScroll
              ? 'Live'
              : tailControls.newLinesCount > 0
                ? `Paused (+${tailControls.newLinesCount})`
                : 'Paused'
            : tailControls.error
              ? 'Error'
              : 'Ended'
        }}
      </button>
    </UTooltip>

    <span
      v-if="!tailControls.ended && !tailControls.error"
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

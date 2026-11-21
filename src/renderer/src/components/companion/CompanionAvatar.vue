<script setup lang="ts">
import type { CompanionAvatarState } from '../../stores/companion.store'

withDefaults(
  defineProps<{
    state?: CompanionAvatarState
    size?: number
  }>(),
  {
    state: 'resting',
    size: 18
  }
)
</script>

<template>
  <span
    class="relative inline-flex shrink-0 items-center justify-center select-none"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :data-companion-state="state"
    aria-hidden="true"
  >
    <svg
      :width="size"
      :height="size"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class="overflow-visible"
    >
      <!-- Helping ring -->
      <circle
        v-if="state === 'helping'"
        cx="12"
        cy="12"
        r="10.5"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-dasharray="18 48"
        stroke-linecap="round"
        class="origin-center animate-spin text-primary motion-reduce:animate-none"
      />
      <!-- Minimal stylized Ferry cabin + hull (derived from Ferry vessel icon) -->
      <path
        d="M11 4.5C11 3.95 11.45 3.5 12 3.5C12.55 3.5 13 3.95 13 4.5V6.5H15.5C16.7 6.5 17.6 7.3 17.9 8.4L18.6 11H19.8C20.9 11 21.5 12 21.1 13L20.3 15.1C19.8 16.4 18.7 17.2 17.4 17.6L12.7 19C12.2 19.15 11.8 19.15 11.3 19L6.6 17.6C5.3 17.2 4.2 16.4 3.7 15.1L2.9 13C2.5 12 3.1 11 4.2 11H5.4L6.1 8.4C6.4 7.3 7.3 6.5 8.5 6.5H11V4.5Z"
        fill="currentColor"
        fill-opacity="0.16"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <!-- Portholes -->
      <circle cx="9.6" cy="10.2" r="1" fill="currentColor" />
      <circle cx="14.4" cy="10.2" r="1" fill="currentColor" />
      <!-- Wake stroke (subtly pulses when talking; static at rest) -->
      <path
        d="M4.5 20.3C6.8 19.3 8.4 19.3 10.4 20.4C11.4 21 12.6 21 13.6 20.4C15.6 19.3 17.2 19.3 19.5 20.3"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        :class="state === 'talking' ? 'animate-pulse text-primary motion-reduce:animate-none' : 'opacity-75'"
      />
    </svg>
    <!-- Noticing indicator dot -->
    <span
      v-if="state === 'noticing'"
      class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-default"
    />
  </span>
</template>

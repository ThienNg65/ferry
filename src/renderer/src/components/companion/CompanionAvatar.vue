<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import type { CompanionAvatarState } from '../../stores/companion.store'
import { FERRY_MOTION_TOKENS } from '../../utils/motionTokens'

const props = withDefaults(
  defineProps<{
    state?: CompanionAvatarState
    size?: number
    prod?: boolean
    noticing?: boolean
    /** Each increase fires one S1 lift. */
    chunk?: number
    /** True inside the open panel: lets the resting orb animate. */
    live?: boolean
  }>(),
  {
    state: 'idle',
    size: 18,
    prod: false,
    noticing: false,
    chunk: 0,
    live: false
  }
)

const uid = useId()
const full = computed(() => props.size >= 20)
const ARC = 'M87.6,71.7 A43.4,43.4 0 0 1 12.4,71.7'
const GLYPH_ARC = 'M84.6,70 A40,40 0 0 1 15.4,70'
// A miniature of the ambient canvas: accent and violet lights behind frosted glass.
const LIGHTS = [
  { cx: 32, cy: 36, r: 22, color: 'var(--orb-l1)', orbit: 'orb-orbit1' },
  { cx: 68, cy: 64, r: 24, color: 'var(--orb-l2)', orbit: 'orb-orbit2' }
] as const

// P1: production warms the body and inner light toward the error red.
const tint = (color: string): string => (props.prod ? `color-mix(in oklab, ${color} 74%, var(--ui-error))` : color)

const windowActive = ref(document.visibilityState === 'visible' && document.hasFocus())
const syncActive = (): void => {
  windowActive.value = document.visibilityState === 'visible' && document.hasFocus()
}
const onBlur = (): void => {
  windowActive.value = false
}
const running = computed(
  () =>
    windowActive.value &&
    (props.state === 'thinking' ||
      props.state === 'streaming' ||
      (props.live && (props.size > 24 || props.state !== 'idle')))
)

const lifting = ref(false)
let liftTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => props.chunk,
  (n, o) => {
    if (n <= o) return
    lifting.value = true
    clearTimeout(liftTimer)
    liftTimer = setTimeout(() => (lifting.value = false), FERRY_MOTION_TOKENS.duration.fast)
  }
)

onMounted(() => {
  document.addEventListener('visibilitychange', syncActive)
  window.addEventListener('focus', syncActive)
  window.addEventListener('blur', onBlur)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', syncActive)
  window.removeEventListener('focus', syncActive)
  window.removeEventListener('blur', onBlur)
  clearTimeout(liftTimer)
})
</script>

<template>
  <span
    class="orb relative inline-flex shrink-0 items-center justify-center select-none"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :data-companion-state="state"
    :data-animate="running"
    :data-orb-size="full ? 'full' : 'small'"
    :data-lifting="lifting || undefined"
    aria-hidden="true"
  >
    <svg :width="size" :height="size" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="overflow-visible">
      <template v-if="full">
        <defs>
          <radialGradient :id="`${uid}-base`" cx="35%" cy="28%" r="80%">
            <stop offset="0" :style="{ stopColor: tint('var(--orb-b0)') }" />
            <stop offset="1" :style="{ stopColor: tint('var(--orb-b1)') }" />
          </radialGradient>
          <linearGradient :id="`${uid}-edge`" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style="stop-color: #fff; stop-opacity: var(--orb-edge-top)" />
            <stop offset=".6" style="stop-color: #fff; stop-opacity: 0" />
          </linearGradient>
          <linearGradient v-if="prod" :id="`${uid}-prod`" gradientUnits="userSpaceOnUse" x1="12" y1="0" x2="88" y2="0">
            <stop offset="0" style="stop-color: var(--ui-error)" stop-opacity="0" />
            <stop offset=".5" style="stop-color: var(--ui-error)" stop-opacity="1" />
            <stop offset="1" style="stop-color: var(--ui-error)" stop-opacity="0" />
          </linearGradient>
          <filter :id="`${uid}-b9`" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" /></filter>
          <filter :id="`${uid}-b2`" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2" /></filter>
          <clipPath :id="`${uid}-clip`"><circle cx="50" cy="50" r="44" /></clipPath>
        </defs>

        <g data-orb-lens>
          <circle class="orb-glow" cx="50" cy="52" r="46" :filter="`url(#${uid}-b9)`" />
          <circle cx="50" cy="50" r="44" :fill="`url(#${uid}-base)`" />
          <g :clip-path="`url(#${uid}-clip)`">
            <g data-orb-lift class="orb-lift" :class="{ 'is-lifting': lifting }">
              <g class="orb-lean">
                <g class="orb-lights" :filter="`url(#${uid}-b9)`">
                  <circle
                    v-for="l in LIGHTS"
                    :key="l.cx"
                    :class="l.orbit"
                    :cx="l.cx"
                    :cy="l.cy"
                    :r="l.r"
                    :style="{ fill: tint(l.color) }"
                  />
                </g>
              </g>
            </g>
          </g>
          <!-- Ferry glass edge: hairline keyline plus a 1px specular top edge, at any size. -->
          <circle class="orb-keyline" cx="50" cy="50" r="44" fill="none" stroke-width="1" vector-effect="non-scaling-stroke" />
          <circle
            cx="50"
            cy="50"
            r="43.4"
            fill="none"
            :stroke="`url(#${uid}-edge)`"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
          <g v-if="prod" data-orb-prod>
            <path :d="ARC" fill="none" :stroke="`url(#${uid}-prod)`" stroke-width="3" vector-effect="non-scaling-stroke" :filter="`url(#${uid}-b2)`" />
            <path :d="ARC" fill="none" :stroke="`url(#${uid}-prod)`" stroke-width="1.6" stroke-linecap="round" vector-effect="non-scaling-stroke" />
          </g>
        </g>
      </template>

      <!-- 16px: a line glyph that sits with the toolbar's Lucide icons. -->
      <g v-else data-orb-glyph>
        <circle
          data-orb-ring
          class="orb-ring"
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="currentColor"
          stroke-width="1.33"
          vector-effect="non-scaling-stroke"
        />
        <circle class="orb-dot" cx="50" cy="50" r="13" />
        <path
          v-if="state === 'thinking'"
          data-orb-busy
          class="orb-busy"
          d="M50,10 A40,40 0 0 1 90,50"
          fill="none"
          stroke-width="2.25"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
        <path
          v-if="prod"
          data-orb-prod
          :d="GLYPH_ARC"
          fill="none"
          stroke-width="2.25"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
          style="stroke: var(--ui-error)"
        />
      </g>
    </svg>
    <span
      v-if="noticing"
      data-orb-notice
      class="orb-notice absolute -top-0.5 -right-0.5 rounded-full ring-default"
      :class="full ? 'size-2 ring-2' : 'size-1.5 ring-1'"
    />
  </span>
</template>

<style scoped>
.orb {
  /* Follows the accent like the ambient canvas; ui.store swaps in brand blue for warm accents. */
  --orb-accent: var(--ferry-companion-accent, var(--ui-color-primary-500));
  /* Frosted quartz (light): accent mixed into white. */
  --orb-b0: color-mix(in oklab, var(--orb-accent) 6%, white);
  --orb-b1: color-mix(in oklab, var(--orb-accent) 20%, white);
  --orb-l1: var(--orb-accent);
  --orb-l2: oklch(0.68 0.16 295);
  --orb-lights: 0.55;
  --orb-edge-top: 0.9;
  --orb-keyline: rgb(15 23 42 / 0.1);
  --orb-glow: var(--orb-accent);
  --orb-dot: currentColor;
  --orb-glow-scale: 1;
  --orb-o1: 11s;
  --orb-o2: 17s;
  --orb-glow-dur: 5s;
  --orb-glow-lo: 0.12;
  --orb-glow-hi: 0.25;
}
/* Smoked obsidian (dark): accent mixed into slate. */
.dark .orb {
  --orb-b0: color-mix(in oklab, var(--orb-accent) 22%, #1e293b);
  --orb-b1: color-mix(in oklab, var(--orb-accent) 10%, #0b1220);
  --orb-lights: 0.75;
  --orb-edge-top: 0.22;
  --orb-keyline: transparent;
}
.orb[data-companion-state='listening'] {
  --orb-o1: 40s;
  --orb-o2: 60s;
  --orb-glow-dur: 3s;
  --orb-glow-lo: 0.25;
  --orb-glow-hi: 0.35;
  --orb-dot: var(--orb-accent);
}
.orb[data-companion-state='thinking'] {
  --orb-o1: 2.4s;
  --orb-o2: 3.6s;
  --orb-glow-dur: 1.1s;
  --orb-glow-lo: 0.3;
  --orb-glow-hi: 0.6;
}
.orb[data-companion-state='streaming'] {
  --orb-glow-dur: 2s;
  --orb-glow-lo: 0.35;
  --orb-glow-hi: 0.35;
  --orb-dot: var(--orb-accent);
}
.orb[data-companion-state='error'] {
  --orb-b0: #fef3c7;
  --orb-b1: #f59e0b;
  --orb-l1: #d97706;
  --orb-l2: #b45309;
  --orb-keyline: rgb(180 83 9 / 0.45);
  --orb-glow: var(--ui-warning);
  --orb-dot: var(--ui-warning);
  --orb-glow-dur: 2.6s;
  --orb-glow-lo: 0.35;
  --orb-glow-hi: 0.55;
}
.dark .orb[data-companion-state='error'] {
  --orb-b0: #52525b;
  --orb-b1: #27272a;
  --orb-l1: #f59e0b;
  --orb-l2: #b45309;
  --orb-keyline: rgb(245 158 11 / 0.4);
}

.orb :is(stop, circle) {
  transition:
    opacity var(--ferry-motion-standard) var(--ferry-motion-ease-spring),
    stop-color var(--ferry-motion-standard) var(--ferry-motion-ease-spring),
    fill var(--ferry-motion-standard) var(--ferry-motion-ease-spring),
    stroke var(--ferry-motion-standard) var(--ferry-motion-ease-spring);
}

.orb-glow {
  fill: var(--orb-glow);
  opacity: calc(var(--orb-glow-lo) * var(--orb-glow-scale));
  animation: orb-breathe var(--orb-glow-dur) ease-in-out infinite;
}
.orb[data-lifting] .orb-glow {
  animation: none;
  opacity: calc(0.6 * var(--orb-glow-scale));
  transition-duration: var(--ferry-motion-fast);
}
.orb-lights {
  opacity: var(--orb-lights);
}
.orb-keyline {
  stroke: var(--orb-keyline);
}

.orb-orbit1,
.orb-orbit2 {
  transform-origin: 50px 50px;
}
.orb-orbit1 {
  animation: orb-spin var(--orb-o1) linear infinite;
}
.orb-orbit2 {
  animation: orb-spin var(--orb-o2) linear infinite reverse;
}
.orb[data-companion-state='error'] :is(.orb-orbit1, .orb-orbit2) {
  animation: none;
}

.orb-lean {
  transition: transform var(--ferry-motion-standard) var(--ferry-motion-ease-spring);
}
.orb[data-companion-state='listening'] .orb-lean {
  transform: translateY(12px);
}

/* S1: rise fast, settle on the spring. */
.orb-lift {
  transition: transform var(--ferry-motion-considered) var(--ferry-motion-ease-spring);
}
.orb-lift.is-lifting {
  transform: translateY(-9px);
  transition: transform var(--ferry-motion-fast) var(--ferry-motion-ease-out);
}

/* 16px glyph */
.orb[data-companion-state='error'] .orb-ring {
  stroke: var(--ui-warning);
}
/* Let the busy arc stand out from a ring that may already be primary-coloured. */
.orb[data-companion-state='thinking'] .orb-ring {
  opacity: 0.4;
}
.orb-dot {
  fill: var(--orb-dot);
}
.orb-busy {
  stroke: var(--orb-accent);
  transform-origin: 50px 50px;
  animation: orb-spin 0.9s linear infinite;
}
.orb-notice {
  background: var(--orb-accent);
}

/* Static at rest (DESIGN.md rule 5): the component gates every infinite animation. */
.orb[data-animate='false'] * {
  animation: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .orb * {
    animation: none !important;
  }
  .orb-lift.is-lifting {
    transform: none;
  }
  .orb-lean {
    transition: none;
  }
}
@media (prefers-reduced-transparency: reduce) {
  .orb {
    --orb-glow-scale: 0.5;
  }
}

@keyframes orb-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes orb-breathe {
  0%,
  100% {
    opacity: calc(var(--orb-glow-lo) * var(--orb-glow-scale));
  }
  50% {
    opacity: calc(var(--orb-glow-hi) * var(--orb-glow-scale));
  }
}
</style>

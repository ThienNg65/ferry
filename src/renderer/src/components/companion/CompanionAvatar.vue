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
const LIGHTS = [
  { cx: 30, cy: 34, r: 20, color: 'var(--orb-l1)', orbit: 'orb-orbit1' },
  { cx: 70, cy: 62, r: 24, color: 'var(--orb-l2)', orbit: 'orb-orbit2' },
  { cx: 64, cy: 30, r: 11, color: 'var(--orb-l3)', orbit: 'orb-orbit1' }
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
  () => windowActive.value && (props.live || props.state === 'thinking' || props.state === 'streaming')
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
    :data-orb-size="size < 20 ? 'small' : 'full'"
    :data-lifting="lifting || undefined"
    aria-hidden="true"
  >
    <svg :width="size" :height="size" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="overflow-visible">
      <defs>
        <radialGradient :id="`${uid}-base`" cx="38%" cy="30%" r="78%">
          <stop offset="0" :style="{ stopColor: tint('var(--orb-b0)') }" />
          <stop offset=".35" :style="{ stopColor: tint('var(--orb-b1)') }" />
          <stop offset=".75" :style="{ stopColor: tint('var(--orb-b2)') }" />
          <stop offset="1" :style="{ stopColor: tint('var(--orb-b3)') }" />
        </radialGradient>
        <linearGradient :id="`${uid}-rim`" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".9" />
          <stop offset=".45" stop-color="#fff" stop-opacity=".05" />
          <stop offset="1" stop-color="#fff" stop-opacity=".5" />
        </linearGradient>
        <linearGradient v-if="prod" :id="`${uid}-prod`" gradientUnits="userSpaceOnUse" x1="12" y1="0" x2="88" y2="0">
          <stop offset="0" style="stop-color: var(--ui-error)" stop-opacity="0" />
          <stop offset=".5" style="stop-color: var(--ui-error)" stop-opacity="1" />
          <stop offset="1" style="stop-color: var(--ui-error)" stop-opacity="0" />
        </linearGradient>
        <template v-if="full">
          <radialGradient :id="`${uid}-vig`" cx="50%" cy="45%" r="55%">
            <stop offset=".6" stop-color="#000" stop-opacity="0" />
            <stop offset="1" stop-color="#020617" stop-opacity=".55" />
          </radialGradient>
          <filter :id="`${uid}-b9`" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" /></filter>
          <filter :id="`${uid}-b4`" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
          <filter :id="`${uid}-b2`" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2" /></filter>
          <clipPath :id="`${uid}-clip`"><circle cx="50" cy="50" r="44" /></clipPath>
        </template>
        <radialGradient v-else :id="`${uid}-glow`">
          <stop offset=".45" style="stop-color: var(--orb-glow)" />
          <stop offset="1" style="stop-color: var(--orb-glow)" stop-opacity="0" />
        </radialGradient>
      </defs>

      <circle
        class="orb-glow"
        cx="50"
        cy="52"
        r="46"
        :style="{ fill: full ? 'var(--orb-glow)' : `url(#${uid}-glow)` }"
        :filter="full ? `url(#${uid}-b9)` : undefined"
      />
      <circle cx="50" cy="50" r="44" :fill="`url(#${uid}-base)`" />

      <g v-if="full" :clip-path="`url(#${uid}-clip)`">
        <g data-orb-lift class="orb-lift" :class="{ 'is-lifting': lifting }">
          <g class="orb-lean">
            <g :filter="`url(#${uid}-b9)`" style="mix-blend-mode: screen">
              <circle
                v-for="l in LIGHTS"
                :key="l.cx"
                :class="l.orbit"
                :cx="l.cx"
                :cy="l.cy"
                :r="l.r"
                :style="{ fill: tint(l.color) }"
                opacity=".85"
              />
            </g>
          </g>
        </g>
        <ellipse class="orb-caustic" cx="54" cy="82" rx="24" ry="9" :filter="`url(#${uid}-b4)`" />
        <circle cx="50" cy="50" r="44" :fill="`url(#${uid}-vig)`" />
      </g>

      <ellipse v-if="full" cx="38" cy="27" rx="17" ry="10" fill="#fff" opacity=".35" :filter="`url(#${uid}-b2)`" />
      <ellipse cx="35" cy="25" rx="7" ry="3.6" fill="#fff" opacity=".95" transform="rotate(-25 35 25)" />
      <circle cx="50" cy="50" r="43.4" fill="none" :stroke="`url(#${uid}-rim)`" :stroke-width="full ? 1.2 : 3" />

      <g v-if="prod" data-orb-prod>
        <path
          v-if="full"
          :d="ARC"
          fill="none"
          :stroke="`url(#${uid}-prod)`"
          stroke-width="4"
          :filter="`url(#${uid}-b2)`"
        />
        <path :d="ARC" fill="none" :stroke="`url(#${uid}-prod)`" :stroke-width="full ? 1.6 : 5" stroke-linecap="round" />
      </g>
    </svg>
    <span
      v-if="noticing"
      data-orb-notice
      class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-[#3a7ce8] ring-2 ring-default"
    />
  </span>
</template>

<style scoped>
.orb {
  /* Fixed brand-blue palette (spec section 3), not the user's accent. */
  --orb-b0: #a9e6ff;
  --orb-b1: #3a7ce8;
  --orb-b2: #2a2f9c;
  --orb-b3: #140f5c;
  --orb-l1: #5ee7ff;
  --orb-l2: oklch(0.62 0.18 295);
  --orb-l3: #c9ecff;
  --orb-glow: #6f8cff;
  --orb-caustic: color-mix(in oklab, #3a7ce8 40%, #c9f5ff);
  --orb-glow-scale: 1;
  --orb-o1: 11s;
  --orb-o2: 17s;
  --orb-glow-dur: 5s;
  --orb-glow-lo: 0.35;
  --orb-glow-hi: 0.6;
}
.orb[data-companion-state='listening'] {
  --orb-o1: 40s;
  --orb-o2: 60s;
  --orb-glow-dur: 3s;
  --orb-glow-lo: 0.6;
  --orb-glow-hi: 0.75;
}
.orb[data-companion-state='thinking'] {
  --orb-o1: 2.4s;
  --orb-o2: 3.6s;
  --orb-glow-dur: 1.1s;
  --orb-glow-lo: 0.4;
  --orb-glow-hi: 0.9;
}
.orb[data-companion-state='streaming'] {
  --orb-glow-dur: 2s;
  --orb-glow-lo: 0.55;
  --orb-glow-hi: 0.55;
}
.orb[data-companion-state='error'] {
  --orb-b0: #d4d4d8;
  --orb-b1: #71717a;
  --orb-b2: #3f3f46;
  --orb-b3: #18181b;
  --orb-l1: #a1a1aa;
  --orb-l2: #71717a;
  --orb-l3: #d4d4d8;
  --orb-caustic: #d4d4d8;
  --orb-glow: var(--ui-warning);
  --orb-glow-dur: 2.6s;
  --orb-glow-lo: 0.3;
  --orb-glow-hi: 0.6;
}

.orb :is(stop, circle, ellipse) {
  transition:
    opacity var(--ferry-motion-standard) var(--ferry-motion-ease-spring),
    stop-color var(--ferry-motion-standard) var(--ferry-motion-ease-spring),
    fill var(--ferry-motion-standard) var(--ferry-motion-ease-spring);
}

.orb-glow {
  opacity: calc(var(--orb-glow-lo) * var(--orb-glow-scale));
  animation: orb-breathe var(--orb-glow-dur) ease-in-out infinite;
}
.orb[data-lifting] .orb-glow {
  animation: none;
  opacity: calc(0.9 * var(--orb-glow-scale));
  transition-duration: var(--ferry-motion-fast);
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
.orb[data-companion-state='error'] :is(.orb-orbit1, .orb-orbit2, .orb-caustic) {
  animation: none;
}

.orb-caustic {
  fill: var(--orb-caustic);
  opacity: 0.7;
  animation: orb-shimmer 3.5s ease-in-out infinite;
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
@keyframes orb-shimmer {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 0.85;
  }
}
</style>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { buildRailMarks, railPositionToIndex } from '../../utils/logRail'
import type { ParsedTailLine } from '../../utils/tailLineCache'

const props = defineProps<{
  items: readonly ParsedTailLine[]
  matchedIndices: ReadonlySet<number>
  pinned: ReadonlySet<number>
  /** Visible window as 0..1 ratios of the whole scroll height. */
  thumbTop: number
  thumbHeight: number
}>()

const emit = defineEmits<{ jump: [index: number] }>()

const BUCKET_PX = 3
const railEl = ref<HTMLDivElement | null>(null)
const height = ref(0)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!railEl.value) return
  height.value = railEl.value.clientHeight
  observer = new ResizeObserver(() => {
    height.value = railEl.value?.clientHeight ?? 0
  })
  observer.observe(railEl.value)
})
onUnmounted(() => observer?.disconnect())

const bucketCount = computed(() => Math.max(1, Math.floor(height.value / BUCKET_PX)))
const marks = computed(() =>
  buildRailMarks(props.items, props.matchedIndices, props.pinned, bucketCount.value)
)

function jumpFromEvent(e: PointerEvent): void {
  const rect = railEl.value?.getBoundingClientRect()
  if (!rect || rect.height === 0) return
  emit('jump', railPositionToIndex((e.clientY - rect.top) / rect.height, props.items.length))
}

function onPointerDown(e: PointerEvent): void {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  jumpFromEvent(e)
}

function onPointerMove(e: PointerEvent): void {
  if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) jumpFromEvent(e)
}
</script>

<template>
  <div
    ref="railEl"
    aria-hidden="true"
    class="relative w-2.5 shrink-0 cursor-pointer touch-none select-none border-l border-muted bg-muted/20"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
  >
    <div class="absolute inset-0 flex flex-col">
      <div v-for="(m, i) in marks" :key="i" class="relative min-h-0 flex-1">
        <span
          v-if="m.error || m.warn"
          class="absolute inset-0"
          :class="m.error ? 'bg-rose-500 dark:bg-rose-400' : 'bg-amber-500 dark:bg-amber-400'"
        />
        <span v-if="m.match" class="absolute inset-y-0 left-0 w-1/2 bg-primary" />
        <span v-if="m.pinned" class="absolute inset-y-0 right-0 w-1/2 bg-sky-500 dark:bg-sky-400" />
      </div>
    </div>
    <div
      class="pointer-events-none absolute inset-x-0 rounded-xs bg-default/40 ring-1 ring-inset ring-accented"
      :style="{ top: `${thumbTop * 100}%`, height: `max(6px, ${thumbHeight * 100}%)` }"
    />
  </div>
</template>

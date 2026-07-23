<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useTailStreamsStore } from '../../stores/tailStreams.store'

const props = defineProps<{ tailId: string }>()

const tailStreams = useTailStreamsStore()

const lines = computed(() => tailStreams.linesMap[props.tailId] || [])
const ended = computed(() => tailStreams.endedMap[props.tailId] || false)
const error = computed(() => tailStreams.errorMap[props.tailId])

const containerRef = ref<HTMLDivElement | null>(null)
const autoScroll = ref(true)

function isNearBottom(): boolean {
  const el = containerRef.value
  if (!el) {
    return true
  }
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

function onScroll(): void {
  autoScroll.value = isNearBottom()
}

function scrollToBottom(): void {
  const el = containerRef.value
  if (!el) {
    return
  }
  el.scrollTop = el.scrollHeight
  autoScroll.value = true
}

watch(lines, () => {
  if (!autoScroll.value) {
    return
  }
  void nextTick(scrollToBottom)
})
</script>

<template>
  <div class="relative flex h-full flex-col">
    <div
      ref="containerRef"
      class="min-h-0 flex-1 overflow-y-auto bg-default px-3 py-1 font-mono text-[11px] leading-relaxed"
      @scroll="onScroll"
    >
      <div v-for="(line, i) in lines" :key="i" class="whitespace-pre-wrap text-default">{{ line }}</div>
      <p v-if="lines.length === 0" class="py-6 text-center text-xs text-muted">Waiting for output…</p>
    </div>
    <div v-if="error" class="border-t border-muted px-3 py-1 text-xs text-error">{{ error }}</div>
    <div v-else-if="ended" class="border-t border-muted px-3 py-1 text-xs text-muted">Stream ended</div>
    <UButton
      v-if="!autoScroll"
      label="Jump to latest"
      icon="i-lucide-arrow-down"
      size="xs"
      color="primary"
      variant="soft"
      class="absolute bottom-3 right-3"
      @click="scrollToBottom"
    />
  </div>
</template>

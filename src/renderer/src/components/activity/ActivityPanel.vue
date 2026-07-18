<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useOperationsStore } from '../../stores/operations.store'
import ActivityItem from './ActivityItem.vue'

const operations = useOperationsStore()

// One shared 1s ticker for every row's elapsed-time display, running only
// while at least one operation is in flight.
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

function syncTicker(): void {
  const shouldTick = operations.runningCount > 0
  if (shouldTick && !ticker) {
    now.value = Date.now()
    ticker = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  } else if (!shouldTick && ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

watch(() => operations.runningCount, syncTicker)
onMounted(syncTicker)
onBeforeUnmount(() => {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
})

const hasFinished = computed(() => operations.list.some((op) => op.state !== 'started' && op.state !== 'progress'))
</script>

<template>
  <div class="flex h-full flex-col">
    <div v-if="operations.list.length > 0" class="flex shrink-0 items-center justify-end border-b border-muted px-2 py-1">
      <UButton
        v-if="hasFinished"
        label="Clear finished"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="operations.clearFinished()"
      />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="operations.list.length === 0" class="px-3 py-6 text-center text-xs text-muted">
        Long-running operations (extract, compress, delete) appear here
      </p>
      <ActivityItem
        v-for="op in operations.list"
        :key="op.operationId"
        :kind="op.kind"
        :state="op.state"
        :label="op.label"
        :started-at="op.startedAt"
        :cancellable="op.cancellable"
        :progress-current="op.progressCurrent"
        :progress-total="op.progressTotal"
        :progress-unit="op.progressUnit"
        :error="op.error"
        :now="now"
        @cancel="operations.cancel(op.operationId)"
      />
    </div>
  </div>
</template>

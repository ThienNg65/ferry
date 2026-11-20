<script setup lang="ts">
import { computed, onMounted, ref, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useTransferQueueStore } from '../../stores/transferQueue.store'
import TransferItem from './TransferItem.vue'

const store = useTransferQueueStore()

onMounted(() => {
  store.ensureSubscription()
})

const scrollEl = ref<HTMLElement | null>(null)
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: store.list.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => 68,
    overscan: 6,
    getItemKey: (index: number) => store.list[index]?.transferId ?? index
  }))
)
const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems())

function measureRow(el: Element | ComponentPublicInstance | null): void {
  if (el instanceof Element) {
    rowVirtualizer.value.measureElement(el)
  }
}

const hasFinished = computed(() =>
  store.list.some((item) => item.state === 'done' || item.state === 'error' || item.state === 'cancelled')
)
</script>

<template>
  <div class="flex h-full flex-col">
    <div v-if="store.list.length > 0" class="flex shrink-0 items-center justify-between border-b border-muted px-2 py-1">
      <span class="text-xs text-muted">
        {{ store.summary.filesDone }} of {{ store.summary.filesTotal }} · {{ store.summary.percent }}%
      </span>
      <UButton
        v-if="hasFinished"
        label="Clear finished"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="store.clearFinished()"
      />
    </div>
    <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="store.list.length === 0" class="flex h-full flex-col items-center justify-center gap-1.5 px-3 py-6 text-center select-none">
        <div class="rounded-full bg-muted/50 p-2.5 ring-1 ring-default/15">
          <UIcon name="i-lucide-arrow-down-up" class="size-5 text-muted" />
        </div>
        <p class="text-xs font-medium text-default">No transfers yet</p>
        <p class="max-w-sm text-2xs text-muted">Drag files between panes or press F5 on selected items to upload or download.</p>
      </div>
      <div v-else class="relative w-full" :style="{ height: `${rowVirtualizer.getTotalSize()}px` }">
        <div
          v-for="row in virtualRows"
          :key="row.key as string | number"
          :ref="measureRow"
          :data-index="row.index"
          class="absolute left-0 top-0 w-full"
          :style="{ transform: `translateY(${row.start}px)` }"
        >
          <TransferItem
            v-if="store.list[row.index]"
            :kind="store.list[row.index].kind"
            :state="store.list[row.index].state"
            :local-path="store.list[row.index].localPath"
            :remote-path="store.list[row.index].remotePath"
            :bytes-transferred="store.list[row.index].bytesTransferred"
            :total-bytes="store.list[row.index].totalBytes"
            :bytes-per-sec="store.list[row.index].bytesPerSec"
            :eta-ms="store.list[row.index].etaMs"
            :error="store.list[row.index].error"
            @cancel="store.cancel(store.list[row.index].transferId)"
            @retry="store.retry(store.list[row.index].transferId)"
            @pause="store.pause(store.list[row.index].transferId)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

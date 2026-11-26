<script setup lang="ts">
import { computed, onMounted, ref, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useNotify } from '../../composables/useNotify'
import { useSettingsStore } from '../../stores/settings.store'
import { useTransferQueueStore } from '../../stores/transferQueue.store'
import { BANDWIDTH_PRESETS, formatBandwidthCap } from '../../utils/bandwidth'
import TransferItem from './TransferItem.vue'

const store = useTransferQueueStore()
const settings = useSettingsStore()
const notify = useNotify()

onMounted(() => {
  store.ensureSubscription()
  if (!settings.loaded) {
    void settings.fetch()
  }
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

const isBandwidthCapped = computed(() => settings.bandwidthLimitKBps !== null && settings.bandwidthLimitKBps > 0)
const bandwidthLabel = computed(() => formatBandwidthCap(settings.bandwidthLimitKBps))

async function applyBandwidthLimit(limitKBps: number | null): Promise<void> {
  try {
    await settings.setBandwidthLimitKBps(limitKBps)
  } catch (err) {
    notify.error('Failed to update speed limit', err instanceof Error ? err.message : String(err))
  }
}

const bandwidthMenuItems = computed(() => {
  const current = settings.bandwidthLimitKBps
  const hasCustom = current !== null && !BANDWIDTH_PRESETS.some((p) => p.limitKBps === current)
  const items = BANDWIDTH_PRESETS.map((preset) => ({
    type: 'checkbox' as const,
    label: preset.label,
    checked: current === preset.limitKBps,
    onSelect: () => void applyBandwidthLimit(preset.limitKBps)
  }))
  if (hasCustom) {
    items.push({
      type: 'checkbox' as const,
      label: `Custom (${formatBandwidthCap(current)})`,
      checked: true,
      onSelect: () => {}
    })
  }
  return [items]
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-muted px-2 py-1">
      <span class="truncate text-xs text-muted">
        <template v-if="store.list.length > 0">
          {{ store.summary.filesDone }} of {{ store.summary.filesTotal }} · {{ store.summary.percent }}%
        </template>
        <template v-else>
          Transfer queue
        </template>
      </span>
      <div class="flex shrink-0 items-center gap-1">
        <UDropdownMenu :items="bandwidthMenuItems" :content="{ align: 'end' }">
          <UButton
            icon="i-lucide-gauge"
            :label="`Speed: ${bandwidthLabel}`"
            :color="isBandwidthCapped ? 'primary' : 'neutral'"
            :variant="isBandwidthCapped ? 'soft' : 'ghost'"
            size="xs"
            :aria-label="`Transfer speed limit: ${bandwidthLabel}`"
          />
        </UDropdownMenu>
        <UButton
          v-if="hasFinished"
          label="Clear finished"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="store.clearFinished()"
        />
      </div>
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
            :reconnect-required="store.list[row.index].reconnectRequired"
            :restart-required="store.list[row.index].restartRequired"
            @cancel="store.cancel(store.list[row.index].transferId)"
            @retry="store.retry(store.list[row.index].transferId, store.list[row.index].restartRequired)"
            @pause="store.pause(store.list[row.index].transferId)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

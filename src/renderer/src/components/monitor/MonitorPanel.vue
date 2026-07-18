<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useMonitorStore } from '../../stores/monitor.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { formatBytes, formatUptime } from '../../utils/format'

const monitor = useMonitorStore()
const sessions = useSessionsStore()

/** Caps the per-core bar strip — beyond this a "+N more" label stands in for the rest. */
const MAX_CORE_BARS = 32

async function switchTo(sessionId: string | null, previous: string | null): Promise<void> {
  if (previous && previous !== sessionId) {
    await monitor.stop(previous)
  }
  if (sessionId && sessions.status === 'connected') {
    await monitor.start(sessionId)
  }
}

watch(
  () => sessions.activeSessionId,
  (sessionId, previousSessionId) => void switchTo(sessionId, previousSessionId ?? null)
)

onMounted(() => void switchTo(sessions.activeSessionId, null))
onBeforeUnmount(() => {
  if (sessions.activeSessionId) {
    void monitor.stop(sessions.activeSessionId)
  }
})

const memPercent = computed(() => {
  const mem = monitor.latest?.memory
  return mem && mem.totalBytes > 0 ? Math.round((mem.usedBytes / mem.totalBytes) * 100) : 0
})
const swapPercent = computed(() => {
  const swap = monitor.latest?.swap
  return swap && swap.totalBytes > 0 ? Math.round((swap.usedBytes / swap.totalBytes) * 100) : 0
})

const sparklinePoints = computed(() => {
  const samples = monitor.history.filter((s) => s.cpu !== null)
  if (samples.length < 2) {
    return ''
  }
  const width = 100
  const height = 32
  const step = width / (samples.length - 1)
  return samples
    .map((s, i) => {
      const pct = s.cpu?.aggregatePct ?? 0
      const x = i * step
      const y = height - (pct / 100) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})

const visibleCores = computed(() => monitor.latest?.cpu?.perCorePct.slice(0, MAX_CORE_BARS) ?? [])
const hiddenCoreCount = computed(() => Math.max(0, (monitor.latest?.cpu?.perCorePct.length ?? 0) - MAX_CORE_BARS))
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto">
    <div v-if="monitor.status === 'unsupported'" class="flex flex-1 flex-col items-center justify-center gap-1 px-3 py-6 text-center">
      <UIcon name="i-lucide-monitor-off" class="size-5 text-dimmed" />
      <p class="text-xs text-dimmed">{{ monitor.statusMessage || 'Resource monitoring is not supported on this server' }}</p>
    </div>
    <div v-else-if="monitor.status === 'error'" class="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-6 text-center">
      <UIcon name="i-lucide-circle-alert" class="size-5 text-error" />
      <p class="text-xs text-error">{{ monitor.statusMessage || 'Resource monitoring failed' }}</p>
      <UButton
        label="Retry"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="sessions.activeSessionId && monitor.start(sessions.activeSessionId)"
      />
    </div>
    <div v-else-if="!monitor.latest" class="flex flex-1 items-center justify-center px-3 py-6 text-center">
      <p class="text-xs text-muted">Gathering resource samples…</p>
    </div>
    <div v-else class="grid grid-cols-[1fr_1fr_auto] gap-4 px-3 py-2 text-xs">
      <!-- Memory -->
      <div class="flex flex-col gap-1.5">
        <span class="font-medium text-default">Memory</span>
        <UProgress :model-value="memPercent" color="primary" size="sm" />
        <span class="text-[11px] text-dimmed">
          {{ formatBytes(monitor.latest.memory.usedBytes) }} / {{ formatBytes(monitor.latest.memory.totalBytes) }}
        </span>
        <template v-if="monitor.latest.swap.totalBytes > 0">
          <UProgress :model-value="swapPercent" color="neutral" size="xs" class="mt-1" />
          <span class="text-[11px] text-dimmed">
            Swap {{ formatBytes(monitor.latest.swap.usedBytes) }} / {{ formatBytes(monitor.latest.swap.totalBytes) }}
          </span>
        </template>
        <span class="text-[11px] text-dimmed">
          buffers {{ formatBytes(monitor.latest.memory.buffersBytes) }} · cached {{ formatBytes(monitor.latest.memory.cachedBytes) }}
        </span>
      </div>

      <!-- CPU -->
      <div class="flex flex-col gap-1.5">
        <span class="font-medium text-default">CPU</span>
        <div class="flex items-baseline gap-2">
          <span class="text-lg font-semibold text-primary">
            {{ monitor.latest.cpu ? `${monitor.latest.cpu.aggregatePct}%` : '—' }}
          </span>
          <svg viewBox="0 0 100 32" class="h-6 w-16 text-primary" preserveAspectRatio="none">
            <polyline :points="sparklinePoints" fill="none" stroke="currentColor" stroke-width="2" />
          </svg>
        </div>
        <div class="flex flex-wrap gap-0.5">
          <div v-for="(pct, i) in visibleCores" :key="i" class="h-6 w-1.5 overflow-hidden rounded-sm bg-elevated">
            <div class="w-full bg-primary" :style="{ height: `${pct}%`, marginTop: `${100 - pct}%` }" />
          </div>
          <span v-if="hiddenCoreCount > 0" class="self-end text-[10px] text-dimmed">+{{ hiddenCoreCount }} more</span>
        </div>
      </div>

      <!-- Facts -->
      <div class="flex flex-col items-end gap-1 text-right text-[11px] text-muted">
        <span>{{ monitor.latest.loadAvg.map((n) => n.toFixed(2)).join(' / ') }}</span>
        <span>{{ formatUptime(monitor.latest.uptimeSec) }} uptime</span>
        <span>{{ monitor.latest.cpu?.coreCount ?? '—' }} cores</span>
      </div>
    </div>
  </div>
</template>

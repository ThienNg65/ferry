<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { MONITOR_INTERVAL_OPTIONS, useMonitorStore } from '../../stores/monitor.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useDockState } from '../../composables/useDockState'
import { formatBytes, formatElapsed, formatUptime } from '../../utils/format'
import {
  buildSparklineGeometry,
  computeMemoryBreakdown,
  loadTone,
  usageTone,
  type MonitorTone
} from '../../utils/monitorHelpers'
import ProcessTable from './ProcessTable.vue'

const monitor = useMonitorStore()
const sessions = useSessionsStore()
const { isMaximized, toggleMaximize } = useDockState()
const cpuGradId = useId()

/** Caps the per-core bar strip in the summary card — beyond this a "+N" badge stands in for the rest. */
const MAX_CORE_BARS = 24
const SPARKLINE_W = 180
const SPARKLINE_H = 38

let switchToken = 0

async function switchTo(sessionId: string | null, previous: string | null): Promise<void> {
  const token = ++switchToken
  if (previous && previous !== sessionId) {
    await monitor.stop(previous)
    if (token !== switchToken) return
  }
  if (sessionId && sessions.status === 'connected' && !monitor.bySession[sessionId]?.paused) {
    await monitor.start(sessionId)
    if (token !== switchToken) return
  }
}

watch(
  [() => sessions.activeSessionId, () => sessions.status],
  ([sessionId, status], [previousSessionId, prevStatus]) => {
    if (sessionId !== previousSessionId) {
      void switchTo(sessionId, previousSessionId ?? null)
    } else if (status === 'connected' && prevStatus !== 'connected') {
      void switchTo(sessionId, null)
    }
  }
)

const now = ref(Date.now())
let ageTicker: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void switchTo(sessions.activeSessionId, null)
  ageTicker = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (ageTicker) {
    clearInterval(ageTicker)
    ageTicker = null
  }
  if (sessions.activeSessionId) {
    void monitor.stop(sessions.activeSessionId)
  }
})

const intervalItems = MONITOR_INTERVAL_OPTIONS.map((ms) => ({
  label: `${ms / 1000}s`,
  value: ms
}))

const selectedInterval = computed({
  get: () => monitor.intervalMs,
  set: (ms: number) => void monitor.setIntervalMs(sessions.activeSessionId, ms)
})

function togglePause(): void {
  const sessionId = sessions.activeSessionId
  if (!sessionId) return
  if (monitor.paused) {
    void monitor.resume(sessionId)
  } else {
    void monitor.pause(sessionId)
  }
}

function toneTextClass(tone: MonitorTone): string {
  if (tone === 'error') return 'text-error'
  if (tone === 'warning') return 'text-warning'
  return 'text-primary'
}

function toneBgClass(tone: MonitorTone): string {
  if (tone === 'error') return 'bg-error'
  if (tone === 'warning') return 'bg-warning'
  return 'bg-primary'
}

const memPercent = computed(() => {
  const mem = monitor.latest?.memory
  return mem && mem.totalBytes > 0 ? Math.round((mem.usedBytes / mem.totalBytes) * 100) : 0
})

const swapPercent = computed(() => {
  const swap = monitor.latest?.swap
  return swap && swap.totalBytes > 0 ? Math.round((swap.usedBytes / swap.totalBytes) * 100) : 0
})

const diskPercent = computed(() => {
  const disk = monitor.latest?.disk
  return disk && disk.totalBytes > 0 ? Math.round((disk.usedBytes / disk.totalBytes) * 100) : 0
})

const memoryBreakdown = computed(() =>
  monitor.latest ? computeMemoryBreakdown(monitor.latest.memory) : null
)

const cpuSamples = computed(() => monitor.history.filter((s) => s.cpuPct !== null))

const cpuSparkline = computed(() =>
  buildSparklineGeometry(
    cpuSamples.value.map((s) => s.cpuPct ?? 0),
    SPARKLINE_W,
    SPARKLINE_H
  )
)

const hoveredIndex = ref<number | null>(null)

function onSparklineMove(e: PointerEvent): void {
  const coords = cpuSparkline.value.coords
  if (coords.length === 0) return
  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
  if (rect.width <= 0) return
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  hoveredIndex.value = Math.round(ratio * (coords.length - 1))
}

const hoveredCpu = computed(() => {
  if (hoveredIndex.value === null) return null
  const point = cpuSparkline.value.coords[hoveredIndex.value]
  const sample = cpuSamples.value[hoveredIndex.value]
  if (!point || !sample) return null
  const agoSec = Math.max(0, Math.round((now.value - sample.timestamp) / 1000))
  return {
    ...point,
    agoLabel: agoSec <= 1 ? 'now' : `-${agoSec}s`
  }
})

const visibleCores = computed(() => monitor.latest?.cpu?.perCorePct.slice(0, MAX_CORE_BARS) ?? [])
const hiddenCoreCount = computed(() =>
  Math.max(0, (monitor.latest?.cpu?.perCorePct.length ?? 0) - MAX_CORE_BARS)
)

const currentLoadTone = computed(() =>
  loadTone(monitor.latest?.loadAvg[0] ?? 0, monitor.latest?.cpu?.coreCount ?? 1)
)

const sampleAgeLabel = computed(() => {
  if (!monitor.latest) return ''
  const diff = now.value - monitor.latest.timestamp
  return diff < 2500 ? 'just now' : `${formatElapsed(diff)} ago`
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <!-- Top Toolbar -->
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-muted bg-muted/30 px-3 py-1.5">
      <div class="flex items-center gap-3 text-xs">
        <div class="flex items-center gap-1.5">
          <span
            class="size-2 shrink-0 rounded-full"
            :class="
              monitor.status === 'error'
                ? 'bg-error'
                : monitor.paused
                  ? 'bg-warning'
                  : monitor.latest
                    ? 'bg-success animate-pulse'
                    : 'bg-primary animate-pulse'
            "
          />
          <span class="font-medium text-default">
            {{
              monitor.status === 'error'
                ? 'Error'
                : monitor.status === 'unsupported'
                  ? 'Unsupported'
                  : monitor.paused
                    ? 'Paused'
                    : monitor.latest
                      ? 'Live'
                      : 'Connecting…'
            }}
          </span>
          <span v-if="sampleAgeLabel" class="text-2xs text-muted tabular-nums">
            · {{ sampleAgeLabel }}
          </span>
        </div>

        <template v-if="monitor.latest">
          <span class="hidden h-3 w-px bg-default/40 sm:inline-block" />
          <UTooltip text="System load average (1m / 5m / 15m) compared against CPU core count">
            <div class="hidden items-center gap-1.5 text-2xs sm:flex">
              <span class="text-muted">Load</span>
              <span class="font-mono font-medium tabular-nums" :class="toneTextClass(currentLoadTone)">
                {{ monitor.latest.loadAvg.map((n) => n.toFixed(2)).join(' / ') }}
              </span>
            </div>
          </UTooltip>
          <span class="hidden h-3 w-px bg-default/40 md:inline-block" />
          <div class="hidden items-center gap-1 text-2xs md:flex">
            <UIcon name="i-lucide-clock" class="size-3 text-muted" />
            <span class="text-muted">Up</span>
            <span class="font-mono text-default tabular-nums">{{ formatUptime(monitor.latest.uptimeSec) }}</span>
          </div>
        </template>
      </div>

      <div class="flex items-center gap-1">
        <UTooltip text="Polling interval">
          <USelect
            v-model="selectedInterval"
            :items="intervalItems"
            value-key="value"
            size="xs"
            class="w-16"
            aria-label="Polling interval"
            :disabled="!sessions.activeSessionId || sessions.status !== 'connected' || monitor.status === 'unsupported'"
          />
        </UTooltip>
        <UTooltip :text="monitor.paused ? 'Resume monitoring' : 'Pause monitoring'">
          <UButton
            :icon="monitor.paused ? 'i-lucide-play' : 'i-lucide-pause'"
            :color="monitor.paused ? 'primary' : 'neutral'"
            :variant="monitor.paused ? 'soft' : 'ghost'"
            size="xs"
            :aria-label="monitor.paused ? 'Resume monitoring' : 'Pause monitoring'"
            :disabled="!sessions.activeSessionId || monitor.status === 'unsupported'"
            @click="togglePause"
          />
        </UTooltip>
        <UTooltip :text="isMaximized ? 'Restore dock size' : 'Maximize dock'">
          <UButton
            :icon="isMaximized ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="isMaximized ? 'Restore dock size' : 'Maximize dock'"
            @click="toggleMaximize"
          />
        </UTooltip>
      </div>
    </div>

    <!-- Empty / Error / Loading States -->
    <div
      v-if="monitor.status === 'unsupported'"
      class="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-6 text-center select-none"
    >
      <div class="rounded-full bg-muted/60 p-3 ring-1 ring-default/20">
        <UIcon name="i-lucide-monitor-off" class="size-6 text-muted" />
      </div>
      <p class="text-xs font-semibold text-default">Monitoring unavailable</p>
      <p class="max-w-sm text-2xs text-muted">
        {{ monitor.statusMessage || 'Resource monitoring requires a Linux host with /proc filesystem access.' }}
      </p>
    </div>

    <div
      v-else-if="monitor.status === 'error' && !monitor.latest"
      role="alert"
      class="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-6 text-center select-none"
    >
      <div class="rounded-full bg-error/10 p-3 ring-1 ring-error/25">
        <UIcon name="i-lucide-circle-alert" class="size-6 text-error" />
      </div>
      <p class="text-xs font-semibold text-error">Resource monitoring failed</p>
      <p class="max-w-sm text-2xs text-muted">{{ monitor.statusMessage || 'Unable to collect server metrics.' }}</p>
      <UButton
        label="Retry"
        icon="i-lucide-rotate-cw"
        color="neutral"
        variant="soft"
        size="xs"
        @click="sessions.activeSessionId && monitor.start(sessions.activeSessionId)"
      />
    </div>

    <div
      v-else-if="!monitor.latest"
      class="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-6 text-center select-none"
    >
      <div class="rounded-full bg-muted/60 p-3 ring-1 ring-default/20">
        <UIcon name="i-lucide-activity" class="size-6 text-primary animate-pulse" />
      </div>
      <p class="text-xs font-semibold text-default">Gathering resource samples…</p>
      <p class="text-2xs text-muted">Reading CPU, memory, disk, and active processes from the remote host.</p>
    </div>

    <!-- Main Monitor Dashboard -->
    <div v-else class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        v-if="monitor.status === 'error'"
        role="alert"
        class="flex shrink-0 items-center justify-between gap-2 border-b border-error/25 bg-error/10 px-3 py-1 text-2xs text-error"
      >
        <div class="flex min-w-0 items-center gap-1.5">
          <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
          <span class="truncate">{{ monitor.statusMessage || 'Resource monitoring failed — showing last known sample.' }}</span>
        </div>
        <UButton
          label="Retry"
          icon="i-lucide-rotate-cw"
          color="error"
          variant="soft"
          size="xs"
          @click="sessions.activeSessionId && monitor.start(sessions.activeSessionId)"
        />
      </div>
      <div class="grid shrink-0 grid-cols-1 gap-2.5 p-2.5 md:grid-cols-3">
        <!-- CPU Card -->
        <div class="flex flex-col justify-between gap-2 rounded-lg border border-default bg-muted/25 p-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              <UIcon name="i-lucide-cpu" class="size-3.5 text-muted" />
              <span class="text-xs font-semibold text-default">CPU</span>
              <UBadge
                v-if="monitor.latest.cpu"
                :label="`${monitor.latest.cpu.coreCount}c`"
                color="neutral"
                variant="soft"
                size="xs"
              />
            </div>
            <div class="flex items-baseline gap-1.5">
              <span v-if="hoveredCpu" class="font-mono text-2xs text-muted tabular-nums">
                {{ Math.round(hoveredCpu.value) }}% ({{ hoveredCpu.agoLabel }})
              </span>
              <span
                v-if="monitor.latest.cpu"
                class="font-mono text-sm font-semibold tabular-nums"
                :class="toneTextClass(usageTone(monitor.latest.cpu.aggregatePct))"
              >
                {{ `${monitor.latest.cpu.aggregatePct.toFixed(1)}%` }}
              </span>
              <UBadge v-else label="Sampling…" color="neutral" variant="soft" size="xs" />
            </div>
          </div>

          <!-- Interactive Area Sparkline -->
          <div class="relative h-10 w-full overflow-hidden rounded bg-default/40 px-1 py-0.5 ring-1 ring-default/20">
            <svg
              v-if="cpuSparkline.linePoints"
              :viewBox="`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`"
              class="h-full w-full cursor-crosshair text-primary"
              preserveAspectRatio="none"
              @pointermove="onSparklineMove"
              @pointerleave="hoveredIndex = null"
            >
              <defs>
                <linearGradient :id="cpuGradId" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="currentColor" stop-opacity="0.28" />
                  <stop offset="100%" stop-color="currentColor" stop-opacity="0.02" />
                </linearGradient>
              </defs>
              <polygon :points="cpuSparkline.areaPoints" :fill="`url(#${cpuGradId})`" />
              <polyline
                :points="cpuSparkline.linePoints"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
              <line
                v-if="hoveredCpu"
                :x1="hoveredCpu.x"
                y1="0"
                :x2="hoveredCpu.x"
                :y2="SPARKLINE_H"
                stroke="currentColor"
                stroke-opacity="0.35"
                stroke-dasharray="2 2"
                stroke-width="1"
              />
              <circle v-if="hoveredCpu" :cx="hoveredCpu.x" :cy="hoveredCpu.y" r="2.5" fill="currentColor" />
            </svg>
            <div v-else class="flex h-full items-center justify-center text-2xs text-muted">
              Collecting CPU history…
            </div>
          </div>

          <!-- Per-core utilization strip -->
          <div class="flex items-center gap-1.5">
            <div class="flex flex-1 flex-wrap items-end gap-0.5">
              <UTooltip
                v-for="(pct, i) in visibleCores"
                :key="i"
                :text="`Core ${i}: ${Math.round(pct)}%`"
              >
                <div class="h-3.5 w-1.5 overflow-hidden rounded-xs bg-elevated">
                  <div
                    class="h-full w-full origin-bottom transform-gpu transition-transform duration-500 ease-out motion-reduce:transition-none"
                    :class="toneBgClass(usageTone(pct))"
                    :style="{ transform: `scaleY(${Math.min(1, Math.max(0.08, pct / 100))})` }"
                  />
                </div>
              </UTooltip>
              <span v-if="hiddenCoreCount > 0" class="ml-0.5 text-[10px] text-muted tabular-nums">
                +{{ hiddenCoreCount }}
              </span>
            </div>
            <span class="shrink-0 text-[10px] text-muted">per-core</span>
          </div>
        </div>

        <!-- Memory & Swap Card -->
        <div class="flex flex-col justify-between gap-2 rounded-lg border border-default bg-muted/25 p-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              <UIcon name="i-lucide-memory-stick" class="size-3.5 text-muted" />
              <span class="text-xs font-semibold text-default">Memory</span>
            </div>
            <div class="flex items-baseline gap-1.5">
              <span class="text-2xs text-muted tabular-nums">
                {{ formatBytes(monitor.latest.memory.usedBytes) }} / {{ formatBytes(monitor.latest.memory.totalBytes) }}
              </span>
              <span class="font-mono text-sm font-semibold tabular-nums" :class="toneTextClass(usageTone(memPercent))">
                {{ memPercent }}%
              </span>
            </div>
          </div>

          <!-- Segmented Memory Breakdown Bar -->
          <div v-if="memoryBreakdown" class="flex flex-col gap-1.5">
            <div class="flex h-2.5 w-full overflow-hidden rounded-full bg-elevated ring-1 ring-default/20">
              <UTooltip :text="`Active used: ${formatBytes(memoryBreakdown.activeBytes)} (${memoryBreakdown.activePct}%)`">
                <div
                  class="h-full transition-[width] duration-300"
                  :class="toneBgClass(usageTone(memPercent))"
                  :style="{ width: `${memoryBreakdown.activePct}%` }"
                />
              </UTooltip>
              <UTooltip :text="`Cached: ${formatBytes(memoryBreakdown.cachedBytes)} (${memoryBreakdown.cachedPct}%)`">
                <div
                  class="h-full bg-primary/40 transition-[width] duration-300"
                  :style="{ width: `${memoryBreakdown.cachedPct}%` }"
                />
              </UTooltip>
              <UTooltip :text="`Buffers: ${formatBytes(memoryBreakdown.buffersBytes)} (${memoryBreakdown.buffersPct}%)`">
                <div
                  class="h-full bg-primary/20 transition-[width] duration-300"
                  :style="{ width: `${memoryBreakdown.buffersPct}%` }"
                />
              </UTooltip>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[10px] text-muted tabular-nums">
              <span class="flex items-center gap-1">
                <span class="size-1.5 rounded-full" :class="toneBgClass(usageTone(memPercent))" />
                Used {{ formatBytes(monitor.latest.memory.usedBytes) }}
              </span>
              <span class="flex items-center gap-1">
                <span class="size-1.5 rounded-full bg-primary/40" />
                Cache {{ formatBytes(monitor.latest.memory.cachedBytes) }}
              </span>
              <span class="flex items-center gap-1">
                <span class="size-1.5 rounded-full bg-primary/20" />
                Buf {{ formatBytes(monitor.latest.memory.buffersBytes) }}
              </span>
              <span class="flex items-center gap-1">
                <span class="size-1.5 rounded-full bg-elevated ring-1 ring-default/30" />
                Avail {{ formatBytes(monitor.latest.memory.availableBytes) }}
              </span>
            </div>
          </div>

          <!-- Swap Footer -->
          <div class="flex items-center justify-between gap-2 border-t border-muted/60 pt-1.5 text-[10px] text-muted">
            <span>Swap</span>
            <template v-if="monitor.latest.swap.totalBytes > 0">
              <div class="flex flex-1 items-center gap-2">
                <UProgress
                  :model-value="swapPercent"
                  :color="usageTone(swapPercent)"
                  size="xs"
                  class="flex-1"
                />
                <span class="shrink-0 font-mono tabular-nums">
                  {{ formatBytes(monitor.latest.swap.usedBytes) }} ({{ swapPercent }}%)
                </span>
              </div>
            </template>
            <span v-else class="text-muted">Not configured</span>
          </div>
        </div>

        <!-- Storage (/) & Trend Card -->
        <div class="flex flex-col justify-between gap-2 rounded-lg border border-default bg-muted/25 p-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              <UIcon name="i-lucide-hard-drive" class="size-3.5 text-muted" />
              <span class="text-xs font-semibold text-default">Storage</span>
              <UBadge label="/" color="neutral" variant="soft" size="xs" />
            </div>
            <span
              v-if="monitor.latest.disk"
              class="font-mono text-sm font-semibold tabular-nums"
              :class="toneTextClass(usageTone(diskPercent))"
            >
              {{ diskPercent }}%
            </span>
          </div>

          <template v-if="monitor.latest.disk">
            <div class="flex flex-col gap-1.5">
              <UProgress :model-value="diskPercent" :color="usageTone(diskPercent)" size="sm" />
              <div class="flex items-center justify-between text-2xs text-muted tabular-nums">
                <span>
                  {{ formatBytes(monitor.latest.disk.usedBytes) }} / {{ formatBytes(monitor.latest.disk.totalBytes) }}
                </span>
                <span class="text-default">{{ formatBytes(monitor.latest.disk.availableBytes) }} free</span>
              </div>
            </div>
          </template>
          <p v-else class="text-2xs text-muted">Disk usage unavailable on this host</p>

          <!-- Host Process Count Footer -->
          <div class="flex items-center justify-between gap-2 border-t border-muted/60 pt-1.5 text-[10px] text-muted">
            <span>Processes</span>
            <span class="font-mono text-default tabular-nums">
              {{ monitor.latest.processTotalCount }} running
            </span>
          </div>
        </div>
      </div>

      <ProcessTable class="min-h-0 flex-1 border-t border-muted" />
    </div>
  </div>
</template>

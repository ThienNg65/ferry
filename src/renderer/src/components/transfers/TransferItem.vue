<script setup lang="ts">
import { computed } from 'vue'
import type { TransferKind, TransferState } from '@shared/contract'
import { formatBytes, formatSpeed } from '../../utils/format'

const props = defineProps<{
  kind: TransferKind
  state: TransferState
  localPath: string
  remotePath: string
  bytesTransferred: number
  totalBytes: number
  bytesPerSec?: number
  etaMs: number
  error?: string
  reconnectRequired?: boolean
  restartRequired?: boolean
}>()

const emit = defineEmits<{ cancel: []; retry: []; pause: [] }>()

const percent = computed(() =>
  props.totalBytes > 0 ? Math.min(100, Math.round((props.bytesTransferred / props.totalBytes) * 100)) : 0
)

const targetPath = computed(() => (props.kind === 'upload' ? props.remotePath : props.localPath))

const fileName = computed(() => {
  const p = targetPath.value.replace(/[/\\]+$/, '')
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(idx + 1) : p
})

const dirPath = computed(() => {
  const p = targetPath.value.replace(/[/\\]+$/, '')
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx > 0 ? p.slice(0, idx) : idx === 0 ? '/' : ''
})

const statusColor = computed(() => {
  switch (props.state) {
    case 'done':
      return 'success' as const
    case 'error':
      return 'error' as const
    case 'cancelled':
      return 'warning' as const
    default:
      return 'primary' as const
  }
})

const cancellable = computed(
  () => props.state === 'queued' || props.state === 'started' || props.state === 'progress' || props.state === 'paused'
)
const pausable = computed(() => props.state === 'queued' || props.state === 'started' || props.state === 'progress')
const retryable = computed(() => props.state === 'error' || props.state === 'paused')
const retryLabel = computed(() => {
  if (props.restartRequired) return 'Restart transfer'
  return props.state === 'paused' ? 'Resume transfer' : 'Retry transfer'
})

function formatEta(ms: number): string {
  if (!ms || ms <= 0) {
    return ''
  }
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s left` : `${Math.round(s / 60)}m left`
}

const progressRightLabel = computed(() => {
  if (props.state !== 'progress') {
    return props.state
  }
  const parts: string[] = []
  if (props.bytesPerSec && props.bytesPerSec > 0) {
    parts.push(formatSpeed(props.bytesPerSec))
  }
  const eta = formatEta(props.etaMs)
  if (eta) {
    parts.push(eta)
  }
  return parts.length > 0 ? parts.join(' · ') : 'progress'
})
</script>

<template>
  <div class="flex flex-col gap-1 border-b border-muted px-3 py-2 text-xs">
    <div class="flex items-center justify-between gap-2">
      <span
        class="flex min-w-0 items-center gap-1.5"
        :title="kind === 'upload' ? `${localPath} → ${remotePath}` : `${remotePath} → ${localPath}`"
      >
        <UIcon
          :name="kind === 'upload' ? 'i-lucide-upload' : 'i-lucide-download'"
          class="size-3.5 shrink-0 text-muted"
        />
        <span class="shrink-0 font-medium text-highlighted">{{ fileName }}</span>
        <span v-if="dirPath" class="truncate text-muted">in {{ dirPath }}</span>
      </span>
      <div class="flex shrink-0 items-center gap-1">
        <UTooltip v-if="pausable" text="Pause transfer">
          <UButton icon="i-lucide-pause" color="neutral" variant="ghost" size="xs" aria-label="Pause transfer" @click="emit('pause')" />
        </UTooltip>
        <UTooltip v-if="cancellable" text="Cancel transfer">
          <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" aria-label="Cancel transfer" @click="emit('cancel')" />
        </UTooltip>
        <UTooltip v-if="retryable" :text="reconnectRequired ? 'Reconnect to the original server' : retryLabel">
          <UButton
            :icon="state === 'paused' && !restartRequired ? 'i-lucide-play' : 'i-lucide-rotate-cw'"
            :label="restartRequired ? retryLabel : undefined"
            :aria-label="retryLabel"
            :disabled="reconnectRequired"
            color="neutral" variant="ghost" size="xs"
            @click="emit('retry')"
          />
        </UTooltip>
      </div>
    </div>
    <UProgress :model-value="percent" :color="statusColor" size="xs" />
    <div class="flex items-center justify-between text-2xs text-muted">
      <span v-if="error" class="text-error truncate">{{ error }}</span>
      <span v-else class="tabular-nums">{{ formatBytes(bytesTransferred) }} / {{ formatBytes(totalBytes) }} ({{ percent }}%)</span>
      <span v-if="reconnectRequired" class="shrink-0">Reconnect to continue</span>
      <span v-else class="font-mono tabular-nums">{{ progressRightLabel }}</span>
    </div>
  </div>
</template>

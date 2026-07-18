<script setup lang="ts">
import { computed } from 'vue'
import type { TransferKind, TransferState } from '@shared/contract'
import { formatBytes } from '../../utils/format'

const props = defineProps<{
  kind: TransferKind
  state: TransferState
  localPath: string
  remotePath: string
  bytesTransferred: number
  totalBytes: number
  etaMs: number
  error?: string
}>()

const emit = defineEmits<{ cancel: []; retry: [] }>()

const percent = computed(() =>
  props.totalBytes > 0 ? Math.min(100, Math.round((props.bytesTransferred / props.totalBytes) * 100)) : 0
)

const label = computed(() => (props.kind === 'upload' ? props.remotePath : props.localPath))

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
  () => props.state === 'queued' || props.state === 'started' || props.state === 'progress'
)
const retryable = computed(() => props.state === 'error' || props.state === 'cancelled')

function formatEta(ms: number): string {
  if (!ms || ms <= 0) {
    return ''
  }
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s left` : `${Math.round(s / 60)}m left`
}
</script>

<template>
  <div class="flex flex-col gap-1 border-b border-muted px-3 py-2 text-xs">
    <div class="flex items-center justify-between gap-2">
      <span class="flex min-w-0 items-center gap-1.5">
        <UIcon
          :name="kind === 'upload' ? 'i-lucide-upload' : 'i-lucide-download'"
          class="size-3.5 shrink-0 text-muted"
        />
        <span class="truncate">{{ label }}</span>
      </span>
      <UTooltip v-if="cancellable" text="Cancel transfer">
        <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" @click="emit('cancel')" />
      </UTooltip>
      <UTooltip v-if="retryable" text="Retry transfer">
        <UButton icon="i-lucide-rotate-cw" color="neutral" variant="ghost" size="xs" @click="emit('retry')" />
      </UTooltip>
    </div>
    <UProgress :model-value="percent" :color="statusColor" size="xs" />
    <div class="flex items-center justify-between text-[11px] text-muted">
      <span v-if="error" class="text-error truncate">{{ error }}</span>
      <span v-else>{{ formatBytes(bytesTransferred) }} / {{ formatBytes(totalBytes) }}</span>
      <span>{{ state === 'progress' ? formatEta(etaMs) : state }}</span>
    </div>
  </div>
</template>

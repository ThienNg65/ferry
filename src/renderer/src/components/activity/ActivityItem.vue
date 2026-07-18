<script setup lang="ts">
import { computed } from 'vue'
import type { OperationKind, OperationState } from '@shared/contract'
import { formatBytes, formatElapsed } from '../../utils/format'

const props = defineProps<{
  kind: OperationKind
  state: OperationState
  label: string
  startedAt: number
  cancellable: boolean
  progressCurrent?: number
  progressTotal?: number
  progressUnit?: 'bytes' | 'items'
  error?: string
  /** Shared 1s tick from ActivityPanel — one interval drives the whole list, never per-row. */
  now: number
}>()

const emit = defineEmits<{ cancel: [] }>()

const KIND_ICONS: Record<OperationKind, string> = {
  'extract-remote': 'i-lucide-package-open',
  'compress-remote': 'i-lucide-archive',
  'compress-local': 'i-lucide-archive',
  'delete-remote': 'i-lucide-trash-2',
  'delete-remote-batch': 'i-lucide-trash-2'
}

const running = computed(() => props.state === 'started' || props.state === 'progress')
const determinate = computed(() => props.progressTotal !== undefined && props.progressTotal > 0)

const percent = computed(() => {
  if (!determinate.value) {
    return 0
  }
  return Math.min(100, Math.round(((props.progressCurrent ?? 0) / (props.progressTotal ?? 1)) * 100))
})

const progressText = computed(() => {
  if (!determinate.value) {
    return ''
  }
  const current = props.progressCurrent ?? 0
  const total = props.progressTotal ?? 0
  if (props.progressUnit === 'items') {
    return `${current} / ${total} items`
  }
  return `${formatBytes(current)} / ${formatBytes(total)}`
})

const elapsed = computed(() => formatElapsed(props.now - props.startedAt))

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

// Full literal class strings (never built dynamically) so Tailwind's source
// scanner picks them up.
const statusIcon = computed(() => {
  switch (props.state) {
    case 'done':
      return { name: 'i-lucide-check', class: 'text-success' }
    case 'error':
      return { name: 'i-lucide-circle-alert', class: 'text-error' }
    case 'cancelled':
      return { name: 'i-lucide-ban', class: 'text-warning' }
    default:
      return null
  }
})
</script>

<template>
  <div class="flex flex-col gap-1 border-b border-muted px-3 py-2 text-xs">
    <div class="flex items-center justify-between gap-2">
      <span class="flex min-w-0 items-center gap-1.5">
        <UIcon :name="KIND_ICONS[kind]" class="size-3.5 shrink-0 text-muted" />
        <span class="truncate">{{ label }}</span>
      </span>
      <UTooltip v-if="cancellable && running" text="Cancel">
        <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" @click="emit('cancel')" />
      </UTooltip>
      <UIcon v-if="statusIcon" :name="statusIcon.name" class="size-3.5 shrink-0" :class="statusIcon.class" />
    </div>
    <!-- Determinate when the op reports totals; indeterminate (animated) otherwise. -->
    <UProgress v-if="determinate" :model-value="percent" :color="statusColor" size="xs" />
    <UProgress v-else-if="running" :model-value="null" color="primary" size="xs" />
    <div class="flex items-center justify-between text-[11px] text-muted">
      <span v-if="error" class="text-error truncate">{{ error }}</span>
      <span v-else-if="progressText">{{ progressText }}</span>
      <span v-else>{{ state }}</span>
      <span v-if="running">{{ elapsed }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { HistoryEntry } from '@shared/contract'
import { useHistoryStore } from '../../stores/history.store'
import { formatBytes, formatElapsed } from '../../utils/format'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const history = useHistoryStore()
const search = ref('')
const statusFilter = ref<'all' | HistoryEntry['status']>('all')

const statusOptions: { label: string; value: 'all' | HistoryEntry['status'] }[] = [
  { label: 'All', value: 'all' },
  { label: 'Done', value: 'done' },
  { label: 'Error', value: 'error' },
  { label: 'Cancelled', value: 'cancelled' }
]

async function refresh(): Promise<void> {
  await history.list({
    search: search.value.trim() || undefined,
    status: statusFilter.value === 'all' ? undefined : statusFilter.value,
    limit: 500
  })
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      search.value = ''
      statusFilter.value = 'all'
      void refresh()
    }
  }
)

watch([search, statusFilter], () => {
  if (props.open) {
    void refresh()
  }
})

function iconFor(entry: HistoryEntry): string {
  if (entry.kind === 'transfer') {
    return entry.direction === 'upload' ? 'i-lucide-upload' : 'i-lucide-download'
  }
  if (entry.operationKind === 'delete-remote' || entry.operationKind === 'delete-remote-batch') {
    return 'i-lucide-trash-2'
  }
  if (entry.operationKind === 'extract-remote') {
    return 'i-lucide-package-open'
  }
  if (entry.operationKind === 'sync') {
    return 'i-lucide-refresh-cw'
  }
  return 'i-lucide-archive'
}

const statusColor: Record<HistoryEntry['status'], 'success' | 'error' | 'neutral'> = {
  done: 'success',
  error: 'error',
  cancelled: 'neutral'
}

function formatWhen(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const entries = computed(() => history.entries)

async function clearHistory(): Promise<void> {
  await history.clear()
}

function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <UModal
    :open="open"
    title="History"
    description="Completed transfers and operations."
    :ui="{ content: 'max-w-2xl' }"
    @update:open="(v: boolean) => { if (!v) close() }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <UInput v-model="search" icon="i-lucide-search" placeholder="Filter…" class="flex-1" />
          <URadioGroup v-model="statusFilter" :items="statusOptions" orientation="horizontal" />
          <UButton color="error" variant="ghost" size="xs" icon="i-lucide-trash-2" @click="clearHistory">
            Clear
          </UButton>
        </div>
        <div class="max-h-96 overflow-y-auto rounded-md border border-muted">
          <div v-if="history.loading" class="p-4 text-center text-sm text-muted">Loading…</div>
          <div v-else-if="entries.length === 0" class="p-4 text-center text-sm text-muted">No history yet.</div>
          <div v-else class="flex flex-col divide-y divide-muted">
            <div v-for="entry in entries" :key="entry.id" class="flex items-center gap-2 px-3 py-2 text-sm">
              <UIcon :name="iconFor(entry)" class="size-4 shrink-0 text-muted" />
              <div class="min-w-0 flex-1">
                <div class="truncate">{{ entry.label }}</div>
                <div class="truncate text-xs text-dimmed">
                  <span v-if="entry.siteName">{{ entry.siteName }} · </span>
                  {{ formatWhen(entry.finishedAt) }}
                  <span v-if="entry.bytes"> · {{ formatBytes(entry.bytes) }}</span>
                  <span> · {{ formatElapsed(entry.finishedAt - entry.startedAt) }}</span>
                </div>
                <div v-if="entry.error" class="truncate text-xs text-error">{{ entry.error }}</div>
              </div>
              <UBadge :color="statusColor[entry.status]" variant="subtle" size="sm">{{ entry.status }}</UBadge>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>

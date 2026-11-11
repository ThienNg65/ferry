<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { CompareRow, CompareStatus } from '@shared/contract'
import { invoke } from '../../api'
import { useTransferQueueStore } from '../../stores/transferQueue.store'
import { useNotify } from '../../composables/useNotify'
import { formatBytes } from '../../utils/format'

const props = defineProps<{
  open: boolean
  sessionId: string | null
  initialLocalPath: string
  initialRemotePath: string
}>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const transfers = useTransferQueueStore()
const notify = useNotify()

const localPath = ref('')
const remotePath = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const rows = ref<CompareRow[] | null>(null)
const showSame = ref(false)

const STATUS_LABELS: Record<CompareStatus, string> = {
  same: 'Same',
  localOnly: 'Local only',
  remoteOnly: 'Remote only',
  localNewer: 'Local newer',
  remoteNewer: 'Remote newer',
  sizeDiff: 'Size differs'
}

const STATUS_COLORS: Record<CompareStatus, 'neutral' | 'primary' | 'warning' | 'info'> = {
  same: 'neutral',
  localOnly: 'primary',
  remoteOnly: 'info',
  localNewer: 'primary',
  remoteNewer: 'info',
  sizeDiff: 'warning'
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      localPath.value = props.initialLocalPath
      remotePath.value = props.initialRemotePath
      rows.value = null
      error.value = null
      void compare()
    }
  }
)

const visibleRows = computed(() => (rows.value ?? []).filter((r) => showSame.value || r.status !== 'same'))
const counts = computed(() => {
  const all = rows.value ?? []
  return { total: all.length, different: all.filter((r) => r.status !== 'same').length }
})

function join(root: string, relPath: string, sep: string): string {
  return `${root.replace(/[/\\]$/, '')}${sep}${relPath.split('/').join(sep)}`
}

async function compare(): Promise<void> {
  if (!props.sessionId) {
    return
  }
  loading.value = true
  error.value = null
  try {
    rows.value = await invoke<CompareRow[]>(INVOKE_CHANNELS.syncCompare, {
      sessionId: props.sessionId,
      localPath: localPath.value,
      remotePath: remotePath.value
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function copy(row: CompareRow, kind: 'upload' | 'download'): Promise<void> {
  if (!props.sessionId) {
    return
  }
  const sep = localPath.value.includes('\\') ? '\\' : '/'
  try {
    await transfers.enqueue(props.sessionId, kind, join(localPath.value, row.relPath, sep), join(remotePath.value, row.relPath, '/'))
    notify.success(kind === 'upload' ? 'Upload queued' : 'Download queued', row.relPath)
  } catch (e) {
    notify.error('Could not queue transfer', e instanceof Error ? e.message : String(e))
  }
}

function sizeText(size?: number): string {
  return size === undefined ? '' : formatBytes(size)
}
</script>

<template>
  <UModal
    :open="open"
    title="Compare folders"
    :description="`${counts.different} of ${counts.total} files differ`"
    :ui="{ footer: 'justify-end', content: 'max-w-4xl' }"
    @update:open="(v: boolean) => { if (!v) emit('update:open', false) }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <div class="flex gap-3">
          <UFormField label="Local folder" class="flex-1">
            <UInput v-model="localPath" class="w-full" />
          </UFormField>
          <UFormField label="Remote folder" class="flex-1">
            <UInput v-model="remotePath" class="w-full" />
          </UFormField>
        </div>
        <div class="flex items-center gap-3">
          <UButton color="neutral" variant="outline" :loading="loading" @click="compare">Compare</UButton>
          <label class="flex items-center gap-1.5 text-xs text-muted">
            <input v-model="showSame" type="checkbox" />
            Show identical files
          </label>
        </div>
        <UAlert v-if="error" color="error" variant="soft" :title="error" />
        <div v-if="rows" class="max-h-[50vh] overflow-y-auto rounded-md border border-default">
          <table class="w-full text-xs">
            <thead class="sticky top-0 bg-muted text-muted">
              <tr>
                <th class="px-2 py-1 text-left font-medium">Local</th>
                <th class="px-2 py-1 text-left font-medium">Path</th>
                <th class="px-2 py-1 text-left font-medium">Remote</th>
                <th class="px-2 py-1 text-left font-medium">Status</th>
                <th class="w-24 px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in visibleRows" :key="row.relPath" class="border-t border-muted">
                <td class="px-2 py-1 tabular-nums text-muted">{{ sizeText(row.localSize) }}</td>
                <td class="max-w-72 truncate px-2 py-1 text-default" :title="row.relPath">{{ row.relPath }}</td>
                <td class="px-2 py-1 tabular-nums text-muted">{{ sizeText(row.remoteSize) }}</td>
                <td class="px-2 py-1">
                  <UBadge :color="STATUS_COLORS[row.status]" variant="subtle" size="sm">{{ STATUS_LABELS[row.status] }}</UBadge>
                </td>
                <td class="px-2 py-1 text-right">
                  <UTooltip v-if="row.localSize !== undefined" text="Copy local to remote">
                    <UButton icon="i-lucide-arrow-right" size="xs" color="neutral" variant="ghost" aria-label="Copy local to remote" @click="copy(row, 'upload')" />
                  </UTooltip>
                  <UTooltip v-if="row.remoteSize !== undefined" text="Copy remote to local">
                    <UButton icon="i-lucide-arrow-left" size="xs" color="neutral" variant="ghost" aria-label="Copy remote to local" @click="copy(row, 'download')" />
                  </UTooltip>
                </td>
              </tr>
              <tr v-if="visibleRows.length === 0">
                <td colspan="5" class="px-2 py-4 text-center text-muted">No differences</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
    <template #footer>
      <UButton color="neutral" variant="outline" @click="emit('update:open', false)">Close</UButton>
    </template>
  </UModal>
</template>

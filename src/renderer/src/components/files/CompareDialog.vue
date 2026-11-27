<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { CompareRequest, CompareRow, CompareStatus, FileListResult } from '@shared/contract'
import { invoke, IpcError } from '../../api'
import { useTransferIntents } from '../../composables/useTransferIntents'
import { useSessionsStore } from '../../stores/sessions.store'
import type { ConflictChoice } from '../../utils/resolveConflicts'
import TransferConflictDialog from './TransferConflictDialog.vue'
import FileDiffModal from './FileDiffModal.vue'
import { useNotify } from '../../composables/useNotify'
import { formatBytes } from '../../utils/format'

const props = defineProps<{
  open: boolean
  sessionId: string | null
  initialLocalPath: string
  initialRemotePath: string
}>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const sessions = useSessionsStore()
const { buildTransferIntent, checkAndQueueTransfers, transferConflict, dismissTransferConflict, resolveTransferConflict } =
  useTransferIntents()
const notify = useNotify()

const localPath = ref('')
const remotePath = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const result = shallowRef<{ request: CompareRequest; rows: CompareRow[] } | null>(null)
const rows = computed(() => result.value?.rows ?? null)
const checkingDestination = ref(false)
let generation = 0
const showSame = ref(false)
const diffOpen = ref(false)
const diffTarget = ref<{ sessionId: string; localPath: string; remotePath: string } | null>(null)

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

function invalidate(): void {
  generation++
  result.value = null
  loading.value = false
  checkingDestination.value = false
  error.value = null
  diffOpen.value = false
  diffTarget.value = null
  dismissTransferConflict()
}

watch([localPath, remotePath, () => props.sessionId, () => sessions.status], invalidate, { flush: 'sync' })
watch(
  () => props.open,
  (isOpen) => {
    invalidate()
    if (isOpen) {
      localPath.value = props.initialLocalPath
      remotePath.value = props.initialRemotePath
      void compare()
    }
  },
  { immediate: true, flush: 'sync' }
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
  invalidate()
  if (!props.sessionId || !localPath.value.trim() || !remotePath.value.trim()) return
  const version = generation
  const request = { sessionId: props.sessionId, localPath: localPath.value, remotePath: remotePath.value }
  loading.value = true
  try {
    const scanned = await invoke<CompareRow[]>(INVOKE_CHANNELS.syncCompare, request)
    if (version === generation) result.value = { request, rows: scanned }
  } catch (e) {
    if (version === generation) error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (version === generation) loading.value = false
  }
}

function resolvePairPaths(request: CompareRequest, relPath: string): {
  name: string
  localParent: string
  remoteParent: string
  localPath: string
  remotePath: string
} | null {
  const sep = request.localPath.includes('\\') ? '\\' : '/'
  const segments = relPath.split('/')
  const name = segments.pop()
  if (!name || [...segments, name].some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) {
    return null
  }
  const relativeParent = segments.join('/')
  const localParent = relativeParent ? join(request.localPath, relativeParent, sep) : request.localPath
  const remoteParent = relativeParent ? join(request.remotePath, relativeParent, '/') : request.remotePath
  return {
    name,
    localParent,
    remoteParent,
    localPath: join(localParent, name, sep),
    remotePath: join(remoteParent, name, '/')
  }
}

function openDiff(row: CompareRow): void {
  const scan = result.value
  if (!scan?.rows.includes(row)) return
  const resolved = resolvePairPaths(scan.request, row.relPath)
  if (!resolved) {
    notify.error('Could not open diff', 'The scan returned an invalid relative path.')
    return
  }
  diffTarget.value = {
    sessionId: scan.request.sessionId,
    localPath: resolved.localPath,
    remotePath: resolved.remotePath
  }
  diffOpen.value = true
}

async function copy(row: CompareRow, kind: 'upload' | 'download'): Promise<void> {
  const scan = result.value
  if (!scan?.rows.includes(row) || checkingDestination.value || transferConflict.value) return
  const { request } = scan
  const { sessionId } = request
  const resolved = resolvePairPaths(request, row.relPath)
  if (!resolved) {
    notify.error('Could not queue transfer', 'The scan returned an invalid relative path.')
    return
  }
  const { name, localParent, remoteParent, localPath: targetLocalPath, remotePath: targetRemotePath } = resolved
  const upload = kind === 'upload'
  const intent = buildTransferIntent(upload ? 'local' : 'remote', {
    name,
    path: upload ? targetLocalPath : targetRemotePath,
    isDir: false,
    size: upload ? row.localSize : row.remoteSize,
    modifiedAt: (upload ? row.localMtimeMs : row.remoteMtimeMs) === undefined
      ? null
      : new Date((upload ? row.localMtimeMs : row.remoteMtimeMs)!).toISOString()
  }, sessionId, upload ? remoteParent : localParent)
  if (!intent) return

  checkingDestination.value = true
  try {
    let entries: FileListResult['entries'] = []
    try {
      const listing = upload
        ? await invoke<FileListResult>(INVOKE_CHANNELS.fsRemoteList, sessionId, remoteParent, true)
        : await invoke<FileListResult>(INVOKE_CHANNELS.fsLocalList, localParent)
      entries = listing.entries
    } catch (e) {
      if (!(e instanceof IpcError && e.code === 'NOT_FOUND')) throw e
    }
    if (result.value !== scan || !props.open || props.sessionId !== sessionId) return
    await checkAndQueueTransfers([{ ...intent, createParents: true }], { entries })
  } catch (e) {
    if (result.value === scan) notify.error('Could not queue transfer', e instanceof Error ? e.message : String(e))
  } finally {
    if (result.value === scan) checkingDestination.value = false
  }
}

async function resolveConflict(choice: ConflictChoice): Promise<void> {
  if (!result.value || !props.open || props.sessionId !== result.value.request.sessionId) return
  try {
    await resolveTransferConflict(choice)
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
          <UCheckbox v-model="showSame" label="Show identical files" size="xs" />
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
                <th class="w-28 px-2 py-1" />
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
                  <UTooltip v-if="row.localSize !== undefined && row.remoteSize !== undefined && row.status !== 'same'" text="View diff">
                    <UButton icon="i-lucide-file-diff" size="xs" color="neutral" variant="ghost" aria-label="View diff" @click="openDiff(row)" />
                  </UTooltip>
                  <UTooltip v-if="row.localSize !== undefined" text="Copy local to remote">
                    <UButton icon="i-lucide-arrow-right" size="xs" color="neutral" variant="ghost" aria-label="Copy local to remote" :disabled="checkingDestination" @click="copy(row, 'upload')" />
                  </UTooltip>
                  <UTooltip v-if="row.remoteSize !== undefined" text="Copy remote to local">
                    <UButton icon="i-lucide-arrow-left" size="xs" color="neutral" variant="ghost" aria-label="Copy remote to local" :disabled="checkingDestination" @click="copy(row, 'download')" />
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
  <TransferConflictDialog
    :conflicts="transferConflict?.conflicts ?? []"
    @dismiss="dismissTransferConflict"
    @resolve="resolveConflict"
  />
  <FileDiffModal
    v-model:open="diffOpen"
    :session-id="diffTarget?.sessionId ?? null"
    :local-path="diffTarget?.localPath ?? null"
    :remote-path="diffTarget?.remotePath ?? null"
  />
</template>

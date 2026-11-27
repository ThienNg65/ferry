<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { MonitorDiskUsage, OperationEvent, SyncDirection, SyncOptions, SyncPlan } from '@shared/contract'
import { invoke, IpcError, onEvent } from '../../api'
import { useCompanionStore } from '../../stores/companion.store'
import { useMonitorStore } from '../../stores/monitor.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useSyncStore } from '../../stores/sync.store'
import { useNotify } from '../../composables/useNotify'
import { evaluateSyncPreFlight } from '../../utils/companionGuardrails'
import { formatBytes } from '../../utils/format'
import FileDiffModal from './FileDiffModal.vue'

const props = defineProps<{
  open: boolean
  sessionId: string | null
  initialLocalPath: string
  initialRemotePath: string
}>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const sync = useSyncStore()
const sessions = useSessionsStore()
const monitor = useMonitorStore()
const companion = useCompanionStore()
const notify = useNotify()

const localPath = ref('')
const remotePath = ref('')
const direction = ref<SyncDirection>('push')
const deleteExtras = ref(false)
const previewing = ref(false)
const error = ref<string | null>(null)
const approval = shallowRef<{ options: SyncOptions; plan: SyncPlan } | null>(null)
const previewDisk = shallowRef<MonitorDiskUsage | null>(null)
const plan = computed(() => approval.value?.plan)
const preFlight = computed(() =>
  plan.value && approval.value
    ? evaluateSyncPreFlight(plan.value, approval.value.options, previewDisk.value ?? monitor.latest?.disk)
    : null
)
const isProdPushDelete = computed(
  () =>
    companion.isProd &&
    approval.value?.options.direction === 'push' &&
    Boolean(plan.value?.toDelete.length)
)
let generation = 0

const run = ref<{ requestId: string; operationId?: string; cancelling: boolean } | null>(null)
const status = ref<string | null>(null)
const diffOpen = ref(false)
const diffTarget = ref<{ sessionId: string; localPath: string; remotePath: string } | null>(null)
let unsubscribe: (() => void) | undefined
onMounted(() => {
  unsubscribe = onEvent<OperationEvent>(EVENT_CHANNELS.operationEvent, (event) => {
    const active = run.value
    if (!active || event.requestId !== active.requestId) return
    if (event.state === 'started') {
      active.operationId = event.operationId
      if (active.cancelling) void sendCancel(event.operationId)
    } else if (event.state === 'done') {
      finishRun('Sync complete', event.summary, true)
    } else if (event.state === 'error' || event.state === 'cancelled') {
      finishRun(event.state === 'cancelled' ? 'Sync cancelled' : 'Sync stopped', event.error, false)
    }
  })
})
onBeforeUnmount(() => unsubscribe?.())

const directionOptions: { label: string; value: SyncDirection }[] = [
  { label: 'Push (local → remote)', value: 'push' },
  { label: 'Pull (remote → local)', value: 'pull' }
]

function invalidatePreview(): void {
  generation++
  approval.value = null
  previewDisk.value = null
  previewing.value = false
  diffOpen.value = false
  diffTarget.value = null
  if (!run.value) error.value = null
}

watch([localPath, remotePath, direction, deleteExtras, () => props.sessionId, () => sessions.status],
  invalidatePreview, { flush: 'sync' })

watch(
  () => props.open,
  (isOpen) => {
    invalidatePreview()
    if (isOpen && !run.value) {
      localPath.value = props.initialLocalPath
      remotePath.value = props.initialRemotePath
      direction.value = 'push'
      deleteExtras.value = false
      status.value = null
    }
  },
  { immediate: true, flush: 'sync' }
)

const canPreview = computed(
  () => Boolean(props.sessionId) && localPath.value.trim().length > 0 && remotePath.value.trim().length > 0
)

async function browseLocal(): Promise<void> {
  const version = generation
  try {
    const path = await invoke<string | null>(INVOKE_CHANNELS.dialogPickFolder)
    if (path && version === generation && !run.value) localPath.value = path
  } catch (e) {
    if (version === generation) error.value = e instanceof Error ? e.message : String(e)
  }
}

function buildOptions(): SyncOptions | null {
  if (!props.sessionId) {
    return null
  }
  return {
    sessionId: props.sessionId,
    localPath: localPath.value,
    remotePath: remotePath.value,
    direction: direction.value,
    deleteExtras: deleteExtras.value
  }
}

async function preview(): Promise<void> {
  if (!canPreview.value || run.value) return
  const options = buildOptions()
  if (!options) return
  invalidatePreview()
  status.value = null
  const version = generation
  previewing.value = true
  try {
    const reviewedPlan = await sync.preview(options)
    if (version !== generation) return
    approval.value = { options, plan: reviewedPlan }
    if (options.direction === 'push' && reviewedPlan.toTransfer.length > 0) {
      void invoke<MonitorDiskUsage | null>(INVOKE_CHANNELS.fsRemoteDiskUsage, options.sessionId, options.remotePath)
        .then((disk) => {
          if (version === generation && disk) {
            previewDisk.value = disk
          }
        })
        .catch(() => undefined)
    }
  } catch (e) {
    if (version === generation) error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (version === generation) previewing.value = false
  }
}

function finishRun(title: string, description: string | undefined, completed: boolean): void {
  run.value = null
  status.value = null
  if (completed) {
    status.value = description ? `${title}. ${description}` : title
    if (!props.open) notify.success(title, description)
  } else {
    error.value = description ? `${title}. ${description}` : title
    if (!props.open) notify.error(title, description?.split('\n', 1)[0])
  }
}

async function runSync(): Promise<void> {
  const reviewed = approval.value
  if (!props.open || !reviewed || run.value || previewing.value) return
  const requestId = crypto.randomUUID()
  run.value = { requestId, cancelling: false }
  invalidatePreview()
  error.value = null
  status.value = 'Sync running…'
  try {
    const result = await sync.run({ requestId, options: reviewed.options, approvedPlan: reviewed.plan })
    if (run.value?.requestId === requestId) {
      finishRun('Sync complete', `${result.deletedCount} destination item(s) deleted. ${result.queuedTransferIds.length} transfer(s) queued.`, true)
    }
  } catch (e) {
    if (run.value?.requestId !== requestId) return
    const message = e instanceof Error ? e.message : String(e)
    if (!(e instanceof IpcError) && run.value.operationId && /RPC timed out/.test(message)) {
      status.value = 'The response timed out. Sync may still be running. Follow its outcome in Activity or request cancellation.'
    } else {
      finishRun(e instanceof IpcError && e.code === 'CANCELLED' ? 'Sync cancelled' : 'Sync stopped',
        e instanceof IpcError ? message : `${message} The final outcome is unknown. Check Activity before retrying.`, false)
    }
  }
}

async function sendCancel(operationId: string): Promise<void> {
  try {
    await invoke<void>(INVOKE_CHANNELS.operationCancel, operationId)
  } catch (e) {
    if (run.value?.operationId === operationId) {
      run.value.cancelling = false
      status.value = 'Sync may still be running.'
      error.value = e instanceof Error ? e.message : String(e)
    }
  }
}

function cancelSync(): void {
  if (!run.value || run.value.cancelling) return
  run.value.cancelling = true
  status.value = 'Cancellation requested. Waiting for the current step to finish…'
  if (run.value.operationId) void sendCancel(run.value.operationId)
}

function deletionPath(relPath: string): string {
  const options = approval.value?.options
  if (!options) return relPath
  const target = options.direction === 'push' ? options.remotePath : options.localPath
  const separator = options.direction === 'pull' && target.includes('\\') ? '\\' : '/'
  return `${target.replace(/[/\\]+$/, '')}${separator}${relPath.split('/').join(separator)}`
}

function askCompanionAboutSync(): void {
  if (!preFlight.value || preFlight.value.warnings.length === 0) return
  const currentPlan = plan.value
  const dir = approval.value?.options.direction ?? 'push'
  const summaryParts: string[] = [
    `direction: ${dir}`,
    `toTransfer: ${currentPlan?.toTransfer.length ?? 0}`,
    `toDelete: ${currentPlan?.toDelete.length ?? 0}`
  ]
  if (preFlight.value.sensitiveFiles.length > 0) {
    summaryParts.push(`flaggedSecrets: ${preFlight.value.sensitiveFiles.slice(0, 10).join(', ')}`)
  }
  companion.openPanel('chat')
  void companion.ask(
    `Review this folder sync pre-flight check (${summaryParts.join('; ')}). Warnings: ${preFlight.value.warnings.join(' ')}`
  )
}

function diffPathsForEntry(relPath: string): { localPath: string; remotePath: string } | null {
  const options = approval.value?.options
  if (!options) return null
  const segments = relPath.split('/')
  if (segments.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) {
    return null
  }
  const localSep = options.localPath.includes('\\') ? '\\' : '/'
  const localPath = `${options.localPath.replace(/[/\\]+$/, '')}${localSep}${segments.join(localSep)}`
  const remotePath = `${options.remotePath.replace(/\/+$/, '')}/${segments.join('/')}`
  return { localPath, remotePath }
}

function openEntryDiff(relPath: string): void {
  const options = approval.value?.options
  const resolved = diffPathsForEntry(relPath)
  if (!options || !resolved) {
    notify.error('Could not open diff', 'The sync plan returned an invalid relative path.')
    return
  }
  diffTarget.value = {
    sessionId: options.sessionId,
    localPath: resolved.localPath,
    remotePath: resolved.remotePath
  }
  diffOpen.value = true
}

function close(): void {
  diffOpen.value = false
  emit('update:open', false)
}
</script>

<template>
  <UModal
    :open="open"
    title="Sync folders"
    description="Copy updates in one direction between a local and remote folder."
    :dismissible="!run"
    :close="!run"
    :ui="{ footer: 'justify-end', content: 'max-w-lg' }"
    @update:open="(v: boolean) => { if (!v) close() }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UFormField label="Local folder">
          <div class="flex gap-2">
            <UInput v-model="localPath" class="w-full flex-1" :disabled="Boolean(run)" />
            <UButton color="neutral" variant="outline" :disabled="Boolean(run)" @click="browseLocal">Browse</UButton>
          </div>
        </UFormField>
        <UFormField label="Remote folder">
          <UInput v-model="remotePath" class="w-full" :disabled="Boolean(run)" />
        </UFormField>
        <UFormField label="Direction">
          <URadioGroup v-model="direction" :items="directionOptions" :disabled="Boolean(run)" />
        </UFormField>
        <UCheckbox
          v-model="deleteExtras"
          label="Mirror top-level destination extras"
          description="Delete extra items at the destination root, including their contents. Keep extra files inside shared folders."
          :disabled="Boolean(run)"
        />

        <UButton
          color="neutral"
          variant="outline"
          :loading="previewing"
          :disabled="!canPreview || Boolean(run)"
          class="self-start"
          @click="preview"
        >
          Preview
        </UButton>

        <p v-if="status" role="status" aria-live="polite" class="text-sm">{{ status }}</p>
        <div v-if="error" role="alert" class="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-error/10 p-3 text-sm text-error">
          {{ error }}
        </div>

        <div v-if="plan" class="rounded-md border border-default p-3 text-sm">
          <div>{{ plan.toTransfer.length }} file(s) to transfer ({{ formatBytes(plan.totalBytes) }})</div>
          <ul v-if="plan.toTransfer.length" class="mt-2 max-h-40 space-y-1 overflow-y-auto rounded bg-muted p-2">
            <li v-for="entry in plan.toTransfer.slice(0, 200)" :key="entry.relPath" class="flex items-center justify-between gap-2 text-xs">
              <span class="min-w-0 truncate font-mono">{{ entry.relPath }}</span>
              <div class="flex shrink-0 items-center gap-1.5">
                <UButton
                  v-if="entry.action === 'overwrite'"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-file-diff"
                  @click="openEntryDiff(entry.relPath)"
                >
                  View Diff
                </UButton>
                <span
                  class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                  :class="entry.action === 'overwrite' ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'"
                >
                  {{ entry.action === 'overwrite' ? 'Overwrite' : 'New' }}
                </span>
              </div>
            </li>
            <li v-if="plan.toTransfer.length > 200" class="pt-1 text-xs text-muted">
              …and {{ plan.toTransfer.length - 200 }} more file(s)
            </li>
          </ul>
          <div v-if="deleteExtras" class="mt-2" :class="plan.toDelete.length > 0 ? 'text-error' : ''">
            {{ plan.toDelete.length }} item(s) will be deleted from destination-only top-level items
          </div>
          <ul v-if="plan.toDelete.length" class="mt-2 max-h-48 space-y-1 overflow-y-auto rounded bg-muted p-2">
            <li v-for="item in plan.toDelete.slice(0, 200)" :key="item" class="break-all">{{ deletionPath(item) }}</li>
            <li v-if="plan.toDelete.length > 200" class="pt-1 text-xs text-muted">
              …and {{ plan.toDelete.length - 200 }} more item(s)
            </li>
          </ul>
        </div>

        <UAlert
          v-if="isProdPushDelete"
          data-sync-prod-warning
          role="alert"
          color="error"
          variant="soft"
          icon="i-lucide-shield-alert"
          title="Production Deletion Warning"
          :description="`Connected to ${companion.prodSiteLabel}. Running this mirror sync will permanently delete ${plan?.toDelete.length ?? 0} destination item(s) on Production.`"
        />

        <div
          v-if="preFlight && preFlight.warnings.length > 0"
          data-sync-preflight-guardrail
          role="note"
          class="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-default"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 font-semibold text-warning">
              <UIcon name="i-lucide-shield-alert" class="size-4 shrink-0" />
              <span>Companion Pre-Flight Safety Check</span>
            </div>
            <UButton size="xs" color="warning" variant="soft" icon="i-lucide-sparkles" @click="askCompanionAboutSync">
              Ask Companion
            </UButton>
          </div>
          <ul class="list-disc space-y-1 pl-4 text-muted">
            <li v-for="w in preFlight.warnings" :key="w">{{ w }}</li>
          </ul>
        </div>
      </div>
    </template>

    <template #footer>
      <template v-if="run">
        <UButton color="neutral" variant="outline" @click="close">Continue in background</UButton>
        <UButton color="warning" variant="outline" :disabled="run.cancelling" @click="cancelSync">Cancel sync</UButton>
      </template>
      <template v-else>
        <UButton color="neutral" variant="outline" @click="close">Close</UButton>
        <UButton :color="plan?.toDelete.length ? 'error' : 'primary'" :disabled="!plan || previewing" @click="runSync">
          {{ plan?.toDelete.length ? 'Approve deletions and run' : 'Run sync' }}
        </UButton>
      </template>
    </template>
  </UModal>
  <FileDiffModal
    v-model:open="diffOpen"
    :session-id="diffTarget?.sessionId ?? null"
    :local-path="diffTarget?.localPath ?? null"
    :remote-path="diffTarget?.remotePath ?? null"
  />
</template>

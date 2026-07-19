<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { SyncDirection, SyncOptions, SyncPlan } from '@shared/contract'
import { invoke } from '../../api'
import { useSyncStore } from '../../stores/sync.store'
import { useNotify } from '../../composables/useNotify'
import { formatBytes } from '../../utils/format'

const props = defineProps<{
  open: boolean
  sessionId: string | null
  initialLocalPath: string
  initialRemotePath: string
}>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const sync = useSyncStore()
const notify = useNotify()

const localPath = ref('')
const remotePath = ref('')
const direction = ref<SyncDirection>('push')
const deleteExtras = ref(false)
const previewing = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const plan = ref<SyncPlan | null>(null)

const directionOptions: { label: string; value: SyncDirection }[] = [
  { label: 'Push (local → remote)', value: 'push' },
  { label: 'Pull (remote → local)', value: 'pull' }
]

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      localPath.value = props.initialLocalPath
      remotePath.value = props.initialRemotePath
      direction.value = 'push'
      deleteExtras.value = false
      plan.value = null
      error.value = null
    }
  }
)

const canPreview = computed(
  () => Boolean(props.sessionId) && localPath.value.trim().length > 0 && remotePath.value.trim().length > 0
)

async function browseLocal(): Promise<void> {
  const path = await invoke<string | null>(INVOKE_CHANNELS.dialogPickFolder)
  if (path) {
    localPath.value = path
    plan.value = null
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
  const options = buildOptions()
  if (!options) {
    return
  }
  previewing.value = true
  error.value = null
  try {
    plan.value = await sync.preview(options)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    previewing.value = false
  }
}

async function runSync(): Promise<void> {
  const options = buildOptions()
  if (!options) {
    return
  }
  running.value = true
  error.value = null
  try {
    const result = await sync.run(options)
    notify.success('Sync started', `${result.queuedTransferIds.length} file(s) queued, ${result.deletedCount} deleted`)
    close()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    running.value = false
  }
}

function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <UModal
    :open="open"
    title="Sync folders"
    description="One-way mirror between a local and remote folder."
    :ui="{ footer: 'justify-end', content: 'max-w-lg' }"
    @update:open="(v: boolean) => { if (!v) close() }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UFormField label="Local folder">
          <div class="flex gap-2">
            <UInput v-model="localPath" class="w-full flex-1" @update:model-value="plan = null" />
            <UButton color="neutral" variant="outline" @click="browseLocal">Browse</UButton>
          </div>
        </UFormField>
        <UFormField label="Remote folder">
          <UInput v-model="remotePath" class="w-full" @update:model-value="plan = null" />
        </UFormField>
        <UFormField label="Direction">
          <URadioGroup v-model="direction" :items="directionOptions" @update:model-value="plan = null" />
        </UFormField>
        <label class="flex items-center gap-2 text-sm text-default">
          <input type="checkbox" v-model="deleteExtras" class="size-4" @change="plan = null" />
          Delete destination files not present in the source (mirror)
        </label>

        <UButton
          color="neutral"
          variant="outline"
          :loading="previewing"
          :disabled="!canPreview"
          class="self-start"
          @click="preview"
        >
          Preview
        </UButton>

        <UAlert v-if="error" color="error" variant="soft" :title="error" />

        <div v-if="plan" class="rounded-md border border-default p-3 text-sm">
          <div>{{ plan.toTransfer.length }} file(s) to transfer ({{ formatBytes(plan.totalBytes) }})</div>
          <div v-if="deleteExtras" :class="plan.toDelete.length > 0 ? 'text-error' : ''">
            {{ plan.toDelete.length }} destination item(s) will be deleted
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton color="neutral" variant="outline" @click="close">Cancel</UButton>
      <UButton :loading="running" :disabled="!plan" @click="runSync">Run sync</UButton>
    </template>
  </UModal>
</template>

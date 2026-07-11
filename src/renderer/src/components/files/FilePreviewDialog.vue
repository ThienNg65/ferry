<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { FileEntry, FileReadResult } from '@shared/contract'
import { invoke } from '../../api'
import { useSessionsStore } from '../../stores/sessions.store'
import { isLogFile, isTextPreviewable } from '../../utils/fileTypes'

const props = defineProps<{
  open: boolean
  entry: FileEntry | null
  side: 'local' | 'remote'
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  tail: [entry: FileEntry]
  download: [entry: FileEntry]
}>()

const sessions = useSessionsStore()

const loading = ref(false)
const error = ref<string | null>(null)
const content = ref('')
const truncated = ref(false)

const previewable = computed(() => (props.entry ? isTextPreviewable(props.entry.name) : false))
const canDownload = computed(() => props.side === 'remote')
const showTail = computed(() => {
  const entry = props.entry
  return props.side === 'remote' && entry !== null && isLogFile(entry.name)
})

watch(
  () => [props.open, props.entry] as const,
  async ([isOpen, entry]) => {
    if (!isOpen || !entry || !isTextPreviewable(entry.name)) {
      content.value = ''
      error.value = null
      truncated.value = false
      return
    }
    loading.value = true
    error.value = null
    try {
      const result =
        props.side === 'local'
          ? await invoke<FileReadResult>(INVOKE_CHANNELS.fsLocalReadFile, entry.path)
          : await invoke<FileReadResult>(
              INVOKE_CHANNELS.fsRemoteReadFile,
              sessions.activeSessionId,
              entry.path
            )
      content.value = result.content
      truncated.value = result.truncated
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }
)

function onTail(): void {
  if (props.entry) {
    emit('tail', props.entry)
  }
}

function onDownload(): void {
  if (props.entry) {
    emit('download', props.entry)
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="entry?.name ?? ''"
    :ui="{ content: 'max-w-2xl' }"
    @update:open="emit('update:open', $event)"
  >
    <template #actions>
      <UButton
        v-if="showTail"
        icon="i-lucide-scroll-text"
        color="neutral"
        variant="ghost"
        size="xs"
        label="Tail"
        @click="onTail"
      />
    </template>

    <template #body>
      <div v-if="!previewable" class="flex flex-col items-center gap-3 py-8 text-center">
        <UIcon name="i-lucide-file-question" class="size-8 text-muted" />
        <p class="text-sm text-muted">Preview not available for this file type.</p>
        <UButton v-if="canDownload" icon="i-lucide-download" @click="onDownload">Download instead</UButton>
      </div>
      <div v-else-if="loading" class="py-8 text-center text-xs text-muted">Loading…</div>
      <UAlert v-else-if="error" color="error" variant="soft" :title="error" />
      <div v-else class="flex flex-col gap-2">
        <UAlert
          v-if="truncated"
          color="warning"
          variant="soft"
          title="File truncated"
          description="Only the first part of this file is shown — download it to see the rest."
        />
        <pre class="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{{ content }}</pre>
      </div>
    </template>

    <template #footer="{ close }">
      <UButton
        v-if="previewable && canDownload"
        color="neutral"
        variant="outline"
        icon="i-lucide-download"
        @click="onDownload"
      >
        Download
      </UButton>
      <UButton color="neutral" variant="outline" @click="close">Close</UButton>
    </template>
  </UModal>
</template>

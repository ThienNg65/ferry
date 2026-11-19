<script setup lang="ts">
import { computed, ref, watch, shallowRef } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { FileReadResult } from '@shared/contract'
import { invoke } from '../../api'
import { useConfirm } from '../../composables/useConfirm'
import { useNotify } from '../../composables/useNotify'
import { useUiStore } from '../../stores/ui.store'

const props = defineProps<{
  open: boolean
  editId: string | null
  localTempPath: string | null
  remotePath: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const confirm = useConfirm()
const notify = useNotify()
const ui = useUiStore()

const content = ref('')
const savedContent = ref('')
const loading = ref(false)
const saving = ref(false)
const fontSize = ref(14)
let loadToken = 0

const isDirty = computed(() => !loading.value && content.value !== savedContent.value)
const extensions = computed(() => (ui.theme === 'dark' ? [basicSetup, oneDark] : [basicSetup]))

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    if (e.deltaY < 0) {
      fontSize.value = Math.min(fontSize.value + 2, 48)
    } else {
      fontSize.value = Math.max(fontSize.value - 2, 8)
    }
  }
}

const view = shallowRef()
const handleReady = (payload: { view: unknown }) => {
  view.value = payload.view
}

watch(
  () => [props.open, props.localTempPath] as const,
  async ([isOpen, tempPath]) => {
    const token = ++loadToken
    if (isOpen && tempPath) {
      loading.value = true
      try {
        const res = await invoke<FileReadResult>(INVOKE_CHANNELS.fsLocalReadFile, tempPath)
        if (token !== loadToken || !props.open) return
        if (res.truncated) {
          notify.error('File too large', 'This file is too large to edit in the built-in editor. Opening externally...')
          await openExternalNow()
          return
        }
        content.value = res.content
        savedContent.value = res.content
      } catch (e) {
        if (token !== loadToken) return
        notify.error('Failed to load file', e instanceof Error ? e.message : String(e))
        emit('update:open', false)
      } finally {
        if (token === loadToken) {
          loading.value = false
        }
      }
    } else {
      loading.value = false
      content.value = ''
      savedContent.value = ''
    }
  },
  { immediate: true }
)

async function onSave(): Promise<void> {
  if (!props.localTempPath || loading.value || saving.value || !isDirty.value) return
  // Snapshot the exact bytes submitted. Edits made while the write is pending
  // must remain dirty rather than being silently marked as saved.
  const pathAtSave = props.localTempPath
  const contentAtSave = content.value
  const tokenAtSave = loadToken
  saving.value = true
  try {
    await invoke<void>(INVOKE_CHANNELS.fsLocalWriteFile, {
      path: pathAtSave,
      content: contentAtSave
    })
    if (tokenAtSave === loadToken && props.open && props.localTempPath === pathAtSave) {
      savedContent.value = contentAtSave
      notify.success('Saved', 'Changes saved and uploading...')
    }
  } catch (e) {
    notify.error('Failed to save file', e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}

async function openExternalNow(): Promise<void> {
  if (!props.editId) return
  try {
    await invoke<void>(INVOKE_CHANNELS.editOpenExternal, { editId: props.editId })
    emit('update:open', false)
  } catch (e) {
    notify.error('Failed to open external editor', e instanceof Error ? e.message : String(e))
  }
}

async function onOpenExternal(): Promise<void> {
  if (!props.editId || loading.value || saving.value) return
  if (isDirty.value) {
    const ok = await confirm({
      title: 'Discard unsaved changes?',
      body: 'Opening in an external editor will discard your unsaved changes in this window.',
      confirmLabel: 'Discard & Open',
      confirmColor: 'warning'
    })
    if (!ok) return
  }
  await openExternalNow()
}

async function onUpdateOpen(nextOpen: boolean): Promise<void> {
  // Do not discard the editor while an in-flight write can still complete.
  if (!nextOpen && saving.value) return
  if (!nextOpen && isDirty.value) {
    const ok = await confirm({
      title: 'Discard unsaved changes?',
      body: 'You have unsaved edits that have not been saved yet.',
      confirmLabel: 'Discard',
      confirmColor: 'warning'
    })
    if (!ok) return
  }
  emit('update:open', nextOpen)
}
</script>

<template>
  <UModal
    :open="open"
    :title="`Editing: ${remotePath ?? 'file'}`"
    @update:open="onUpdateOpen"
    :ui="{ content: 'sm:max-w-5xl h-[85vh] flex flex-col', body: 'p-0 sm:p-0 flex-1 overflow-hidden', header: 'py-3' }"
  >
    <template #actions>
      <UBadge v-if="isDirty" color="warning" variant="subtle" size="sm">Unsaved</UBadge>
      <UButton
        icon="i-lucide-external-link"
        size="xs"
        color="neutral"
        variant="ghost"
        title="Open in External Editor"
        aria-label="Open in External Editor"
        @click="onOpenExternal"
      />
      <UButton
        icon="i-lucide-save"
        size="xs"
        color="primary"
        :loading="saving"
        :disabled="!isDirty"
        @click="onSave"
      >
        Save
      </UButton>
    </template>
    
    <template #body>
      <div 
        class="flex h-full flex-col overflow-hidden"
        :class="ui.theme === 'dark' ? 'bg-editor-surface' : 'bg-default'"
        @keydown.ctrl.s.prevent="onSave" 
        @keydown.meta.s.prevent="onSave"
        @wheel="onWheel"
      >
        <div v-if="loading" role="status" aria-label="Loading file editor" class="flex h-full flex-col gap-2.5 p-4">
          <USkeleton v-for="i in 8" :key="i" class="h-3.5" :style="{ width: `${45 + ((i * 23) % 45)}%` }" />
        </div>
        <Codemirror
          v-else
          v-model="content"
          :extensions="extensions"
          :autofocus="true"
          :indent-with-tab="true"
          :tab-size="2"
          class="ferry-editor h-full w-full text-sm"
          :style="{ fontSize: `${fontSize}px`, height: '100%' }"
          @ready="handleReady"
        />
      </div>
    </template>
  </UModal>
</template>

<style>
.ferry-editor .cm-editor {
  height: 100% !important;
}
.ferry-editor .cm-scroller {
  overflow: auto !important;
}
</style>

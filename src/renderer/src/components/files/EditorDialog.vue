<script setup lang="ts">
import { ref, watch, shallowRef } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { FileReadResult } from '@shared/contract'
import { invoke } from '../../api'
import { useNotify } from '../../composables/useNotify'

const props = defineProps<{
  open: boolean
  editId: string | null
  localTempPath: string | null
  remotePath: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const notify = useNotify()

const content = ref('')
const loading = ref(false)
const saving = ref(false)
const fontSize = ref(14)

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

const extensions = [basicSetup, oneDark]
const view = shallowRef()
const handleReady = (payload: any) => {
  view.value = payload.view
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen && props.localTempPath) {
      loading.value = true
      try {
        const res = await invoke<FileReadResult>(INVOKE_CHANNELS.fsLocalReadFile, props.localTempPath)
        if (res.truncated) {
          notify.error('File too large', 'This file is too large to edit in the built-in editor. Opening externally...')
          await onOpenExternal()
          return
        }
        content.value = res.content
      } catch (e) {
        notify.error('Failed to load file', e instanceof Error ? e.message : String(e))
        emit('update:open', false)
      } finally {
        loading.value = false
      }
    } else {
      content.value = ''
    }
  }
)

async function onSave(): Promise<void> {
  if (!props.localTempPath) return
  saving.value = true
  try {
    await invoke<void>(INVOKE_CHANNELS.fsLocalWriteFile, {
      path: props.localTempPath,
      content: content.value
    })
    notify.success('Saved', 'Changes saved and uploading...')
  } catch (e) {
    notify.error('Failed to save file', e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}

async function onOpenExternal(): Promise<void> {
  if (!props.editId) return
  try {
    await invoke<void>(INVOKE_CHANNELS.editOpenExternal, { editId: props.editId })
    emit('update:open', false)
  } catch (e) {
    notify.error('Failed to open external editor', e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="`Editing: ${remotePath ?? 'file'}`"
    @update:open="(v: boolean) => emit('update:open', v)"
    :ui="{ content: 'sm:max-w-5xl h-[85vh] flex flex-col', body: 'p-0 sm:p-0 flex-1 overflow-hidden', header: 'py-3' }"
  >
    <template #actions>
      <UButton
        icon="i-lucide-external-link"
        size="xs"
        color="neutral"
        variant="ghost"
        title="Open in External Editor"
        @click="onOpenExternal"
      />
      <UButton
        icon="i-lucide-save"
        size="xs"
        color="primary"
        :loading="saving"
        @click="onSave"
      >
        Save
      </UButton>
    </template>
    
    <template #body>
      <div 
        class="flex h-full flex-col overflow-hidden bg-[#282c34]" 
        @keydown.ctrl.s.prevent="onSave" 
        @keydown.meta.s.prevent="onSave"
        @wheel="onWheel"
      >
        <div v-if="loading" class="flex h-full items-center justify-center">
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-dimmed" />
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

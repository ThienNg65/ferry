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
import { useEditSessionsStore } from '../../stores/editSessions.store'
import { useLocalFsStore } from '../../stores/localFs.store'
import { useUiStore } from '../../stores/ui.store'
import FileDiffModal from './FileDiffModal.vue'

function parentLocalDir(localPath: string): string {
  const trimmed = localPath.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (idx < 0) return ''
  if (idx === 0) return '/'
  if (idx === 2 && /^[A-Za-z]:/.test(trimmed)) return trimmed.slice(0, 3)
  return trimmed.slice(0, idx)
}

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
const editSessions = useEditSessionsStore()
const localFs = useLocalFsStore()
const ui = useUiStore()

const content = ref('')
const savedContent = ref('')
const loading = ref(false)
const saving = ref(false)
const resolvingConflict = ref(false)
const diffOpen = ref(false)
const fontSize = ref(14)
let loadToken = 0

const isLocal = computed(() => !props.editId)
const isDirty = computed(() => !loading.value && content.value !== savedContent.value)
const activeEdit = computed(() => (props.editId ? editSessions.edits.find((e) => e.editId === props.editId) ?? null : null))
const hasConflict = computed(() => Boolean(activeEdit.value?.conflict))
const canDiff = computed(() => Boolean(activeEdit.value?.sessionId && props.remotePath && props.localTempPath))
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
  () => [props.open, props.localTempPath, props.editId] as const,
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
        notify.error('Could not load file', e instanceof Error ? e.message : String(e))
        emit('update:open', false)
      } finally {
        if (token === loadToken) {
          loading.value = false
        }
      }
    } else {
      loading.value = false
      diffOpen.value = false
      content.value = ''
      savedContent.value = ''
    }
  },
  { immediate: true }
)

async function onSave(): Promise<void> {
  if (!props.localTempPath || loading.value || saving.value || !isDirty.value) return
  const token = loadToken
  const path = props.localTempPath
  const submittedContent = content.value
  const wasLocal = isLocal.value
  saving.value = true
  try {
    await invoke<void>(INVOKE_CHANNELS.fsLocalWriteFile, { path, content: submittedContent })
    if (token === loadToken) {
      savedContent.value = submittedContent
      notify.success('Saved', wasLocal ? 'Changes saved to disk.' : 'Changes saved and uploading...')
    }
    if (wasLocal) {
      const targetDir = parentLocalDir(path)
      if (targetDir) {
        void localFs.refreshIfViewing(targetDir)
      }
    }
  } catch (e) {
    notify.error('Could not save file', e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}

async function openExternalNow(): Promise<void> {
  const token = loadToken
  const previousContent = content.value
  try {
    if (isLocal.value) {
      if (!props.localTempPath) return
      await invoke<void>(INVOKE_CHANNELS.editOpenLocal, props.localTempPath)
      notify.success('Opened in external editor', props.localTempPath)
    } else {
      const editId = props.editId
      if (!editId) return
      await invoke<void>(INVOKE_CHANNELS.editOpenExternal, { editId })
    }
    if (token === loadToken && props.open && content.value === previousContent && !saving.value) {
      emit('update:open', false)
    }
  } catch (e) {
    if (token === loadToken) {
      notify.error('Could not open external editor', e instanceof Error ? e.message : String(e))
    }
  }
}

async function confirmDiscard(external: boolean): Promise<boolean> {
  if (!isDirty.value) return true
  const token = loadToken
  const previousContent = content.value
  const approved = await confirm({
    title: 'Discard unsaved changes?',
    body: external
      ? 'Opening in an external editor will discard your unsaved changes in this window.'
      : 'You have unsaved changes.',
    confirmLabel: external ? 'Discard & Open' : 'Discard',
    confirmColor: 'warning'
  })
  return approved && token === loadToken && props.open && content.value === previousContent && !saving.value
}

async function onOpenExternal(): Promise<void> {
  if ((!props.editId && !props.localTempPath) || loading.value || saving.value) return
  if (isDirty.value && !(await confirmDiscard(true))) return
  await openExternalNow()
}

async function onUpdateOpen(nextOpen: boolean): Promise<void> {
  if (!nextOpen) {
    if (saving.value || resolvingConflict.value) return
    if (isDirty.value && !(await confirmDiscard(false))) return
    diffOpen.value = false
  }
  emit('update:open', nextOpen)
}

async function onOverwriteServer(): Promise<void> {
  const editId = props.editId
  if (!editId || loading.value || saving.value || resolvingConflict.value) return
  resolvingConflict.value = true
  try {
    if (isDirty.value && props.localTempPath) {
      const submittedContent = content.value
      await invoke<void>(INVOKE_CHANNELS.fsLocalWriteFile, { path: props.localTempPath, content: submittedContent })
      savedContent.value = submittedContent
    }
    await invoke<void>(INVOKE_CHANNELS.editForceReupload, editId)
    diffOpen.value = false
  } catch (e) {
    notify.error('Overwrite failed', e instanceof Error ? e.message : String(e))
  } finally {
    resolvingConflict.value = false
  }
}

async function onDiscardConflict(): Promise<void> {
  const editId = props.editId
  if (!editId || resolvingConflict.value) return
  resolvingConflict.value = true
  try {
    await editSessions.close(editId)
    diffOpen.value = false
    emit('update:open', false)
  } catch (e) {
    notify.error('Could not discard edit', e instanceof Error ? e.message : String(e))
  } finally {
    resolvingConflict.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="`Editing: ${remotePath ?? localTempPath ?? 'file'}`"
    @update:open="onUpdateOpen"
    :ui="{ content: 'sm:max-w-5xl h-[85vh] flex flex-col', body: 'p-0 sm:p-0 flex-1 overflow-hidden', header: 'py-3' }"
  >
    <template #actions>
      <UBadge v-if="isDirty" color="warning" variant="subtle" size="sm">Unsaved</UBadge>
      <UButton
        v-if="canDiff"
        icon="i-lucide-file-diff"
        size="xs"
        :color="hasConflict ? 'warning' : 'neutral'"
        :variant="hasConflict ? 'soft' : 'ghost'"
        title="View diff against server"
        aria-label="View diff against server"
        @click="diffOpen = true"
      />
      <UButton
        icon="i-lucide-external-link"
        size="xs"
        color="neutral"
        variant="ghost"
        title="Open in external editor"
        aria-label="Open in external editor"
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
        :class="ui.theme === 'dark' ? 'bg-editor-surface' : 'bg-white'"
        @keydown.ctrl.s.prevent="onSave" 
        @keydown.meta.s.prevent="onSave"
        @wheel="onWheel"
      >
        <div v-if="hasConflict" role="alert" class="flex flex-wrap items-center justify-between gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs">
          <span class="font-medium text-warning">This file changed on the server since you opened it.</span>
          <div class="flex items-center gap-1.5">
            <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-file-diff" @click="diffOpen = true">
              View Diff
            </UButton>
            <UButton size="xs" color="warning" :loading="resolvingConflict" @click="onOverwriteServer">
              Overwrite server
            </UButton>
            <UButton size="xs" color="neutral" variant="ghost" :disabled="resolvingConflict" @click="onDiscardConflict">
              Discard
            </UButton>
          </div>
        </div>
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
  <FileDiffModal
    v-if="activeEdit"
    v-model:open="diffOpen"
    :session-id="activeEdit.sessionId"
    :local-path="localTempPath"
    :remote-path="remotePath"
    :local-content="content"
    :via-sudo="Boolean(activeEdit.viaSudo)"
    local-label="Your edits"
    remote-label="Server version"
  />
</template>

<style>
.ferry-editor .cm-editor {
  height: 100% !important;
}
.ferry-editor .cm-scroller {
  overflow: auto !important;
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { DownloadsPathResult, FileEntry, UnzipResult } from '@shared/contract'
import { invoke } from '../../api'
import { useLocalFsStore } from '../../stores/localFs.store'
import { useRemoteFsStore } from '../../stores/remoteFs.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useTransferQueueStore } from '../../stores/transferQueue.store'
import { useTailStreamsStore } from '../../stores/tailStreams.store'
import { useUiStore } from '../../stores/ui.store'
import { useDragAndDrop } from '../../composables/useDragAndDrop'
import { useNotify } from '../../composables/useNotify'
import FileToolbar from './FileToolbar.vue'
import PathBreadcrumb from './PathBreadcrumb.vue'
import FileList from './FileList.vue'
import FilePreviewDialog from './FilePreviewDialog.vue'

const props = defineProps<{ side: 'local' | 'remote' }>()

const localFs = useLocalFsStore()
const remoteFs = useRemoteFsStore()
const sessions = useSessionsStore()
const transfers = useTransferQueueStore()
const tailStreams = useTailStreamsStore()
const ui = useUiStore()
const { getDragPayload, clearDrag } = useDragAndDrop()
const notify = useNotify()

const store = props.side === 'local' ? localFs : remoteFs

const showNewFolder = ref(false)
const newFolderName = ref('')
const isDropTarget = ref(false)
const previewOpen = ref(false)
const previewEntry = ref<FileEntry | null>(null)

/** Slim always-visible rail when Local is hidden — never fully unmounts (see ui.store.ts). */
const collapsedRail = computed(() => props.side === 'local' && !ui.showLocalPane)
const showBody = computed(() => props.side !== 'local' || ui.showLocalPane)

if (props.side === 'local') {
  onMounted(() => {
    void store.load()
  })
} else {
  // One remote FilePane instance is shared by every open site tab — load lazily
  // per-session the first time a tab's session becomes active (remoteFs.store.ts
  // caches each session's listing, so switching back to an already-loaded tab
  // is instant and re-fetches nothing).
  watch(
    () => sessions.activeSessionId,
    (id) => {
      if (id && remoteFs.needsLoad(id)) {
        void remoteFs.load()
      }
    },
    { immediate: true }
  )
}

// Collapsing the rail no longer unmounts this pane, so restore the safety
// property the old v-if gave for free: close any stranded preview dialog.
watch(
  () => ui.showLocalPane,
  (visible) => {
    if (!visible && props.side === 'local') {
      previewOpen.value = false
    }
  }
)

const transferIcon = computed(() => {
  if (sessions.status !== 'connected') {
    return undefined
  }
  return props.side === 'local' ? 'i-lucide-upload' : 'i-lucide-download'
})

const showTail = computed(() => props.side === 'remote' && sessions.status === 'connected')

function onOpen(entry: FileEntry): void {
  if (entry.isDir) {
    void store.openDir(entry.path)
    return
  }
  previewEntry.value = entry
  previewOpen.value = true
}

function onMkdirClick(): void {
  newFolderName.value = ''
  showNewFolder.value = true
}

async function submitMkdir(): Promise<void> {
  const name = newFolderName.value.trim()
  showNewFolder.value = false
  if (name) {
    await store.mkdir(name)
  }
}

/** Uploads or downloads `entry`, which belongs to `sourceSide`, into the other pane's current directory. */
async function transferEntry(sourceSide: 'local' | 'remote', entry: FileEntry): Promise<void> {
  const sessionId = sessions.activeSessionId
  if (!sessionId) {
    return
  }
  if (sourceSide === 'local') {
    const remoteTarget = `${remoteFs.currentPath.replace(/\/$/, '')}/${entry.name}`
    await transfers.enqueue(sessionId, 'upload', entry.path, remoteTarget)
  } else {
    const { path: downloadsDir } = await invoke<DownloadsPathResult>(INVOKE_CHANNELS.systemGetDownloadsPath)
    const sep = downloadsDir.includes('\\') ? '\\' : '/'
    const localTarget = `${downloadsDir}${sep}${entry.name}`
    await transfers.enqueue(sessionId, 'download', localTarget, entry.path)
  }
}

async function onTransfer(entry: FileEntry): Promise<void> {
  await transferEntry(props.side, entry)
}

async function onTail(entry: FileEntry): Promise<void> {
  const sessionId = sessions.activeSessionId
  if (!sessionId) {
    return
  }
  await tailStreams.open(sessionId, entry.path)
}

async function onExtract(entry: FileEntry): Promise<void> {
  const sessionId = sessions.activeSessionId
  if (!sessionId) {
    return
  }
  try {
    await invoke<UnzipResult>(INVOKE_CHANNELS.unzipRun, {
      sessionId,
      archivePath: entry.path,
      targetDir: remoteFs.currentPath
    })
    await remoteFs.load()
    notify.success('Extracted', entry.name)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    remoteFs.setError(message)
    notify.error('Extract failed', message)
  }
}

function onDragOver(event: DragEvent): void {
  const payload = getDragPayload()
  if (payload && payload.side !== props.side && sessions.status === 'connected') {
    event.preventDefault()
    isDropTarget.value = true
  }
}

function onDragLeave(): void {
  isDropTarget.value = false
}

async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  isDropTarget.value = false
  const payload = getDragPayload()
  clearDrag()
  if (!payload || payload.side === props.side) {
    return
  }
  await transferEntry(payload.side, payload.entry)
}

async function onKeydown(event: KeyboardEvent): Promise<void> {
  if (event.key !== 'Delete' && event.key !== 'Backspace') {
    return
  }
  if (store.selected.size === 0) {
    return
  }
  event.preventDefault()
  const targets = store.entries.filter((e) => store.selected.has(e.path))
  for (const entry of targets) {
    await store.remove(entry)
  }
}
</script>

<template>
  <div
    class="flex h-full flex-col border-r border-muted outline-none last:border-r-0"
    :class="[collapsedRail ? 'w-10 shrink-0' : 'min-w-0 flex-1', isDropTarget ? 'ring-2 ring-primary ring-inset' : '']"
    tabindex="0"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @keydown="onKeydown"
  >
    <div class="flex h-8 shrink-0 items-center justify-between border-b border-muted px-3">
      <span v-if="showBody" class="text-xs font-medium uppercase tracking-wide text-muted">{{ side }}</span>
      <UButton
        v-if="side === 'local'"
        size="xs"
        variant="ghost"
        color="neutral"
        :icon="ui.showLocalPane ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'"
        :aria-label="ui.showLocalPane ? 'Hide Local pane' : 'Show Local pane'"
        @click="ui.toggleLocalPane()"
      />
    </div>
    <template v-if="showBody">
      <PathBreadcrumb :path="store.currentPath" @navigate="store.openDir" />
      <FileToolbar @up="store.goUp" @refresh="store.load()" @mkdir="onMkdirClick" />
      <div v-if="showNewFolder" class="flex items-center gap-2 border-b border-muted px-3 py-1.5">
        <UInput
          v-model="newFolderName"
          size="xs"
          placeholder="New folder name"
          class="flex-1"
          autofocus
          @keyup.enter="submitMkdir"
          @keyup.esc="showNewFolder = false"
        />
        <UButton size="xs" @click="submitMkdir">Create</UButton>
      </div>
      <UAlert v-if="store.error" color="error" variant="soft" :title="store.error" class="mx-3 my-1" />
      <FileList
        :entries="store.entries"
        :selected="store.selected"
        :side="side"
        :transfer-icon="transferIcon"
        :show-tail="showTail"
        :allow-extract="showTail"
        @select="store.toggleSelect"
        @open="onOpen"
        @remove="(entry: FileEntry) => store.remove(entry)"
        @transfer="onTransfer"
        @tail="onTail"
        @extract="onExtract"
      />
      <FilePreviewDialog
        v-model:open="previewOpen"
        :entry="previewEntry"
        :side="side"
        @tail="onTail"
        @download="onTransfer"
      />
    </template>
  </div>
</template>

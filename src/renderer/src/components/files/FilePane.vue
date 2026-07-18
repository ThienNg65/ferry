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
import { archiveBaseName } from '../../utils/fileTypes'
import FileToolbar from './FileToolbar.vue'
import PathBreadcrumb from './PathBreadcrumb.vue'
import FileList from './FileList.vue'
import FilePreviewDialog from './FilePreviewDialog.vue'
import ChmodDialog from './ChmodDialog.vue'

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
const extractConflict = ref<{ entry: FileEntry; baseName: string; suggestedName: string } | null>(null)
const renamingPath = ref<string | null>(null)
const chmodOpen = ref(false)
const chmodTarget = ref<FileEntry | null>(null)

/** Navigating away mid-rename would otherwise leave a stale edit box pointing at a path that's no longer listed. */
watch(
  () => store.currentPath,
  () => {
    renamingPath.value = null
  }
)

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

/** Plain click selects only this row; Ctrl/Cmd toggles it; Shift extends from the last-clicked row. */
function onSelect(path: string, event: MouseEvent): void {
  if (event.shiftKey) {
    store.selectRange(path)
  } else if (event.ctrlKey || event.metaKey) {
    store.toggleSelect(path)
  } else {
    store.selectOnly(path)
  }
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
    await transfers.enqueue(sessionId, 'upload', entry.path, remoteTarget, entry.isDir)
  } else {
    const { path: downloadsDir } = await invoke<DownloadsPathResult>(INVOKE_CHANNELS.systemGetDownloadsPath)
    const sep = downloadsDir.includes('\\') ? '\\' : '/'
    const localTarget = `${downloadsDir}${sep}${entry.name}`
    await transfers.enqueue(sessionId, 'download', localTarget, entry.path, entry.isDir)
  }
}

async function onTransfer(entry: FileEntry): Promise<void> {
  await transferEntry(props.side, entry)
}

/** Toolbar "Upload/Download N selected" — enqueues every selected row (files and folders alike). */
async function onTransferSelected(): Promise<void> {
  const targets = store.entries.filter((e) => store.selected.has(e.path))
  for (const entry of targets) {
    await transferEntry(props.side, entry)
  }
}

async function onTail(entry: FileEntry): Promise<void> {
  const sessionId = sessions.activeSessionId
  if (!sessionId) {
    return
  }
  await tailStreams.open(sessionId, entry.path)
}

/** First name not already present in the current remote listing — `report`, `report (1)`, `report (2)`, ... */
function firstAvailableName(base: string): string {
  const existing = new Set(remoteFs.entries.map((e) => e.name))
  if (!existing.has(base)) {
    return base
  }
  let i = 1
  while (existing.has(`${base} (${i})`)) {
    i += 1
  }
  return `${base} (${i})`
}

/** First archive name not already present in `store`'s current listing — `report.zip`, `report (1).zip`, ... */
function firstAvailableZipName(baseZipName: string): string {
  const existing = new Set(store.entries.map((e) => e.name))
  if (!existing.has(baseZipName)) {
    return baseZipName
  }
  const dot = baseZipName.lastIndexOf('.')
  const stem = dot > 0 ? baseZipName.slice(0, dot) : baseZipName
  const ext = dot > 0 ? baseZipName.slice(dot) : ''
  let i = 1
  while (existing.has(`${stem} (${i})${ext}`)) {
    i += 1
  }
  return `${stem} (${i})${ext}`
}

/** Zips `entry` in place (same directory), local or remote depending on this pane's side — no download/upload round-trip. */
async function onCompress(entry: FileEntry): Promise<void> {
  const zipName = firstAvailableZipName(`${entry.name}.zip`)
  try {
    if (props.side === 'local') {
      const sep = store.currentPath.includes('\\') ? '\\' : '/'
      await invoke<void>(INVOKE_CHANNELS.archiveCompressLocal, {
        sourcePath: entry.path,
        destPath: `${store.currentPath}${sep}${zipName}`
      })
    } else {
      const sessionId = sessions.activeSessionId
      if (!sessionId) {
        return
      }
      await invoke<UnzipResult>(INVOKE_CHANNELS.archiveCompressRemote, {
        sessionId,
        sourcePath: entry.path,
        destPath: `${remoteFs.currentPath.replace(/\/$/, '')}/${zipName}`
      })
    }
    await store.load()
    notify.success('Compressed', `${entry.name} → ${zipName}`)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    notify.error('Compress failed', message)
  }
}

async function performExtract(entry: FileEntry, folderName: string): Promise<void> {
  const sessionId = sessions.activeSessionId
  if (!sessionId) {
    return
  }
  try {
    await invoke<UnzipResult>(INVOKE_CHANNELS.unzipRun, {
      sessionId,
      archivePath: entry.path,
      targetDir: `${remoteFs.currentPath.replace(/\/$/, '')}/${folderName}`
    })
    await remoteFs.load()
    notify.success('Extracted', `${entry.name} → ${folderName}`)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    remoteFs.setError(message)
    notify.error('Extract failed', message)
  }
}

/** Extracts into a folder named after the archive (not the current directory) — prompts if that folder already exists. */
async function onExtract(entry: FileEntry): Promise<void> {
  const baseName = archiveBaseName(entry.name)
  const exists = remoteFs.entries.some((e) => e.isDir && e.name === baseName)
  if (!exists) {
    await performExtract(entry, baseName)
    return
  }
  extractConflict.value = { entry, baseName, suggestedName: firstAvailableName(baseName) }
}

async function resolveExtractConflict(choice: 'overwrite' | 'newFolder'): Promise<void> {
  const conflict = extractConflict.value
  if (!conflict) {
    return
  }
  extractConflict.value = null
  await performExtract(conflict.entry, choice === 'overwrite' ? conflict.baseName : conflict.suggestedName)
}

/** True for a native OS drag (from Explorer/Finder, or from a local row's native drag — see FileRow.vue) — never for our in-app pane-to-pane drag, which only ever carries `text/plain`. */
function isOsFileDrag(event: DragEvent): boolean {
  return Boolean(event.dataTransfer?.types.includes('Files'))
}

function onDragOver(event: DragEvent): void {
  if (isOsFileDrag(event)) {
    if (props.side === 'remote' && sessions.status === 'connected') {
      event.preventDefault()
      isDropTarget.value = true
    }
    return
  }
  const payload = getDragPayload()
  if (payload && payload.side !== props.side && sessions.status === 'connected') {
    event.preventDefault()
    isDropTarget.value = true
  }
}

function onDragLeave(): void {
  isDropTarget.value = false
}

/** Uploads every file/folder dropped from the OS straight into the remote pane's current directory. */
async function onOsDrop(event: DragEvent): Promise<void> {
  const sessionId = sessions.activeSessionId
  if (!sessionId || !event.dataTransfer) {
    return
  }
  for (const item of event.dataTransfer.items) {
    if (item.kind !== 'file') {
      continue
    }
    const file = item.getAsFile()
    // Electron 32+ removed the `File.path` DOM extension — the absolute path is
    // resolved through the preload's webUtils bridge instead.
    const localPath = file ? window.api.getPathForFile(file) : ''
    if (!file || !localPath) {
      continue
    }
    const isDir = item.webkitGetAsEntry()?.isDirectory ?? false
    const remoteTarget = `${remoteFs.currentPath.replace(/\/$/, '')}/${file.name}`
    await transfers.enqueue(sessionId, 'upload', localPath, remoteTarget, isDir)
  }
}

async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  isDropTarget.value = false
  if (isOsFileDrag(event)) {
    await onOsDrop(event)
    return
  }
  const payload = getDragPayload()
  clearDrag()
  if (!payload || payload.side === props.side) {
    return
  }
  await transferEntry(payload.side, payload.entry)
}

async function onKeydown(event: KeyboardEvent): Promise<void> {
  // While a row is mid-rename, its own input owns keyboard input (it stops keydown propagation) —
  // this guard is a second line of defense so a stray bubble never triggers delete/refresh.
  if (renamingPath.value !== null) {
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
    event.preventDefault()
    await store.load()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    store.selectAll()
    return
  }
  if (event.key === 'F2') {
    event.preventDefault()
    if (store.selected.size === 1) {
      const [path] = store.selected
      renamingPath.value = path
    }
    return
  }
  if (event.key !== 'Delete' && event.key !== 'Backspace') {
    return
  }
  if (store.selected.size === 0) {
    return
  }
  event.preventDefault()
  const targets = store.entries.filter((e) => store.selected.has(e.path))
  try {
    await store.removeMany(targets)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    notify.error('Delete failed', message)
  }
}

async function onRename(entry: FileEntry, newName: string): Promise<void> {
  renamingPath.value = null
  try {
    await store.rename(entry, newName)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    notify.error('Rename failed', message)
  }
}

function onCancelRename(): void {
  renamingPath.value = null
}

/** Triggered from a row's context menu — renames that row regardless of the current selection. */
function onStartRename(entry: FileEntry): void {
  store.selectOnly(entry.path)
  renamingPath.value = entry.path
}

function onOpenChmod(entry: FileEntry): void {
  chmodTarget.value = entry
  chmodOpen.value = true
}

async function onSubmitChmod(entry: FileEntry, mode: string): Promise<void> {
  try {
    await remoteFs.chmod(entry, mode)
  } catch (e) {
    notify.error('Could not change permissions', e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <div
    class="flex h-full flex-col overflow-hidden border-r border-muted outline-none transition-[width] duration-200 ease-in-out last:border-r-0"
    :class="[
      collapsedRail ? 'w-10 shrink-0' : side === 'local' ? 'min-w-0 w-1/2' : 'min-w-0 flex-1',
      isDropTarget ? 'bg-primary/5 ring-2 ring-primary ring-inset' : ''
    ]"
    tabindex="0"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @keydown="onKeydown"
  >
    <div class="flex h-8 shrink-0 items-center justify-between border-b border-muted bg-muted px-3">
      <div v-if="showBody" class="flex items-center gap-1.5">
        <UIcon :name="side === 'local' ? 'i-lucide-monitor' : 'i-lucide-server'" class="size-3.5 text-highlighted" />
        <span class="text-xs font-semibold uppercase tracking-wide text-highlighted">{{ side }}</span>
      </div>
    </div>
    <template v-if="showBody">
      <PathBreadcrumb :path="store.currentPath" @navigate="store.openDir" />
      <FileToolbar
        :side="side"
        :loading="store.loading"
        :selected-count="store.selected.size"
        :transfer-icon="transferIcon"
        @up="store.goUp"
        @refresh="store.load()"
        @mkdir="onMkdirClick"
        @toggle-permissions="ui.togglePermissionsDisplay()"
        @transfer-selected="onTransferSelected"
      />
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
        :renaming-path="renamingPath"
        :sort-column="store.sortColumn"
        :sort-direction="store.sortDirection"
        @select="onSelect"
        @open="onOpen"
        @remove="(entry: FileEntry) => store.remove(entry)"
        @transfer="onTransfer"
        @tail="onTail"
        @rename="onRename"
        @cancel-rename="onCancelRename"
        @start-rename="onStartRename"
        @sort="store.setSort"
        @extract="onExtract"
        @compress="onCompress"
        @chmod="onOpenChmod"
      />
      <FilePreviewDialog
        v-model:open="previewOpen"
        :entry="previewEntry"
        :side="side"
        @tail="onTail"
        @download="onTransfer"
      />
      <ChmodDialog v-model:open="chmodOpen" :entry="chmodTarget" @submit="onSubmitChmod" />
      <UModal
        :open="Boolean(extractConflict)"
        title="Folder already exists"
        :ui="{ footer: 'justify-end' }"
        @update:open="(v: boolean) => { if (!v) extractConflict = null }"
      >
        <template #body>
          <p class="text-sm text-default">
            A folder named <span class="font-medium">{{ extractConflict?.baseName }}</span> already exists here.
            Extract into it anyway, or use
            <span class="font-medium">{{ extractConflict?.suggestedName }}</span> instead?
          </p>
        </template>
        <template #footer>
          <UButton color="neutral" variant="outline" @click="extractConflict = null">Cancel</UButton>
          <UButton color="neutral" variant="soft" @click="resolveExtractConflict('newFolder')">
            Use "{{ extractConflict?.suggestedName }}"
          </UButton>
          <UButton color="primary" @click="resolveExtractConflict('overwrite')">Extract Here</UButton>
        </template>
      </UModal>
    </template>
  </div>
</template>

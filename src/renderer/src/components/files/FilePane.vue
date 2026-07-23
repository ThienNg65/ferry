<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { DownloadsPathResult, FileEntry, UnzipResult } from '@shared/contract'
import { invoke } from '../../api'
import { useLocalFsStore } from '../../stores/localFs.store'
import { useRemoteFsStore } from '../../stores/remoteFs.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useBookmarksStore } from '../../stores/bookmarks.store'
import { useTransferQueueStore } from '../../stores/transferQueue.store'
import { useTailStreamsStore } from '../../stores/tailStreams.store'
import { useUiStore } from '../../stores/ui.store'
import { useDragAndDrop } from '../../composables/useDragAndDrop'
import { useNotify } from '../../composables/useNotify'
import { useDockState } from '../../composables/useDockState'
import { archiveBaseName } from '../../utils/fileTypes'
import FileToolbar from './FileToolbar.vue'
import PathBreadcrumb from './PathBreadcrumb.vue'
import FileList from './FileList.vue'
import FilePreviewDialog from './FilePreviewDialog.vue'
import ChmodDialog from './ChmodDialog.vue'
import SyncDialog from './SyncDialog.vue'

interface TransferIntent {
  sessionId: string
  direction: 'upload' | 'download'
  localPath: string
  remotePath: string
  isDir: boolean
  targetName: string
}

const props = defineProps<{ side: 'local' | 'remote' }>()

const localFs = useLocalFsStore()
const remoteFs = useRemoteFsStore()
const sessions = useSessionsStore()
const bookmarks = useBookmarksStore()
const transfers = useTransferQueueStore()
const tailStreams = useTailStreamsStore()
const ui = useUiStore()
const { getDragPayload, clearDrag } = useDragAndDrop()
const notify = useNotify()

const store = props.side === 'local' ? localFs : remoteFs

const showNewFolder = ref(false)
const newFolderName = ref('')
const isDropTarget = ref(false)
const filterText = ref('')
const filteredEntries = computed(() => {
  const needle = filterText.value.trim().toLowerCase()
  if (!needle) {
    return store.entries
  }
  return store.entries.filter((e) => e.name.toLowerCase().includes(needle))
})
const previewOpen = ref(false)
const previewEntry = ref<FileEntry | null>(null)
const extractConflict = ref<{ entry: FileEntry; baseName: string; suggestedName: string } | null>(null)
const renamingPath = ref<string | null>(null)
const transferConflict = ref<{ intents: TransferIntent[]; conflicts: string[] } | null>(null)
const chmodOpen = ref(false)
const chmodTarget = ref<FileEntry | null>(null)
const pendingDelete = ref<FileEntry[] | null>(null)
const deleting = ref(false)

/** Navigating away mid-rename would otherwise leave a stale edit box pointing at a path that's no longer listed. */
watch(
  () => store.currentPath,
  () => {
    renamingPath.value = null
    filterText.value = ''
  }
)

/** Filtering out the row currently being renamed unmounts its input without firing blur/escape —
 * clear renamingPath so it doesn't get stuck (which would also block every pane shortcut, see onKeydown). */
watch(filteredEntries, (entries) => {
  if (renamingPath.value !== null && !entries.some((e) => e.path === renamingPath.value)) {
    renamingPath.value = null
  }
})

/** Slim always-visible rail when Local is hidden — never fully unmounts (see ui.store.ts). */
const collapsedRail = computed(() => props.side === 'local' && !ui.showLocalPane)
const showBody = computed(() => props.side !== 'local' || ui.showLocalPane)

void bookmarks.ensureLoaded()

/** The current pane's saved-site id — null for local, and for a remote quick-connect tab with no site to attach a bookmark to. */
const currentSiteId = computed(() => (props.side === 'remote' ? sessions.activeTab.siteId : null))
const canBookmark = computed(() => props.side === 'local' || currentSiteId.value !== null)
const currentBookmarks = computed(() => {
  if (props.side === 'local') {
    return bookmarks.localBookmarks
  }
  return currentSiteId.value ? bookmarks.forSite(currentSiteId.value) : []
})

/** Last path segment, for a bookmark's default label — falls back to the whole path for a root/drive path with no separator. */
function basename(fullPath: string): string {
  const trimmed = fullPath.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 && idx < trimmed.length - 1 ? trimmed.slice(idx + 1) : fullPath
}

async function onBookmarkFolder(): Promise<void> {
  const path = store.currentPath
  try {
    await bookmarks.create({
      scope: props.side,
      siteId: currentSiteId.value ?? undefined,
      path,
      label: basename(path)
    })
    notify.success('Bookmarked', path)
  } catch (e) {
    notify.error('Could not bookmark folder', e instanceof Error ? e.message : String(e))
  }
}

async function onJumpBookmark(path: string): Promise<void> {
  await store.openDir(path)
}

async function onRemoveBookmark(id: string): Promise<void> {
  await bookmarks.remove(id)
}

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
      filterText.value = ''
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
const syncDialogOpen = ref(false)

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

function buildTransferIntent(sourceSide: 'local' | 'remote', entry: { path: string; name: string; isDir: boolean }, sessionId: string): TransferIntent | null {
  if (entry.name.includes('/') || entry.name.includes('\\') || entry.name === '..' || entry.name === '.') {
    notify.error('Security Warning', 'Invalid file name detected. Transfer aborted.')
    return null
  }
  if (sourceSide === 'local') {
    const remoteTarget = `${remoteFs.currentPath.replace(/\/$/, '')}/${entry.name}`
    return { sessionId, direction: 'upload', localPath: entry.path, remotePath: remoteTarget, isDir: entry.isDir, targetName: entry.name }
  } else {
    const localDir = localFs.currentPath.replace(/[/\\]$/, '')
    const sep = localFs.currentPath.includes('\\') ? '\\' : '/'
    const localTarget = `${localDir}${sep}${entry.name}`
    return { sessionId, direction: 'download', localPath: localTarget, remotePath: entry.path, isDir: entry.isDir, targetName: entry.name }
  }
}

async function checkAndQueueTransfers(intents: TransferIntent[], targetStore: typeof localFs | typeof remoteFs): Promise<void> {
  const conflicts: string[] = []
  for (const intent of intents) {
    if (targetStore.entries.some((e) => e.name === intent.targetName)) {
      conflicts.push(intent.targetName)
    }
  }
  if (conflicts.length > 0) {
    transferConflict.value = { intents, conflicts }
    return
  }
  for (const intent of intents) {
    await transfers.enqueue(intent.sessionId, intent.direction, intent.localPath, intent.remotePath, intent.isDir)
  }
}

async function resolveTransferConflict(): Promise<void> {
  const conflict = transferConflict.value
  if (!conflict) return
  transferConflict.value = null
  for (const intent of conflict.intents) {
    await transfers.enqueue(intent.sessionId, intent.direction, intent.localPath, intent.remotePath, intent.isDir)
  }
}

/** Uploads or downloads `entry`, which belongs to `sourceSide`, into the other pane's current directory. */
async function transferEntry(sourceSide: 'local' | 'remote', entry: FileEntry): Promise<void> {
  const sessionId = sessions.activeSessionId
  if (!sessionId) return
  const intent = buildTransferIntent(sourceSide, entry, sessionId)
  if (!intent) return
  const targetStore = sourceSide === 'local' ? remoteFs : localFs
  await checkAndQueueTransfers([intent], targetStore)
}

async function onTransfer(entry: FileEntry): Promise<void> {
  await transferEntry(props.side, entry)
}

/** Toolbar "Upload/Download N selected" — enqueues every selected row (files and folders alike). */
async function onTransferSelected(): Promise<void> {
  const sessionId = sessions.activeSessionId
  if (!sessionId) return
  const targets = store.entries.filter((e) => store.selected.has(e.path))
  const intents: TransferIntent[] = []
  for (const entry of targets) {
    const intent = buildTransferIntent(props.side, entry, sessionId)
    if (intent) intents.push(intent)
  }
  if (intents.length === 0) return
  const targetStore = props.side === 'local' ? remoteFs : localFs
  await checkAndQueueTransfers(intents, targetStore)
}

async function onTail(entry: FileEntry): Promise<void> {
  const sessionId = sessions.activeSessionId
  if (!sessionId) {
    return
  }
  const dock = useDockState()
  dock.openDock('tail')
  await tailStreams.open(sessionId, entry.path)
}

async function onEdit(entry: FileEntry): Promise<void> {
  try {
    if (props.side === 'local') {
      await invoke<void>(INVOKE_CHANNELS.editOpenLocal, entry.path)
      return
    }
    const sessionId = sessions.activeSessionId
    if (!sessionId) {
      return
    }
    await invoke<{ editId: string }>(INVOKE_CHANNELS.editOpenRemote, { sessionId, path: entry.path })
  } catch (e) {
    notify.error('Could not open for editing', e instanceof Error ? e.message : String(e))
  }
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
  if (!sessionId || !event.dataTransfer) return
  const intents: TransferIntent[] = []
  for (const item of event.dataTransfer.items) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    const localPath = file ? window.api.getPathForFile(file) : ''
    if (!file || !localPath) continue
    const isDir = item.webkitGetAsEntry()?.isDirectory ?? false
    const intent = buildTransferIntent('local', { path: localPath, name: file.name, isDir }, sessionId)
    if (intent) intents.push(intent)
  }
  if (intents.length > 0) {
    await checkAndQueueTransfers(intents, remoteFs)
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
  // Typing in the filter box or the new-folder box must never fall through to pane shortcuts
  // (Delete/Ctrl+A/F2/Ctrl+R) — neither input stops keydown propagation like the rename row does.
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return
  }
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
    store.selectAll(filteredEntries.value)
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
  if (event.key === 'Escape' && filterText.value) {
    event.preventDefault()
    filterText.value = ''
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
  // Folders always confirm before deleting — the keyboard shortcut only skips the
  // dialog when every selected entry is a plain file.
  if (targets.some((e) => e.isDir)) {
    pendingDelete.value = targets
    return
  }
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

/** Context-menu/hover-icon delete on a row that's part of a larger multi-selection removes the whole
 * selection (matching the keyboard Delete path); otherwise it removes just that one row. Unlike the
 * keyboard shortcut, this path always confirms first — it's a deliberate click, not a fast-path key. */
function onRemoveEntry(entry: FileEntry): void {
  if (store.selected.size > 1 && store.selected.has(entry.path)) {
    pendingDelete.value = store.entries.filter((e) => store.selected.has(e.path))
    return
  }
  pendingDelete.value = [entry]
}

async function confirmPendingDelete(): Promise<void> {
  if (!pendingDelete.value) {
    return
  }
  deleting.value = true
  try {
    if (pendingDelete.value.length > 1) {
      await store.removeMany(pendingDelete.value)
    } else {
      await store.remove(pendingDelete.value[0])
    }
    pendingDelete.value = null
  } catch (e) {
    notify.error('Delete failed', e instanceof Error ? e.message : String(e))
  } finally {
    deleting.value = false
  }
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
        v-model:filter-text="filterText"
        :bookmarks="currentBookmarks"
        :can-bookmark="canBookmark"
        :show-sync="showTail"
        @up="store.goUp"
        @refresh="store.load()"
        @mkdir="onMkdirClick"
        @toggle-permissions="ui.togglePermissionsDisplay()"
        @transfer-selected="onTransferSelected"
        @bookmark="onBookmarkFolder"
        @jump-bookmark="onJumpBookmark"
        @remove-bookmark="onRemoveBookmark"
        @sync-folder="syncDialogOpen = true"
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
        :entries="filteredEntries"
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
        @remove="onRemoveEntry"
        @transfer="onTransfer"
        @tail="onTail"
        @rename="onRename"
        @cancel-rename="onCancelRename"
        @start-rename="onStartRename"
        @sort="store.setSort"
        @extract="onExtract"
        @compress="onCompress"
        @chmod="onOpenChmod"
        @edit="onEdit"
      />
      <FilePreviewDialog
        v-model:open="previewOpen"
        :entry="previewEntry"
        :side="side"
        @tail="onTail"
        @download="onTransfer"
      />
      <ChmodDialog v-model:open="chmodOpen" :entry="chmodTarget" @submit="onSubmitChmod" />
      <SyncDialog
        v-if="side === 'remote'"
        v-model:open="syncDialogOpen"
        :session-id="sessions.activeSessionId"
        :initial-local-path="localFs.currentPath"
        :initial-remote-path="remoteFs.currentPath"
      />
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
      <UModal
        :open="Boolean(transferConflict)"
        title="File Conflict"
        :ui="{ footer: 'justify-end' }"
        @update:open="(v: boolean) => { if (!v) transferConflict = null }"
      >
        <template #body>
          <p class="text-sm text-default mb-2">
            The following items already exist in the target directory and will be overwritten:
          </p>
          <ul class="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-md bg-muted p-2 text-xs text-default">
            <li v-for="name in transferConflict?.conflicts" :key="name" class="truncate">{{ name }}</li>
          </ul>
        </template>
        <template #footer>
          <UButton color="neutral" variant="outline" @click="transferConflict = null">Cancel</UButton>
          <UButton color="primary" @click="resolveTransferConflict">Overwrite</UButton>
        </template>
      </UModal>
      <UModal
        :open="Boolean(pendingDelete)"
        title="Delete"
        :ui="{ footer: 'justify-end' }"
        @update:open="(v: boolean) => { if (!v) pendingDelete = null }"
      >
        <template #body>
          <p v-if="pendingDelete && pendingDelete.length === 1" class="text-sm text-default">
            Delete <span class="font-medium">{{ pendingDelete[0].name }}</span
            >{{ pendingDelete[0].isDir ? ' and everything inside it' : '' }}? This cannot be undone.
          </p>
          <div v-else-if="pendingDelete" class="flex flex-col gap-3">
            <p class="text-sm text-default">Delete these {{ pendingDelete.length }} items? This cannot be undone.</p>
            <ul class="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-md bg-muted p-2">
              <li v-for="e in pendingDelete" :key="e.path" class="truncate text-xs text-default">{{ e.name }}</li>
            </ul>
          </div>
        </template>
        <template #footer>
          <UButton color="neutral" variant="outline" @click="pendingDelete = null">Cancel</UButton>
          <UButton color="error" :loading="deleting" @click="confirmPendingDelete">Delete</UButton>
        </template>
      </UModal>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { FileEntry, UnzipResult } from '@shared/contract'
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
import { useConfirm } from '../../composables/useConfirm'
import { useDockState } from '../../composables/useDockState'
import { archiveBaseName, isArchive } from '../../utils/fileTypes'
import { formatBytes, formatShortDate } from '../../utils/format'
import { resolveConflicts, type ConflictChoice } from '../../utils/resolveConflicts'
import FileToolbar from './FileToolbar.vue'
import PathBreadcrumb from './PathBreadcrumb.vue'
import FileList from './FileList.vue'
import FilePreviewDialog from './FilePreviewDialog.vue'
import EditorDialog from './EditorDialog.vue'
import ChmodDialog from './ChmodDialog.vue'
import SyncDialog from './SyncDialog.vue'
import CompareDialog from './CompareDialog.vue'

interface TransferIntent {
  sessionId: string
  direction: 'upload' | 'download'
  localPath: string
  remotePath: string
  isDir: boolean
  targetName: string
  sourceSize: number | null
  sourceModifiedAt: string | null
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
const confirm = useConfirm()

const store = props.side === 'local' ? localFs : remoteFs

const toolbarRef = ref<InstanceType<typeof FileToolbar> | null>(null)
const fileListRef = ref<InstanceType<typeof FileList> | null>(null)
const showNewFolder = ref(false)
const newEntryKind = ref<'folder' | 'file'>('folder')
const newFolderName = ref('')
const isDropTarget = ref(false)
const filterText = ref('')
const isFiltered = computed(() => filterText.value.trim().length > 0)
const filteredEntries = computed(() => {
  const needle = filterText.value.trim().toLowerCase()
  const visible = ui.showHidden ? store.entries : store.entries.filter((e) => !e.name.startsWith('.'))
  if (!needle) {
    return visible
  }
  return visible.filter((e) => e.name.toLowerCase().includes(needle))
})

const paneSummary = computed(() => {
  const list = filteredEntries.value
  let folders = 0
  let files = 0
  for (const e of list) {
    if (e.isDir) folders++
    else files++
  }
  const parts: string[] = []
  if (folders > 0) parts.push(`${folders} ${folders === 1 ? 'folder' : 'folders'}`)
  if (files > 0) parts.push(`${files} ${files === 1 ? 'file' : 'files'}`)
  const base = parts.length > 0 ? parts.join(', ') : '0 items'
  return isFiltered.value ? `${base} (filtered from ${store.entries.length})` : base
})

const selectionSummary = computed(() => {
  const count = store.selected.size
  if (count === 0) return ''
  let bytes = 0
  for (const e of store.entries) {
    if (store.selected.has(e.path) && !e.isDir) {
      bytes += e.size
    }
  }
  return bytes > 0 ? `${count} selected (${formatBytes(bytes)})` : `${count} selected`
})

const previewOpen = ref(false)
const previewEntry = ref<FileEntry | null>(null)
const extractConflict = ref<{ entry: FileEntry; baseName: string; suggestedName: string } | null>(null)
const renamingPath = ref<string | null>(null)
const transferConflict = ref<{ intents: TransferIntent[]; targets: FileEntry[]; conflicts: Array<{ intent: TransferIntent; target: FileEntry }> } | null>(null)
const chmodOpen = ref(false)
const chmodTarget = ref<FileEntry | null>(null)
const editorOpen = ref(false)
const editorState = ref<{ editId: string; localTempPath: string; remotePath: string } | null>(null)

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
const compareDialogOpen = ref(false)

function onOpen(entry: FileEntry): void {
  if (entry.isDir) {
    void store.openDir(entry.path)
    return
  }
  previewEntry.value = entry
  previewOpen.value = true
}

function onHoverDir(path: string): void {
  if (props.side === 'remote') {
    void remoteFs.prefetchDir(path)
  }
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
  newEntryKind.value = 'folder'
  newFolderName.value = ''
  showNewFolder.value = true
}

function onTouchClick(): void {
  newEntryKind.value = 'file'
  newFolderName.value = ''
  showNewFolder.value = true
}

async function submitMkdir(): Promise<void> {
  const name = newFolderName.value.trim()
  showNewFolder.value = false
  if (name) {
    await (newEntryKind.value === 'file' ? store.touch(name) : store.mkdir(name))
  }
}

function buildTransferIntent(sourceSide: 'local' | 'remote', entry: { path: string; name: string; isDir: boolean; size?: number; modifiedAt?: string | null }, sessionId: string, targetDir?: string): TransferIntent | null {
  if (entry.name.includes('/') || entry.name.includes('\\') || entry.name === '..' || entry.name === '.') {
    notify.error('Security Warning', 'Invalid file name detected. Transfer aborted.')
    return null
  }
  const source = { sourceSize: entry.size ?? null, sourceModifiedAt: entry.modifiedAt ?? null }
  if (sourceSide === 'local') {
    const remoteTarget = `${(targetDir ?? remoteFs.currentPath).replace(/\/$/, '')}/${entry.name}`
    return { sessionId, direction: 'upload', localPath: entry.path, remotePath: remoteTarget, isDir: entry.isDir, targetName: entry.name, ...source }
  } else {
    const localBase = targetDir ?? localFs.currentPath
    const localDir = localBase.replace(/[/\\]$/, '')
    const sep = localBase.includes('\\') ? '\\' : '/'
    const localTarget = `${localDir}${sep}${entry.name}`
    return { sessionId, direction: 'download', localPath: localTarget, remotePath: entry.path, isDir: entry.isDir, targetName: entry.name, ...source }
  }
}

async function checkAndQueueTransfers(intents: TransferIntent[], targetStore: typeof localFs | typeof remoteFs): Promise<void> {
  const conflicts: Array<{ intent: TransferIntent; target: FileEntry }> = []
  for (const intent of intents) {
    const target = targetStore.entries.find((e) => e.name === intent.targetName)
    if (target) {
      conflicts.push({ intent, target })
    }
  }
  if (conflicts.length > 0) {
    transferConflict.value = { intents, targets: [...targetStore.entries], conflicts }
    return
  }
  await enqueueIntents(intents)
}

async function enqueueIntents(intents: TransferIntent[]): Promise<void> {
  for (const intent of intents) {
    await transfers.enqueue(intent.sessionId, intent.direction, intent.localPath, intent.remotePath, intent.isDir)
  }
}

async function resolveTransferConflict(choice: ConflictChoice): Promise<void> {
  const conflict = transferConflict.value
  if (!conflict) return
  transferConflict.value = null
  await enqueueIntents(resolveConflicts(conflict.intents, conflict.targets, choice))
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
  const isLarge = entry.size > 5 * 1024 * 1024 // 5MB
  if (isArchive(entry.name) || isLarge) {
    const archive = isArchive(entry.name)
    const proceed = await confirm({
      title: archive ? 'Edit an archive?' : 'Edit a large file?',
      body: archive
        ? `${entry.name} is an archive. Editing it in a text editor can corrupt it.`
        : `${entry.name} is ${formatBytes(entry.size)}. Editing downloads the whole file first, which may take a while.`,
      confirmLabel: 'Edit anyway',
      secondaryLabel: 'Download instead',
      secondaryAction: () => onTransfer(entry)
    })
    if (!proceed) {
      return
    }
  }
  await performEdit(entry)
}

async function performEdit(entry: FileEntry, viaSudo = false): Promise<void> {
  try {
    if (props.side === 'local') {
      await invoke<void>(INVOKE_CHANNELS.editOpenLocal, entry.path)
      return
    }
    const sessionId = sessions.activeSessionId
    if (!sessionId) {
      return
    }
    const res = await invoke<{ editId: string; localTempPath: string }>(INVOKE_CHANNELS.editOpenRemote, { sessionId, path: entry.path, builtin: true, viaSudo })
    editorState.value = { editId: res.editId, localTempPath: res.localTempPath, remotePath: entry.path }
    editorOpen.value = true
  } catch (e) {
    notify.error('Could not open for editing', e instanceof Error ? e.message : String(e))
  }
}

async function onEditAsRoot(entry: FileEntry): Promise<void> {
  await performEdit(entry, true)
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
    await store.load(store.currentPath, { forceRefresh: true })
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
    await remoteFs.load(remoteFs.currentPath, { forceRefresh: true })
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
    const intent = buildTransferIntent('local', { path: localPath, name: file.name, isDir, size: file.size, modifiedAt: new Date(file.lastModified).toISOString() }, sessionId)
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

async function moveInto(folder: FileEntry, fromPath: string, name: string): Promise<void> {
  if (fromPath === folder.path || name === '' || name.includes('/') || name.includes('\\')) return
  const sep = folder.path.includes('\\') ? '\\' : '/'
  const toPath = `${folder.path.replace(/[/\\]$/, '')}${sep}${name}`
  if (props.side === 'remote') {
    await invoke<void>(INVOKE_CHANNELS.fsRemoteRename, sessions.activeSessionId, fromPath, toPath)
  } else {
    await invoke<void>(INVOKE_CHANNELS.fsLocalRename, fromPath, toPath)
  }
}

async function onDropOnFolder(folder: FileEntry, event: DragEvent): Promise<void> {
  isDropTarget.value = false
  const sessionId = sessions.activeSessionId
  try {
    if (isOsFileDrag(event) && event.dataTransfer) {
      const intents: TransferIntent[] = []
      let moved = false
      for (const item of event.dataTransfer.items) {
        const file = item.kind === 'file' ? item.getAsFile() : null
        const localPath = file ? window.api.getPathForFile(file) : ''
        if (!file || !localPath) continue
        if (props.side === 'local') {
          await moveInto(folder, localPath, file.name)
          moved = true
        } else if (sessionId) {
          const isDir = item.webkitGetAsEntry()?.isDirectory ?? false
          const intent = buildTransferIntent('local', { path: localPath, name: file.name, isDir, size: file.size }, sessionId, folder.path)
          if (intent) intents.push(intent)
        }
      }
      if (intents.length > 0) await enqueueIntents(intents)
      if (moved) await store.load(store.currentPath, { forceRefresh: true })
      return
    }
    const payload = getDragPayload()
    clearDrag()
    if (!payload) return
    if (payload.side === props.side) {
      await moveInto(folder, payload.entry.path, payload.entry.name)
      await store.load(store.currentPath, { forceRefresh: true })
    } else if (sessionId) {
      const intent = buildTransferIntent(payload.side, payload.entry, sessionId, folder.path)
      if (intent) await enqueueIntents([intent])
    }
  } catch (e) {
    notify.error('Move failed', e instanceof Error ? e.message : String(e))
  }
}

async function onKeydown(event: KeyboardEvent): Promise<void> {
  // Typing in the filter box or the new-folder box must never fall through to pane shortcuts
  // (Delete/Ctrl+A/F2/Ctrl+R) — neither input stops keydown propagation like the rename row does.
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    (event.target instanceof HTMLElement && event.target.isContentEditable)
  ) {
    return
  }
  // While a row is mid-rename, its own input owns keyboard input (it stops keydown propagation) —
  // this guard is a second line of defense so a stray bubble never triggers delete/refresh.
  if (renamingPath.value !== null) {
    return
  }
  // F6 hops to the other pane (the Windows Explorer convention); Tab stays native so keyboard
  // users can still reach the toolbar, the ⋯ menu and the dock.
  if (event.key === 'F6' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
    const other = props.side === 'local' ? 'remote' : 'local'
    const el = document.querySelector<HTMLElement>(`[data-pane="${other}"]`)
    if (el && !(other === 'local' && !ui.showLocalPane)) {
      event.preventDefault()
      el.focus()
    }
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
    event.preventDefault()
    await store.load(store.currentPath, { forceRefresh: true })
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
    event.preventDefault()
    ui.toggleShowHidden()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    toolbarRef.value?.focusFilter()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    store.selectAll(filteredEntries.value)
    return
  }
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    const [path] = store.selected
    const row = [...document.querySelectorAll<HTMLElement>(`[data-pane="${props.side}"] [data-row-path]`)].find((el) => el.dataset.rowPath === path)
    if (row) {
      event.preventDefault()
      const rect = row.getBoundingClientRect()
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 24, clientY: rect.bottom }))
    }
    return
  }
  if (event.key === 'F5') {
    event.preventDefault()
    await onTransferSelected()
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
  if (event.key === 'Escape') {
    if (filterText.value) {
      event.preventDefault()
      filterText.value = ''
    } else if (store.selected.size > 0) {
      event.preventDefault()
      store.selectAll([])
    }
    return
  }
  if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault()
    await (event.key === 'ArrowLeft' ? store.goBack() : store.goForward())
    return
  }
  if (event.key === 'Backspace') {
    event.preventDefault()
    await store.goUp()
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const list = filteredEntries.value
    if (list.length === 0) return
    event.preventDefault()
    const selectedPaths = Array.from(store.selected)
    const lastSelectedPath = selectedPaths[selectedPaths.length - 1]
    const currentIdx = lastSelectedPath ? list.findIndex((e) => e.path === lastSelectedPath) : -1
    const nextIdx =
      event.key === 'ArrowDown'
        ? Math.min(list.length - 1, currentIdx + 1)
        : currentIdx <= 0
          ? 0
          : currentIdx - 1
    const nextPath = list[nextIdx].path
    if (event.shiftKey) {
      store.selectRange(nextPath)
    } else {
      store.selectOnly(nextPath)
    }
    fileListRef.value?.scrollToIndex(nextIdx)
    return
  }
  if (event.key === 'Enter') {
    if (store.selected.size === 1) {
      const [path] = store.selected
      const entry = filteredEntries.value.find((e) => e.path === path)
      if (entry) {
        event.preventDefault()
        onOpen(entry)
      }
    }
    return
  }
  if (event.key !== 'Delete') {
    return
  }
  if (store.selected.size === 0) {
    return
  }
  event.preventDefault()
  void confirmDeleteEntries(store.entries.filter((e) => store.selected.has(e.path)))
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
    void confirmDeleteEntries(store.entries.filter((e) => store.selected.has(e.path)))
    return
  }
  void confirmDeleteEntries([entry])
}

async function confirmDeleteEntries(entries: FileEntry[]): Promise<void> {
  const single = entries.length === 1 ? entries[0] : null
  await confirm({
    title: 'Delete',
    body: single
      ? `Delete ${single.name}${single.isDir ? ' and everything inside it' : ''}? This cannot be undone.`
      : `Delete these ${entries.length} items? This cannot be undone.`,
    items: single ? undefined : entries.map((e) => e.name),
    confirmLabel: 'Delete',
    confirmColor: 'error',
    destructive: true,
    action: () => (entries.length > 1 ? store.removeMany(entries) : store.remove(entries[0]))
  })
}

function onOpenChmod(entry: FileEntry): void {
  chmodTarget.value = entry
  chmodOpen.value = true
}

async function onSubmitChmod(entry: FileEntry, mode: string, extras: { recursive: boolean; owner: string; group: string }): Promise<void> {
  try {
    if (extras.recursive || extras.owner || extras.group) {
      await remoteFs.admin(entry, { mode, ...extras })
    } else {
      await remoteFs.chmod(entry, mode)
    }
  } catch (e) {
    notify.error('Could not change permissions', e instanceof Error ? e.message : String(e))
  }
}
</script>

<template>
  <div
    class="flex h-full flex-col overflow-hidden border-r border-muted outline-none transition-[width] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary duration-200 ease-in-out last:border-r-0"
    :class="[
      collapsedRail ? 'w-9 shrink-0' : side === 'local' ? 'min-w-0' : 'min-w-0 flex-1',
      isDropTarget ? 'bg-primary/5 ring-2 ring-primary ring-inset' : ''
    ]"
    tabindex="0"
    :data-pane="side"
    @focusin="ui.activePane = side"
    @pointerdown="ui.activePane = side"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @keydown="onKeydown"
  >
    <button
      v-if="collapsedRail"
      type="button"
      aria-label="Show Local pane"
      title="Show Local pane"
      class="flex h-full w-full flex-col items-center gap-3 bg-muted/40 py-2.5 text-muted transition-colors hover:bg-muted hover:text-highlighted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      @click="ui.toggleLocalPane()"
    >
      <UIcon name="i-lucide-panel-left-open" class="size-4 shrink-0" />
      <span class="select-none text-[10px] font-semibold uppercase tracking-widest [writing-mode:vertical-rl] rotate-180">
        Local
      </span>
    </button>
    <template v-else>
      <div
        class="flex h-9 shrink-0 items-center border-b border-muted pl-2"
        :class="ui.activePane === side ? 'bg-elevated shadow-[inset_3px_0_0_var(--ui-primary)]' : 'bg-default'"
      >
        <UIcon
          :name="side === 'local' ? 'i-lucide-monitor' : 'i-lucide-server'"
          class="size-3.5 shrink-0"
          :class="ui.activePane === side ? 'text-highlighted' : 'text-muted'"
          :title="side === 'local' ? 'Local' : 'Remote'"
        />
        <PathBreadcrumb :path="store.currentPath" @navigate="store.openDir" />
        <FileToolbar
        ref="toolbarRef"
        :side="side"
        :loading="store.loading"
        :selected-count="store.selected.size"
        :transfer-icon="transferIcon"
        v-model:filter-text="filterText"
        :bookmarks="currentBookmarks"
        :can-bookmark="canBookmark"
        :show-sync="showTail"
        :can-go-back="store.canGoBack"
        :can-go-forward="store.canGoForward"
        @back="store.goBack"
        @forward="store.goForward"
        @up="store.goUp"
        @refresh="store.load(store.currentPath, { forceRefresh: true })"
        @mkdir="onMkdirClick"
        @touch="onTouchClick"
        :show-hidden="ui.showHidden"
        @toggle-hidden="ui.toggleShowHidden()"
        @toggle-permissions="ui.togglePermissionsDisplay()"
        @transfer-selected="onTransferSelected"
        @bookmark="onBookmarkFolder"
        @jump-bookmark="onJumpBookmark"
        @remove-bookmark="onRemoveBookmark"
        @sync-folder="syncDialogOpen = true"
        @compare-folder="compareDialogOpen = true"
        />
      </div>
      <div v-if="showNewFolder" class="flex items-center gap-2 border-b border-muted px-3 py-1.5">
        <UInput
          v-model="newFolderName"
          size="xs"
          :placeholder="newEntryKind === 'file' ? 'New file name' : 'New folder name'"
          class="flex-1"
          autofocus
          @keyup.enter="submitMkdir"
          @keyup.esc="showNewFolder = false"
        />
        <UButton size="xs" @click="submitMkdir">Create</UButton>
      </div>
      <div v-if="store.error" role="alert" class="flex shrink-0 items-center gap-2 px-3 py-1 text-xs text-error">
        <span class="min-w-0 flex-1 truncate" :title="store.error">{{ store.error }}</span>
        <button
          type="button"
          class="shrink-0 font-medium hover:underline focus-visible:outline-2 focus-visible:outline-primary rounded-xs"
          @click="store.load(store.currentPath, { forceRefresh: true })"
        >
          Retry
        </button>
      </div>
      <FileList
        ref="fileListRef"
        :entries="filteredEntries"
        :selected="store.selected"
        :side="side"
        :active="ui.activePane === side"
        :loading="store.loading"
        :filtered="isFiltered"
        :transfer-icon="transferIcon"
        :show-tail="showTail"
        :allow-extract="showTail"
        :renaming-path="renamingPath"
        :sort-column="store.sortColumn"
        :sort-direction="store.sortDirection"
        @select="onSelect"
        @select-many="(paths: string[]) => store.selectPaths(paths)"
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
        @hover-dir="onHoverDir"
        @drop-on="onDropOnFolder"
        @edit-root="onEditAsRoot"
        @clear-filter="filterText = ''"
      />
      <div class="flex h-6 shrink-0 select-none items-center justify-between border-t border-muted bg-muted/30 px-3 text-2xs text-muted">
        <span class="truncate">{{ paneSummary }}</span>
        <div v-if="selectionSummary" class="flex items-center gap-1.5">
          <span class="font-medium text-default">{{ selectionSummary }}</span>
          <button
            type="button"
            class="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary rounded-xs"
            @click="store.selectAll([])"
          >
            Clear
          </button>
        </div>
      </div>
      <FilePreviewDialog
        v-model:open="previewOpen"
        :entry="previewEntry"
        :side="side"
        @tail="onTail"
        @download="onTransfer"
        @edit="onEdit"
      />
      <EditorDialog
        v-if="side === 'remote'"
        v-model:open="editorOpen"
        :edit-id="editorState?.editId ?? null"
        :local-temp-path="editorState?.localTempPath ?? null"
        :remote-path="editorState?.remotePath ?? null"
      />
      <ChmodDialog v-model:open="chmodOpen" :entry="chmodTarget" @submit="onSubmitChmod" />
      <CompareDialog
        v-if="side === 'remote'"
        v-model:open="compareDialogOpen"
        :session-id="sessions.activeSessionId"
        :initial-local-path="localFs.currentPath"
        :initial-remote-path="remoteFs.currentPath"
      />
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
        :ui="{ footer: 'flex-wrap justify-end' }"
        @update:open="(v: boolean) => { if (!v) transferConflict = null }"
      >
        <template #body>
          <p class="mb-2 text-sm text-default">These items already exist in the target directory:</p>
          <ul class="flex max-h-60 flex-col gap-2 overflow-y-auto rounded-md bg-muted p-2 text-xs text-default">
            <li v-for="c in transferConflict?.conflicts" :key="c.intent.targetName" class="flex flex-col gap-0.5">
              <span class="truncate font-medium">{{ c.intent.targetName }}</span>
              <span class="text-muted">
                New: {{ c.intent.isDir ? 'folder' : formatBytes(c.intent.sourceSize ?? 0) }}, {{ formatShortDate(c.intent.sourceModifiedAt) || 'unknown date' }}
              </span>
              <span class="text-muted">
                Existing: {{ c.target.isDir ? 'folder' : formatBytes(c.target.size) }}, {{ formatShortDate(c.target.modifiedAt) || 'unknown date' }}
              </span>
            </li>
          </ul>
        </template>
        <template #footer>
          <UButton color="neutral" variant="outline" @click="transferConflict = null">Cancel</UButton>
          <UButton color="neutral" variant="outline" @click="resolveTransferConflict('skip')">Skip existing</UButton>
          <UButton color="neutral" variant="outline" @click="resolveTransferConflict('rename')">Keep both</UButton>
          <UButton color="neutral" variant="outline" @click="resolveTransferConflict('newer')">Overwrite if newer</UButton>
          <UButton color="primary" @click="resolveTransferConflict('overwrite')">Overwrite all</UButton>
        </template>
      </UModal>
    </template>
  </div>
</template>

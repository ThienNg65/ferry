<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { FileEntry, FileListResult, StageDropBeginResult, StageDropEntryInput, UnzipResult } from '@shared/contract'
import { invoke, IpcError } from '../../api'
import { useLocalFsStore } from '../../stores/localFs.store'
import { useRemoteFsStore } from '../../stores/remoteFs.store'
import { useSessionsStore } from '../../stores/sessions.store'
import { useBookmarksStore } from '../../stores/bookmarks.store'
import { useTransferQueueStore } from '../../stores/transferQueue.store'
import { useTailStreamsStore } from '../../stores/tailStreams.store'
import { useUiStore } from '../../stores/ui.store'
import { resolveConnectionFilterKey, resolveLegacyConnectionFilterKey, useFileFiltersStore } from '../../stores/fileFilters.store'
import { useDragAndDrop } from '../../composables/useDragAndDrop'
import { useNotify } from '../../composables/useNotify'
import { useConfirm } from '../../composables/useConfirm'
import { registerPaneActions } from '../../composables/usePaneActions'
import { useDockState } from '../../composables/useDockState'
import { archiveBaseName, isArchive } from '../../utils/fileTypes'
import { formatBytes } from '../../utils/format'
import {
  composePaneEntries,
  emptyVisibilityFilter,
  type FileVisibilityFilter
} from '../../utils/fileVisibilityFilter'
import type { TransferIntent } from '../../composables/useTransferIntents'
import { useTransferIntents } from '../../composables/useTransferIntents'
import { usePaneKeyboard } from '../../composables/usePaneKeyboard'
import { useDebouncedRef } from '../../composables/useDebouncedRef'
import FileToolbar from './FileToolbar.vue'
import PathBreadcrumb from './PathBreadcrumb.vue'
import FileList from './FileList.vue'
import TransferConflictDialog from './TransferConflictDialog.vue'

const FilePreviewDialog = defineAsyncComponent(() => import('./FilePreviewDialog.vue'))
const EditorDialog = defineAsyncComponent(() => import('./EditorDialog.vue'))
const ChmodDialog = defineAsyncComponent(() => import('./ChmodDialog.vue'))
const SyncDialog = defineAsyncComponent(() => import('./SyncDialog.vue'))
const CompareDialog = defineAsyncComponent(() => import('./CompareDialog.vue'))

const props = defineProps<{ side: 'local' | 'remote' }>()

const localFs = useLocalFsStore()
const remoteFs = useRemoteFsStore()
const sessions = useSessionsStore()
const bookmarks = useBookmarksStore()
const transfers = useTransferQueueStore()
const tailStreams = useTailStreamsStore()
const ui = useUiStore()
const fileFilters = useFileFiltersStore()
const { getDragPayload, clearDrag } = useDragAndDrop()
const notify = useNotify()
const confirm = useConfirm()
const {
  transferConflict,
  buildTransferIntent,
  checkAndQueueTransfers,
  enqueueIntents,
  dismissTransferConflict,
  resolveTransferConflict,
  transferEntry
} = useTransferIntents()

const toast = useToast()

const store = props.side === 'local' ? localFs : remoteFs

const paneEl = ref<HTMLElement | null>(null)
const toolbarRef = ref<InstanceType<typeof FileToolbar> | null>(null)
const fileListRef = ref<InstanceType<typeof FileList> | null>(null)
const showNewFolder = ref(false)
const newEntryKind = ref<'folder' | 'file'>('folder')
const newFolderName = ref('')
const isDropTarget = ref(false)
const filterText = ref('')
const { debounced: debouncedFilter } = useDebouncedRef(filterText, 120)
const connectionFilterKey = computed(() =>
  props.side === 'remote' ? resolveConnectionFilterKey(sessions.activeTab) : null
)
const activeVisibilityFilter = computed<FileVisibilityFilter>(() =>
  props.side === 'remote'
    ? fileFilters.getFilter(connectionFilterKey.value, resolveLegacyConnectionFilterKey(sessions.activeTab))
    : emptyVisibilityFilter()
)
const paneEntriesResult = computed(() =>
  composePaneEntries(store.entries, {
    showHidden: ui.showHidden,
    visibilityFilter: props.side === 'remote' ? activeVisibilityFilter.value : undefined,
    searchQuery: debouncedFilter.value
  })
)
const isVisibilityFiltered = computed(() => paneEntriesResult.value.visibilityActive)
const isSearchFiltered = computed(() => paneEntriesResult.value.searchActive)
const isFiltered = computed(() => isVisibilityFiltered.value || isSearchFiltered.value)
const filteredEntries = computed(() => paneEntriesResult.value.entries)

function updateVisibilityFilter(next: FileVisibilityFilter): void {
  if (props.side !== 'remote') return
  fileFilters.setFilter(connectionFilterKey.value, next)
}

function clearVisibilityFilter(): void {
  if (props.side !== 'remote') return
  fileFilters.clearFilter(connectionFilterKey.value)
}

const paneSummary = computed(() => {
  const { entries: list, totalFiles, visibleFiles, visibilityActive, searchActive } = paneEntriesResult.value
  let folders = 0
  for (const e of list) {
    if (e.isDir) folders++
  }
  const parts: string[] = []
  if (folders > 0) parts.push(`${folders} ${folders === 1 ? 'folder' : 'folders'}`)
  if (visibilityActive) {
    parts.push(`${visibleFiles} of ${totalFiles} ${totalFiles === 1 ? 'file' : 'files'}`)
  } else if (visibleFiles > 0) {
    parts.push(`${visibleFiles} ${visibleFiles === 1 ? 'file' : 'files'}`)
  }
  const base = parts.length > 0 ? parts.join(', ') : '0 items'
  if (visibilityActive && searchActive) return `${base} (search active)`
  if (!visibilityActive && searchActive) return `${base} (filtered from ${store.entries.length})`
  return base
})

const visibleSelectedEntries = computed(() =>
  filteredEntries.value.filter((e) => store.selected.has(e.path))
)

const selectionSummary = computed(() => {
  const selected = visibleSelectedEntries.value
  const count = selected.length
  if (count === 0) return ''
  let bytes = 0
  for (const e of selected) {
    if (!e.isDir) {
      bytes += e.size
    }
  }
  return bytes > 0 ? `${count} selected (${formatBytes(bytes)})` : `${count} selected`
})

const previewOpen = ref(false)
const previewEntry = ref<FileEntry | null>(null)
const extractConflict = ref<{ entry: FileEntry; baseName: string; suggestedName: string } | null>(null)
const renamingPath = ref<string | null>(null)
let renameInFlight = false
const chmodOpen = ref(false)
const chmodTarget = ref<FileEntry | null>(null)
const editorOpen = ref(false)
const editorState = ref<{ editId: string; localTempPath: string; remotePath: string } | null>(null)

/** Navigating away mid-rename would otherwise leave a stale edit box pointing at a path that's no longer listed. */
watch(
  () => [store.currentPath, props.side === 'remote' ? sessions.activeSessionId : null],
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

const unregisterPaneActions = registerPaneActions(props.side, {
  selectedCount: () => visibleSelectedEntries.value.length,
  rename: () => {
    if (visibleSelectedEntries.value.length === 1) {
      const target = visibleSelectedEntries.value[0]
      const idx = filteredEntries.value.findIndex((e) => e.path === target.path)
      if (idx >= 0) {
        fileListRef.value?.scrollToIndex(idx)
        renamingPath.value = target.path
      }
    }
  },
  remove: () => void confirmDeleteEntries(visibleSelectedEntries.value),
  transfer: () => void onTransferSelected(),
  edit: () => {
    const entry = visibleSelectedEntries.value.length === 1 ? visibleSelectedEntries.value[0] : undefined
    if (entry && !entry.isDir) {
      void onEdit(entry)
    }
  }
})
onBeforeUnmount(unregisterPaneActions)

const onKeydown = usePaneKeyboard({
  side: props.side,
  store,
  renamingPath,
  filterText,
  filteredEntries,
  toolbarRef,
  fileListRef,
  onTransferSelected,
  onOpen,
  confirmDeleteEntries
})

void bookmarks.ensureLoaded()

/** Saved sites retain their IDs; Quick Connect uses the port-aware endpoint key. */
const currentSiteId = computed(() =>
  props.side === 'remote'
    ? (sessions.activeTab.siteId ?? resolveConnectionFilterKey(sessions.activeTab))
    : null
)
const canBookmark = computed(
  () => props.side === 'local' || (sessions.status === 'connected' && Boolean(currentSiteId.value))
)
const currentBookmarks = computed(() => {
  if (props.side === 'local') {
    return bookmarks.localBookmarks
  }
  return currentSiteId.value
    ? bookmarks.forSite(
        currentSiteId.value,
        // Legacy hostLabel bookmarks can only be read on the default SSH port.
        // Never expose them to a different service on the same hostname.
        sessions.activeTab.siteId
          ? sessions.activeTab.hostLabel
          : sessions.activeTab.quickConnectInput?.port === 22
            ? sessions.activeTab.hostLabel
            : null
      )
    : []
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
  try {
    await bookmarks.remove(id)
  } catch (e) {
    notify.error('Could not remove bookmark', e instanceof Error ? e.message : String(e))
  }
}

if (props.side === 'local') {
  onMounted(() => {
    if (!store.currentPath && !store.loading && !store.error) {
      void store.load()
    }
  })
} else {
  // One remote FilePane instance is shared by every open site tab — load lazily
  // per-session the first time a tab's session becomes active (remoteFs.store.ts
  // caches each session's listing, so switching back to an already-loaded tab
  // is instant and re-fetches nothing).
  watch(
    () => (sessions.status === 'connected' ? sessions.activeSessionId : null),
    (id) => {
      filterText.value = ''
      if (id && remoteFs.needsLoad(id)) {
        void remoteFs.loadForSession(id)
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
    store.selectRange(path, filteredEntries.value)
  } else if (event.ctrlKey || event.metaKey) {
    store.toggleSelect(path)
  } else {
    store.selectOnly(path)
  }
  paneEl.value?.focus({ preventScroll: true })
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
  const kind = newEntryKind.value
  showNewFolder.value = false
  if (!name) return
  try {
    store.setError(null)
    await (kind === 'file' ? store.touch(name) : store.mkdir(name))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    notify.error(kind === 'file' ? 'Could not create file' : 'Could not create folder', message)
    store.setError(message)
  }
}

async function onTransfer(entry: FileEntry): Promise<void> {
  await transferEntry(props.side, entry)
}

/** Toolbar "Upload/Download N selected" — enqueues every selected row (files and folders alike). */
async function onTransferSelected(): Promise<void> {
  const sessionId = sessions.activeSessionId
  if (!sessionId) return
  const targets = visibleSelectedEntries.value
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
  try {
    await tailStreams.open(sessionId, entry.path)
  } catch (e) {
    notify.error('Could not open log tail', e instanceof Error ? e.message : String(e))
  }
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
        destPath: `${store.currentPath.replace(/[/\\]+$/, '')}${sep}${zipName}`
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

const MAX_STAGE_DROP_BYTES = 16 * 1024 * 1024
const STAGE_STREAM_CONCURRENCY = 4
const LARGE_DROP_TOAST_BYTES = 32 * 1024 * 1024

interface MinimalFsEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (success: (f: File) => void, error?: (err: unknown) => void) => void
  createReader?: () => { readEntries: (success: (entries: MinimalFsEntry[]) => void, error?: (err: unknown) => void) => void }
}

interface CollectedDropEntry {
  relativePath: string
  isDir: boolean
  file?: File
  modifiedAt?: string
}

async function collectDroppedEntry(
  fsEntry: MinimalFsEntry,
  relPath: string,
  out: CollectedDropEntry[],
  state: { totalBytes: number }
): Promise<void> {
  if (fsEntry.isFile && fsEntry.file) {
    const file = await new Promise<File>((resolve, reject) => {
      fsEntry.file!(resolve, reject)
    })
    state.totalBytes += file.size
    out.push({
      relativePath: relPath,
      isDir: false,
      file,
      modifiedAt: new Date(file.lastModified).toISOString()
    })
    return
  }
  if (fsEntry.isDirectory && fsEntry.createReader) {
    out.push({ relativePath: relPath, isDir: true })
    const reader = fsEntry.createReader()
    while (true) {
      const batch = await new Promise<MinimalFsEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject)
      })
      if (batch.length === 0) break
      for (const child of batch) {
        await collectDroppedEntry(child, `${relPath}/${child.name}`, out, state)
      }
    }
  }
}

function dedupRelativeName(rawName: string, seen: Set<string>): string {
  const key = rawName.toLowerCase()
  if (!seen.has(key)) {
    seen.add(key)
    return rawName
  }
  const dot = rawName.lastIndexOf('.')
  const stem = dot > 0 ? rawName.slice(0, dot) : rawName
  const ext = dot > 0 ? rawName.slice(dot) : ''
  let n = 2
  while (seen.has(`${stem} (${n})${ext}`.toLowerCase())) {
    n += 1
  }
  const unique = `${stem} (${n})${ext}`
  seen.add(unique.toLowerCase())
  return unique
}

async function stageCollectedEntriesStreaming(
  collected: CollectedDropEntry[],
  totalBytes: number,
  stageDroppedFile: NonNullable<Window['api']['stageDroppedFile']>
): Promise<FileEntry[]> {
  const dirs = collected.filter((e) => e.isDir).map((e) => e.relativePath)
  const files = collected.filter((e): e is CollectedDropEntry & { file: File } => !e.isDir && Boolean(e.file))
  const { stageId } = await invoke<StageDropBeginResult>(INVOKE_CHANNELS.fsLocalStageDropBegin, { dirs })
  const toastId =
    totalBytes > LARGE_DROP_TOAST_BYTES
      ? toast.add({
          title: 'Preparing dropped files…',
          description: `Staging ${formatBytes(totalBytes)} for upload`,
          icon: 'i-lucide-loader-2',
          duration: 0
        }).id
      : null

  const controller = new AbortController()
  let firstError: unknown = null
  try {
    let cursor = 0
    const workerCount = Math.min(STAGE_STREAM_CONCURRENCY, files.length)
    const workers = Array.from({ length: workerCount }, async () => {
      while (!controller.signal.aborted && cursor < files.length) {
        const item = files[cursor++]
        try {
          await stageDroppedFile(stageId, item.relativePath, item.file, item.modifiedAt, controller.signal)
        } catch (err) {
          if (firstError === null) {
            firstError = err
            controller.abort()
          }
          throw err
        }
      }
    })
    await Promise.allSettled(workers)
    if (firstError !== null) {
      throw firstError
    }
    return await invoke<FileEntry[]>(INVOKE_CHANNELS.fsLocalStageDropFinish, { stageId })
  } catch (err) {
    await invoke<void>(INVOKE_CHANNELS.fsLocalStageDropAbort, { stageId }).catch(() => undefined)
    throw err
  } finally {
    if (toastId !== null) {
      toast.remove(toastId)
    }
  }
}

/**
 * Resolves external OS drops to real local `FileEntry` items, streaming dropped
 * files/folders over authenticated localhost HTTP when WebView2 hides host paths.
 */
async function resolveOsDroppedEntries(dataTransfer: DataTransfer): Promise<FileEntry[]> {
  const direct: FileEntry[] = []
  const unresolved: Array<{ file: File; fsEntry: MinimalFsEntry | null }> = []

  // Snapshot DataTransferItemList synchronously before any await clears it.
  for (const item of dataTransfer.items) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (!file) continue
    const fsEntry = (item.webkitGetAsEntry?.() as MinimalFsEntry | null) ?? null
    const localPath = window.api.getPathForFile(file)
    if (localPath) {
      direct.push({
        name: file.name,
        path: localPath,
        isDir: fsEntry?.isDirectory ?? false,
        size: file.size,
        modifiedAt: new Date(file.lastModified).toISOString(),
        isSymlink: false
      })
    } else {
      unresolved.push({ file, fsEntry })
    }
  }

  if (unresolved.length === 0) {
    return direct
  }

  const collected: CollectedDropEntry[] = []
  const seenTopNames = new Set<string>()
  const state = { totalBytes: 0 }
  for (const { file, fsEntry } of unresolved) {
    if (fsEntry) {
      const topName = dedupRelativeName(fsEntry.name, seenTopNames)
      await collectDroppedEntry(fsEntry, topName, collected, state)
    } else {
      state.totalBytes += file.size
      collected.push({
        relativePath: dedupRelativeName(file.name, seenTopNames),
        isDir: false,
        file,
        modifiedAt: new Date(file.lastModified).toISOString()
      })
    }
  }

  if (collected.length === 0) {
    return direct
  }

  const streamUpload = window.api.stageDroppedFile
  if (streamUpload) {
    const staged = await stageCollectedEntriesStreaming(collected, state.totalBytes, streamUpload)
    return [...direct, ...staged]
  }

  if (state.totalBytes > MAX_STAGE_DROP_BYTES) {
    throw new Error('Dropped files exceed 16 MB WebView drop limit. Use the Local pane for larger transfers.')
  }
  const stageInputs: StageDropEntryInput[] = await Promise.all(
    collected.map(async (item) => ({
      relativePath: item.relativePath,
      isDir: item.isDir,
      ...(item.isDir || !item.file ? {} : { data: new Uint8Array(await item.file.arrayBuffer()) }),
      modifiedAt: item.modifiedAt
    }))
  )
  const staged = await invoke<FileEntry[]>(INVOKE_CHANNELS.fsLocalStageDrop, { entries: stageInputs })
  return [...direct, ...staged]
}

/** Uploads every file/folder dropped from the OS straight into the remote pane's current directory. */
async function onOsDrop(event: DragEvent): Promise<void> {
  const sessionId = sessions.activeSessionId
  if (!sessionId || !event.dataTransfer) return
  try {
    const entries = await resolveOsDroppedEntries(event.dataTransfer)
    const intents: TransferIntent[] = []
    for (const entry of entries) {
      const intent = buildTransferIntent('local', entry, sessionId)
      if (intent) intents.push(intent)
    }
    if (intents.length > 0) {
      await checkAndQueueTransfers(intents, remoteFs)
    }
  } catch (e) {
    notify.error('External file drop failed', e instanceof Error ? e.message : String(e))
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
    const listing = await invoke<FileListResult>(INVOKE_CHANNELS.fsLocalList, folder.path)
    if (listing.entries.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`"${name}" already exists in ${folder.name}`)
    }
    await invoke<void>(INVOKE_CHANNELS.fsLocalRename, fromPath, toPath)
  }
}

async function onDropOnFolder(folder: FileEntry, event: DragEvent): Promise<void> {
  isDropTarget.value = false
  const sessionId = sessions.activeSessionId
  try {
    if (isOsFileDrag(event) && event.dataTransfer) {
      const entries = await resolveOsDroppedEntries(event.dataTransfer)
      const intents: TransferIntent[] = []
      const unusedPaths: string[] = []
      let moved = false
      for (const entry of entries) {
        if (props.side === 'local') {
          await moveInto(folder, entry.path, entry.name)
          moved = true
        } else if (sessionId) {
          const intent = buildTransferIntent('local', entry, sessionId, folder.path)
          if (intent) {
            intents.push(intent)
          } else {
            unusedPaths.push(entry.path)
          }
        } else {
          unusedPaths.push(entry.path)
        }
      }
      if (unusedPaths.length > 0) {
        void invoke<void>(INVOKE_CHANNELS.fsLocalCleanupStagedDrop, { paths: unusedPaths }).catch(() => undefined)
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

async function onRename(entry: FileEntry, newName: string): Promise<void> {
  if (renameInFlight || renamingPath.value !== entry.path) return
  const target = { ...entry }
  const local = props.side === 'local'
  const windows = local && (/^[A-Za-z]:/.test(entry.path) || entry.path.startsWith('\\\\'))
  if (!newName.trim() || newName === '.' || newName === '..' || /[/\\]/.test(newName) || newName.includes('\0')) {
    notify.error('Enter a single file or folder name', 'Use a name without path separators.')
    return
  }
  if (windows && (/[<>:"|?*\x00-\x1f]|[. ]$/.test(newName) ||
    /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i.test(newName))) {
    notify.error('Invalid Windows filename', 'Choose a name without reserved characters, device names, or a trailing space or period.')
    return
  }

  const sessionId = sessions.activeSessionId
  const rename = (replace: boolean): Promise<void> => {
    if (renamingPath.value !== target.path) throw new Error('Select the item and start the rename again.')
    if (local) return localFs.rename(target, newName, replace)
    if (!sessionId || sessions.activeSessionId !== sessionId || sessions.status !== 'connected') {
      throw new Error('Return to the original server and start the rename again.')
    }
    return remoteFs.rename(target, newName, replace, sessionId)
  }

  renameInFlight = true
  try {
    try {
      await rename(false)
    } catch (e) {
      if (!(e instanceof IpcError) || e.code !== 'ALREADY_EXISTS') throw e
      const destination = target.path.slice(0, target.path.length - target.name.length) + newName
      const replaced = await confirm({
        title: 'Replace existing item?',
        body: 'Renaming will replace the item at this path.',
        items: [destination],
        confirmLabel: 'Replace',
        confirmColor: 'error',
        destructive: true,
        action: () => rename(true)
      })
      if (!replaced) return
    }
    if (renamingPath.value === target.path && (local || sessions.activeSessionId === sessionId)) {
      renamingPath.value = null
      paneEl.value?.focus()
    }
  } catch (e) {
    notify.error('Rename failed', e instanceof Error ? e.message : String(e))
  } finally {
    renameInFlight = false
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
  if (visibleSelectedEntries.value.length > 1 && store.selected.has(entry.path)) {
    void confirmDeleteEntries(visibleSelectedEntries.value)
    return
  }
  void confirmDeleteEntries([entry])
}

async function confirmDeleteEntries(entries: FileEntry[]): Promise<void> {
  if (entries.length === 0) return
  const targets = entries.map((entry) => ({ ...entry }))
  const single = targets.length === 1 ? targets[0] : null
  const sessionId = props.side === 'remote' ? sessions.activeSessionId : null
  if (props.side === 'remote' && !sessionId) return
  const server = sessionId ? sessions.activeTab.hostLabel || sessions.activeTab.label : null
  await confirm({
    title: 'Delete',
    body: single
      ? `Delete this ${single.isDir ? 'folder and everything inside it' : 'item'}${server ? ` on ${server}` : ''}? This cannot be undone.`
      : `Delete these ${targets.length} items${server ? ` on ${server}` : ''}? This cannot be undone.`,
    items: targets.map((entry) => entry.path),
    confirmLabel: 'Delete',
    confirmColor: 'error',
    destructive: true,
    action: async () => {
      if (sessionId) {
        if (!sessions.tabs.some((tab) => tab.sessionId === sessionId && tab.status === 'connected')) {
          throw new Error('The original server connection ended. Reconnect and select the items again.')
        }
        if (single) await remoteFs.remove(single, sessionId)
        else await remoteFs.removeMany(targets, sessionId)
      } else if (single) {
        await localFs.remove(single)
      } else {
        await localFs.removeMany(targets)
      }
    }
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
    ref="paneEl"
    class="flex h-full flex-col overflow-hidden border-r outline-none transition-[width] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary duration-[var(--ferry-motion-panel)] ease-[var(--ferry-motion-ease-emphasized)] last:border-r-0"
    :class="[
      collapsedRail ? 'w-9 shrink-0' : side === 'local' ? 'min-w-0' : 'min-w-0 flex-1',
      ui.glassUiEnabled ? 'bg-transparent border-[var(--ferry-glass-chrome-border)]' : 'border-muted',
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
      class="flex h-full w-full flex-col items-center gap-3 py-2.5 text-muted transition-colors hover:bg-muted hover:text-highlighted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      :class="ui.glassUiEnabled ? 'ferry-glass-chrome' : 'bg-muted/40'"
      @click="ui.toggleLocalPane()"
    >
      <UIcon name="i-lucide-panel-left-open" class="size-4 shrink-0" />
      <span class="select-none text-3xs font-semibold uppercase tracking-widest [writing-mode:vertical-rl] rotate-180">
        Local
      </span>
    </button>
    <template v-else>
      <div
        class="@container flex min-h-9 min-w-0 shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-muted py-1 pr-2"
        :class="[
          ui.glassUiEnabled ? 'ferry-glass-chrome' : ui.activePane === side ? 'bg-elevated' : 'bg-default',
          ui.activePane === side ? 'pl-2.5 shadow-[inset_3px_0_0_var(--ui-primary)]' : 'pl-2'
        ]"
      >
        <div
          class="flex h-7 min-w-[160px] flex-1 basis-full items-center gap-1.5 rounded-md pl-2 pr-1 transition-colors @[580px]:basis-0"
          :class="
            ui.glassUiEnabled
              ? 'border border-[var(--ferry-glass-chrome-border)] bg-[var(--ferry-surface-subtle)] hover:bg-[var(--ui-bg)]/55 focus-within:border-[var(--ui-primary)]/50 focus-within:bg-[var(--ui-bg)]/90'
              : 'bg-muted/35 ring-1 ring-inset ring-muted/60 hover:bg-muted/55 focus-within:bg-default focus-within:ring-primary/50'
          "
        >
          <UIcon
            :name="side === 'local' ? 'i-lucide-monitor' : 'i-lucide-server'"
            class="size-3.5 shrink-0"
            :class="ui.activePane === side ? 'text-primary' : 'text-muted'"
            :title="side === 'local' ? 'Local' : 'Remote'"
          />
          <PathBreadcrumb :path="store.currentPath" @navigate="store.openDir" />
        </div>
        <FileToolbar
        ref="toolbarRef"
        :side="side"
        :loading="store.loading"
        :selected-count="visibleSelectedEntries.length"
        :transfer-icon="transferIcon"
        v-model:filter-text="filterText"
        :visibility-filter="side === 'remote' ? activeVisibilityFilter : undefined"
        :bookmarks="currentBookmarks"
        :can-bookmark="canBookmark"
        :show-sync="showTail"
        :can-go-back="store.canGoBack"
        :can-go-forward="store.canGoForward"
        @update:visibility-filter="updateVisibilityFilter"
        @clear-visibility-filter="clearVisibilityFilter"
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
      <Transition name="slide-down">
        <div
          v-if="showNewFolder"
          class="flex items-center gap-2 border-b border-muted px-3 py-1.5"
          :class="ui.glassUiEnabled ? 'ferry-glass-well' : ''"
        >
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
      </Transition>
      <Transition name="slide-down">
        <div
          v-if="store.error"
          role="alert"
          class="flex shrink-0 items-center gap-2 px-3 py-1 text-xs text-error"
          :class="ui.glassUiEnabled ? 'ferry-glass-well' : ''"
        >
          <span class="min-w-0 flex-1 break-all">
            <template v-if="store.failedPath !== null">Could not open {{ store.failedPath || 'the starting folder' }}. </template>
            {{ store.error }}
          </span>
          <button
            type="button"
            class="shrink-0 font-medium hover:underline focus-visible:outline-2 focus-visible:outline-primary rounded-xs"
            @click="store.retryDirectory()"
          >
            {{ store.failedPath !== null ? 'Retry folder' : 'Retry' }}
          </button>
        </div>
      </Transition>
      <FileList
        ref="fileListRef"
        :entries="filteredEntries"
        :directory-path="store.currentPath"
        :selected="store.selected"
        :side="side"
        :active="ui.activePane === side"
        :loading="store.loading"
        :filtered="isFiltered"
        :visibility-filtered="isVisibilityFiltered"
        :search-filtered="isSearchFiltered"
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
        @clear-visibility-filter="clearVisibilityFilter"
      />
      <div
        class="flex h-6 shrink-0 select-none items-center justify-between gap-2 border-t border-muted px-3 text-2xs text-muted"
        :class="ui.glassUiEnabled ? 'ferry-glass-chrome' : 'bg-muted/30'"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate tabular-nums">{{ paneSummary }}</span>
          <button
            v-if="isVisibilityFiltered"
            type="button"
            class="shrink-0 rounded-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            @click="clearVisibilityFilter"
          >
            Clear filters
          </button>
          <button
            v-if="filterText"
            type="button"
            class="shrink-0 rounded-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            @click="filterText = ''"
          >
            Clear search
          </button>
          <button
            v-if="!ui.showHidden"
            type="button"
            class="shrink-0 rounded-xs text-muted hover:text-default hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            @click="ui.toggleShowHidden()"
          >
            Hidden off
          </button>
        </div>
        <div v-if="selectionSummary" class="flex shrink-0 items-center gap-1.5">
          <span class="font-medium text-default tabular-nums">{{ selectionSummary }}</span>
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
      <TransferConflictDialog
        :conflicts="transferConflict?.conflicts ?? []"
        @dismiss="dismissTransferConflict"
        @resolve="resolveTransferConflict"
      />
    </template>
  </div>
</template>

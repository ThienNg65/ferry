# Ferry — 5 post-MVP UX features

## Context

Ferry's MVP (SFTP client, live log tail, remote unzip) shipped and was committed (`5aa908b`). The user has since gathered feedback and wants five specific gaps closed:

1. Hide the Local pane (it's currently always shown, even when only remote browsing matters).
2. Saved-site management (add/update/delete, name defaults to hostname, one-click reconnect) — the backend (`SiteStore`, `sites:*` IPC, `SessionManager.openFromSite`) was already built in the MVP but never wired to any UI; only quick-connect exists today.
3. Double-click a file to preview its content in a dialog (download instead if not previewable); a tail-icon affordance for log files, on top of the existing per-row hover tail icon.
4. Downloads should default into the OS Downloads folder (today they land in whatever the local pane happens to be browsing), plus toast notifications for notable async outcomes — the app has zero toast/notification usage today.
5. Custom-drawn minimize/maximize/close buttons matching the app's own design, replacing the OS-drawn `titleBarOverlay` caption buttons (Vue has no styling control over those beyond color).

All five were scoped via direct reads of the current source (`src/shared/contract.ts`, `SiteStore.ts`, `SessionManager.ts`, `FilePane.vue`, `FileRow.vue`, `TransferQueue.ts`, `TitleBar.vue`, `main/index.ts`, the Pinia stores) plus a design pass. Decisions below are final — no options left open.

**User-confirmed decisions:**
- Log-file detection (shows tail affordance): extension `.log` or `.txt`.
- Preview eligibility: extension allowlist only (no binary sniffing) — `.txt .log .conf .cfg .json .yml .yaml .ini .md`.
- Saved sites may optionally store the password/passphrase, matching `SiteStore`'s existing `hasPassword`/`hasPassphrase` design.
- Titlebar: fully custom (`frame`-less-style) buttons wired to new IPC, not just further theming of the OS overlay.
- Hide-local-pane state persists across restarts (localStorage).

**Conventions to keep matching:** contract-first IPC (`shared/contract.ts` first, always), one `ipc/*.ipc.ts` handler per domain via the existing `handle()` envelope wrapper (`main/ipc/envelope.ts`), singleton `getInstance()` services in main, **options-API Pinia stores** (`defineStore(id, { state, actions, getters })` — every existing store uses this form, e.g. `sessions.store.ts`, `localFs.store.ts`; do not introduce setup-style stores), module-scoped plain helper functions above `defineStore(...)` for pure logic (mirrors `sortEntries` in `localFs.store.ts`/`remoteFs.store.ts`), `@nuxt/ui` components/composables are globally auto-imported (confirmed via `@nuxt/ui/vite` in `electron.vite.config.ts` + `auto-imports.d.ts` — `useToast`, `UModal`, etc. need no import statement), Lucide icons work anywhere via `i-lucide-*` names (already fully pre-registered, no static-analysis restriction).

---

## Feature 1 — Hide Local pane

**New file:** `src/renderer/src/stores/ui.store.ts` (options-API store):
```ts
const STORAGE_KEY = 'ferry:ui:showLocalPane'

export const useUiStore = defineStore('ui', {
  state: () => ({
    showLocalPane: localStorage.getItem(STORAGE_KEY) !== 'false'
  }),
  actions: {
    toggleLocalPane(): void {
      this.showLocalPane = !this.showLocalPane
      localStorage.setItem(STORAGE_KEY, String(this.showLocalPane))
    }
  }
})
```

**Modify `src/renderer/src/App.vue`:** add a `UButton` (icon `i-lucide-panel-left-close` / `i-lucide-panel-left-open` depending on state) in the connected-session header row next to the existing Disconnect button; wrap `<FilePane side="local" .../>` in `v-if="ui.showLocalPane"` (use `v-if`, not `v-show` — matches the file's existing `v-if="!isConnected"` pattern, and cleanly unmounts Feature 3's preview dialog living inside that pane instance when hidden, rather than leaving it alive off-screen). Remote pane's existing `flex-1` fills the row automatically when local unmounts.

---

## Feature 2 — Saved-site management (renderer-only)

Confirmed: `SiteStore.list/create/update/delete`, `sites.ipc.ts`, and `SessionManager.openFromSite`/`session.ipc.ts`'s `{siteId}` branch **all already work**. Zero `contract.ts` or main-process changes for this feature — it's entirely new renderer code.

**Exact existing IPC call shapes to match** (checked directly in `sites.ipc.ts`):
- `sitesList`: `invoke(INVOKE_CHANNELS.sitesList)` — no args.
- `sitesCreate`: `invoke(INVOKE_CHANNELS.sitesCreate, input)` — one arg.
- `sitesUpdate`: `invoke(INVOKE_CHANNELS.sitesUpdate, id, input)` — **two positional args**, not an object.
- `sitesDelete`: `invoke(INVOKE_CHANNELS.sitesDelete, id)` — **raw id**, not `{id}`.

**New file:** `src/renderer/src/stores/sites.store.ts`:
```ts
function withNameFallback(input: SiteInput): SiteInput {
  const name = input.name.trim()
  return name ? input : { ...input, name: input.host }
}

export const useSitesStore = defineStore('sites', {
  state: () => ({ sites: [] as Site[], loading: false }),
  actions: {
    async fetchSites(): Promise<void> {
      this.loading = true
      try { this.sites = await invoke<Site[]>(INVOKE_CHANNELS.sitesList) }
      finally { this.loading = false }
    },
    async createSite(input: SiteInput): Promise<void> {
      await invoke<Site>(INVOKE_CHANNELS.sitesCreate, withNameFallback(input))
      await this.fetchSites()
    },
    async updateSite(id: string, input: SiteInput): Promise<void> {
      await invoke<Site>(INVOKE_CHANNELS.sitesUpdate, id, withNameFallback(input))
      await this.fetchSites()
    },
    async deleteSite(id: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.sitesDelete, id)
      this.sites = this.sites.filter((s) => s.id !== id)
    }
  }
})
```
Hostname-fallback logic lives in exactly this one place (client-side, immediately before the IPC call) — `SiteStore` in main stays a pure passthrough, matching its existing thin-handler design; no second source of truth for the rule.

**Modify `src/renderer/src/stores/sessions.store.ts`:** add `pendingLabel: string | null` to state, and a shared `openSession` action so both quick-connect and site-connect get identical handling:
```ts
async openSession(request: { siteId: string } | { quickConnect: QuickConnectInput }, label: string): Promise<void> {
  this.ensureStatusSubscription()
  this.connecting = true
  this.statusMessage = null
  this.pendingLabel = label
  try {
    const result = await invoke<SessionOpenResult>(INVOKE_CHANNELS.sessionOpen, request)
    this.activeSessionId = result.sessionId
    this.status = result.status
    useNotify().success(`Connected to ${label}`)
  } catch (e) {
    this.status = 'error'
    this.statusMessage = e instanceof Error ? e.message : String(e)
    useNotify().error('Connection failed', this.statusMessage)
    throw e
  } finally {
    this.connecting = false
  }
},
async connect(input: QuickConnectInput): Promise<void> {
  await this.openSession({ quickConnect: input }, input.name || input.host)
},
async connectToSite(site: Site): Promise<void> {
  await this.openSession({ siteId: site.id }, site.name)
}
```
Toast is placed directly in this try/catch — **not** in the `sessionStatus` event subscription. Verified in `SessionManager.connect()`: the async function fully awaits the SSH `ready`/`error` event and only returns (or throws) after that resolves, so `sessionOpen`'s invoke never resolves in an intermediate `'connecting'` state — resolve = definitely connected, throw = definitely failed. This makes the try/catch the correct, race-free place for the toast (no need to correlate against the event's `sessionId`, which wouldn't even match yet since `activeSessionId` isn't set until after this same promise resolves). Leave the *existing* `ensureStatusSubscription`'s event handler as-is for its real purpose (reacting to a later unexpected disconnect on an already-active session) — optionally add `useNotify().error('Connection lost', ...)` there too when `evt.status === 'error'`, since that's a distinct, non-user-initiated event worth surfacing.

**New file:** `src/renderer/src/components/sessions/SiteFormDialog.vue` — first `UModal` in the app. Props `open: boolean` (v-model), `site?: Site` (undefined = create mode); emits `update:open`. Fields: name (placeholder "Defaults to hostname"), host, port, username, authMethod (`URadioGroup`: password/privateKey), then password or (privateKeyPath + browse button reusing the existing `dialogPickFile` channel + passphrase), remoteInitialPath, localInitialPath. In edit mode, password/passphrase inputs start blank with placeholder "Leave blank to keep current password" when `site.hasPassword`/`hasPassphrase` is true — this matches `SiteStore.update`'s existing "undefined ⇒ unchanged" semantics exactly, so the dialog only sends a `password` field when the user typed something new. Submit calls `sites.createSite`/`updateSite`, closes on success.

**Rework `src/renderer/src/components/sessions/SessionManagerView.vue`:** header with "Add Site" button opening `SiteFormDialog` in create mode; list of `sites.sites` (`fetchSites()` on mount) — each row shows `i-lucide-server`, `site.name`, subtitle `${username}@${host}:${port}`, and Connect / Edit / Delete actions. Delete uses a small inline confirm `UModal` (establish the `v-model:open` + header/body/footer-slot convention here — Feature 3 reuses it verbatim, no separate base component needed). Existing quick-connect `UCard` form is kept exactly as-is, relocated below the list.

**Decision — `UModal` over `USlideover`:** this is a bounded ~8-field CRUD form, which is the standard modal use case; slideovers suit contextual drill-down panels, which this isn't.

---

## Feature 3 — Double-click file preview / tail dialog

**`src/shared/contract.ts` additions:**
```ts
// INVOKE_CHANNELS
fsLocalReadFile: 'fs:local:readFile',
fsRemoteReadFile: 'fs:remote:readFile',

// types
export interface FileReadResult {
  path: string
  content: string
  truncated: boolean
  size: number
}
```
(No new event channel needed — this is request/response only.)

**Main process — new function on each fs service, capped at 1 MiB (`MAX_TEXT_PREVIEW_BYTES = 1_048_576`, a local const in each service file):**
- `src/main/fs/LocalFsService.ts` — add `readFileText(path: string): Promise<FileReadResult>` using `fs.promises.open` + partial `read()` up to the cap (mirrors this file's existing `fs.promises`-based style).
- `src/main/ssh/RemoteShell.ts` — add `readFile(remotePath: string, maxBytes: number): Promise<{content: string; truncated: boolean; size: number}>` using `this.stat()` (already exists) + `sftp.createReadStream(remotePath, {start: 0, end: length - 1})` (the exact same `sftp.createReadStream` API `TransferQueue.ts` already calls, just with a byte range) and buffering into a `Buffer.concat`.
- `src/main/fs/RemoteFsService.ts` — add `readFile(sessionId: string, path: string): Promise<FileReadResult>`, resolving the shell via `SessionManager.getInstance().shell(sessionId)` exactly like `listRemote`/`mkdirRemote` etc. already do, calling `shell.readFile(path, MAX_TEXT_PREVIEW_BYTES)`.
- `src/main/ipc/fs.ipc.ts` — register `fsLocalReadFile`/`fsRemoteReadFile` via the existing `handle()` wrapper, following the exact pattern already used for `fsLocalList`/`fsRemoteList` in this same file.

No "reject if too large" path is needed: the extension allowlist (client-side, below) already prevents attempting a read on anything not on the text list, and the byte cap plus `truncated` flag safely handles a huge `.log` file.

**New file:** `src/renderer/src/utils/fileTypes.ts` — mirrors `FileRow.vue`'s existing `isZip` regex-check style:
```ts
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'conf', 'cfg', 'json', 'yml', 'yaml', 'ini', 'md'])
const LOG_EXTENSIONS = new Set(['log', 'txt'])

function ext(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase()
}
export function isTextPreviewable(name: string): boolean {
  return TEXT_EXTENSIONS.has(ext(name))
}
export function isLogFile(name: string): boolean {
  return LOG_EXTENSIONS.has(ext(name))
}
```

**New file:** `src/renderer/src/components/files/FilePreviewDialog.vue` — props `open: boolean` (v-model), `entry: FileEntry | null`, `side: 'local' | 'remote'`; emits `update:open`, `tail`, `download`. Internally uses `useSessionsStore()` directly for `activeSessionId` (consistent with how every other component in the app already reaches Pinia state — no prop-drilling needed). On open, if `!isTextPreviewable(entry.name)`: show "Preview not available for this file type" plus a Download button (emits `download`). If previewable: invoke `fsLocalReadFile`/`fsRemoteReadFile` per `side`, show a loading state, then render `result.content` in `<pre class="overflow-auto whitespace-pre-wrap font-mono text-xs">`, with a truncated-file banner when `result.truncated`. Header: filename + (when `isLogFile(entry.name)`) a tail icon button (`i-lucide-scroll-text`) emitting `tail`.

**Modify `src/renderer/src/components/files/FilePane.vue`:** `onOpen(entry)` currently does nothing for files (`if (entry.isDir) void store.openDir(entry.path)`). Change to open the dialog for files:
```ts
function onOpen(entry: FileEntry): void {
  if (entry.isDir) {
    void store.openDir(entry.path)
    return
  }
  previewEntry.value = entry
  previewOpen.value = true
}
```
Add `<FilePreviewDialog v-model:open="previewOpen" :entry="previewEntry" :side="props.side" @tail="onTail" @download="onTransfer" />` — `onTail` and `onTransfer` are this component's **existing** handlers (`onTail` already calls `tailStreams.open(sessionId, entry.path)`; `onTransfer` already calls `transferEntry`), so the dialog triggers the identical code path as the current per-row hover icons — no duplicated tail/download logic. One dialog instance per `FilePane` (local and remote each get their own), since each pane already has direct access to the right read channel and, for remote, the session id.

**Decision — keep both the row's hover tail icon and the dialog's tail button.** The row icon serves rapid multi-file tailing without opening a dialog per file; the dialog button serves discoverability via double-click. Removing either regresses a real workflow for no gain.

---

## Feature 4 — Downloads-folder default + toast system

**`src/shared/contract.ts` additions:**
```ts
// INVOKE_CHANNELS
systemGetDownloadsPath: 'system:getDownloadsPath',

// types
export interface DownloadsPathResult { path: string }
```

**New file:** `src/main/ipc/system.ipc.ts` (new domain — kept separate from `dialog.ipc.ts`, which is purely `showOpenDialog`-backed; this is an OS-path getter, not a dialog):
```ts
export function registerSystemHandlers(): void {
  handle<DownloadsPathResult>(INVOKE_CHANNELS.systemGetDownloadsPath, () => ({
    path: app.getPath('downloads')
  }))
}
```
Wire into `registerAllHandlers()` in `src/main/index.ts`.

**Modify `src/renderer/src/components/files/FilePane.vue`:** in `transferEntry`, the download branch currently builds `localTarget` from `localFs.currentPath` (wherever the local pane happens to be browsing). Change it to always target the Downloads folder:
```ts
} else {
  const { path: downloadsDir } = await invoke<DownloadsPathResult>(INVOKE_CHANNELS.systemGetDownloadsPath)
  const sep = downloadsDir.includes('\\') ? '\\' : '/'
  const localTarget = `${downloadsDir}${sep}${entry.name}`
  await transfers.enqueue(sessionId, 'download', localTarget, entry.path)
}
```
Upload branch (source is local pane's current path) is untouched. This matches the user's literal feedback exactly — no per-download destination picker; that would add friction nobody asked for and can be a later opt-in if wanted.

### Toast infrastructure

**Modify `src/renderer/src/App.vue`:** add a toaster region to the existing `<UApp>` wrapper: `<UApp :toaster="{ position: 'bottom-right', duration: 4000 }">`.

**New file:** `src/renderer/src/composables/useNotify.ts`:
```ts
export function useNotify() {
  const toast = useToast()
  return {
    success(title: string, description?: string) {
      toast.add({ title, description, color: 'success', icon: 'i-lucide-check-circle' })
    },
    error(title: string, description?: string) {
      toast.add({ title, description, color: 'error', icon: 'i-lucide-alert-circle' })
    }
  }
}
```

**Toast trigger set (deliberately minimal — not every `ActivityLog` event):**
- **Transfers** — hook once in `src/renderer/src/stores/transferQueue.store.ts`'s existing `transferEvent` subscription: on `state === 'done'`, success toast naming the file (basename of `remotePath`); on `state === 'error'`, error toast with `evt.error`. `progress` is never toasted; `cancelled` is user-initiated and already visible in the dock, so it's skipped.
- **Connect** — success/error toast wired directly in `sessions.store.ts`'s `openSession` (see Feature 2 above).
- **Extract** — the exact call site is `FilePane.vue`'s `onExtract` (`invoke(INVOKE_CHANNELS.unzipRun, ...)` wrapped in try/catch that currently only sets `remoteFs.error`); add `useNotify().success(...)`/`.error(...)` there.
- **Not toasted:** disconnect (deliberate action, immediate obvious UI feedback), any plain fs op (rename/delete/mkdir — the file list already visibly refreshes), site CRUD (list updates in place). Toasting everything would be exactly the noise the user's feedback was pushing back against.

---

## Feature 5 — Custom titlebar buttons

**Decision:** drop `titleBarOverlay` entirely; keep `titleBarStyle: 'hidden'` alone (don't also add `frame: false` — mixing both isn't the documented pattern and is redundant). On Windows, `titleBarOverlay` always draws real OS caption buttons in that region with no way to hide just the buttons while keeping the overlay — confirmed via Electron docs semantics and this file's own comment explaining why the overlay was added in the first place. `titleBarStyle: 'hidden'` alone is the standard fully-custom-titlebar recipe: zero native chrome, full renderer control.

**`src/shared/contract.ts` additions:**
```ts
// INVOKE_CHANNELS
windowMinimize: 'window:minimize',
windowMaximizeToggle: 'window:maximizeToggle',
windowClose: 'window:close',
windowIsMaximized: 'window:isMaximized',

// EVENT_CHANNELS
windowStateChange: 'window:state-change',

// types
export interface WindowStateEvent { isMaximized: boolean }
export interface WindowIsMaximizedResult { isMaximized: boolean }
```
One `windowMaximizeToggle` channel, not separate maximize/unmaximize ones — main just flips based on `win.isMaximized()`.

**New file:** `src/main/ipc/window.ipc.ts`, taking the main window via a getter (since `main/index.ts` currently only holds `win` in a local variable inside `createWindow()` — promote it to a module-level `let mainWindow: BrowserWindow | null` so both this handler file and the maximize/unmaximize listeners can reach it):
```ts
export function registerWindowHandlers(getMainWindow: () => BrowserWindow | null): void {
  handle<void>(INVOKE_CHANNELS.windowMinimize, () => { getMainWindow()?.minimize() })
  handle<void>(INVOKE_CHANNELS.windowMaximizeToggle, () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  handle<void>(INVOKE_CHANNELS.windowClose, () => { getMainWindow()?.close() })
  handle<WindowIsMaximizedResult>(INVOKE_CHANNELS.windowIsMaximized, () => ({
    isMaximized: getMainWindow()?.isMaximized() ?? false
  }))
}
```

**Modify `src/main/index.ts`:** remove the `titleBarOverlay` key from the `BrowserWindow` constructor; store the created window in a module-level `mainWindow` variable; register `registerWindowHandlers(() => mainWindow)` in `registerAllHandlers()`; add `mainWindow.on('maximize', ...)`/`on('unmaximize', ...)` that broadcast `EVENT_CHANNELS.windowStateChange` to all windows (same broadcast style already used by `ActivityLog`/`TransferQueue`/`SessionManager`).

**Rewrite `src/renderer/src/components/shell/TitleBar.vue`:** fetch initial `isMaximized` via `windowIsMaximized` on mount, subscribe to `windowStateChange`, and render three plain `<button>` elements (not `UButton` — its default rounded/padded pill styling doesn't match the flush, full-height, 44px-wide Windows caption-button convention with square hover targets and a red hover on close; forcing `UButton` would need heavy prop overrides for no benefit) wired to `windowMinimize`/`windowMaximizeToggle`/`windowClose`, using `i-lucide-minus`, `i-lucide-square`/`i-lucide-copy` (toggling by `isMaximized`), and `i-lucide-x`. The whole titlebar is currently one undivided `-webkit-app-region: drag` div — carve out just the new button group with `-webkit-app-region: no-drag` (the one required structural change; the "Ferry" label stays draggable).

---

## Cross-feature notes

- Features 2 and 3 are the app's only two `UModal` consumers — the convention (`v-model:open`, header/body/footer slots) is established once in Feature 2 and copied verbatim in Feature 3.
- Feature 4's toast infrastructure is consumed by Feature 2 (connect toasts) — build Feature 4 before Feature 2.
- Feature 1 and Feature 3 interact structurally only: the local pane's `FilePreviewDialog` instance unmounts along with `v-if="ui.showLocalPane"`, no extra handling needed.
- `App.vue` is touched by Features 1 and 4 (toggle button, `<UApp :toaster>`) — do them adjacently to avoid repeated churn on the same file.
- `contract.ts` is touched by Features 3, 4, 5 (not 2, which is renderer-only) — no channel-name collisions, each uses a distinct prefix (`fs:*`, `system:*`, `window:*`).

**Suggested build order:** 1 (hide-local, trivial warm-up) → 4 (Downloads path + toast infra, foundational) → 2 (saved sites, consumes toast) → 3 (preview dialog, reuses the modal convention from 2) → 5 (titlebar, fully independent, highest regression risk to basic window controls — validate it in isolation last).

---

## Verification

- `npm run typecheck` and `npm run build` after each feature (both must stay clean, per existing project convention).
- `npm run dev` and manually exercise each feature against a real SFTP server (the same live-testing approach used for the MVP):
  - Toggle Local pane hidden/shown; restart the app and confirm the choice persisted.
  - Create a saved site with a blank name (confirm it falls back to hostname), connect via one click, edit it (confirm leaving password blank preserves the old one), delete it with confirmation.
  - Double-click a `.txt`/`.log`/`.json` file → dialog shows content; double-click a binary/unlisted-extension file → dialog offers Download instead; on a `.log` file, use the dialog's tail button and confirm it opens the same Log Tail dock tab as the row's hover icon.
  - Download a file and confirm it lands in the real Windows Downloads folder (not wherever the local pane was browsing) and a success toast appears; force a failure (e.g. cancel mid-transfer or disconnect) and confirm an error toast appears without spamming progress toasts.
  - Click custom minimize/maximize/close buttons; confirm the maximize icon flips to "restore" when maximized (including via double-clicking the title bar or dragging to a screen edge, which bypasses the button itself), and that dragging by the "Ferry" label still works.

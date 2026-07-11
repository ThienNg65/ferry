# Ferry — Project Map

## What this is

Ferry is a lightweight WinSCP alternative: an Electron + Vue 3 desktop app for SFTP file transfer with a dual-pane browser, a transfer queue, and — its main differentiators — a genuinely live remote log tail (`tail -F` over SSH), a remote "Extract Here" unzip action, browser-like site tabs (multiple concurrent SSH sessions, switchable instantly), and an interactive SSH Terminal per site, all wrapped in a minimal Apple-HIG-inspired UI built on `@nuxt/ui` v4. SFTP/SSH only (no FTP/FTPS/SCP). Single-window, no `vue-router` — view (and tab) switching is plain reactive state.

## Tech stack

- Electron 30.5.1, electron-vite 2.x (build tool), electron-builder 24.x (packaging, NSIS)
- Vue 3.5 (Composition API, `<script setup>`), Pinia 2.1, TypeScript 5.4 (strict)
- `@nuxt/ui` 4.9.0 (installed from npm, NOT from the local source clone at `C:\toys\ui`) + Tailwind CSS v4 (`@tailwindcss/vite`)
- `ssh2` 1.16 (direct — not `ssh2-sftp-client`, since raw exec channels are needed for tail/unzip alongside SFTP, and `client.shell()` for the interactive Terminal's PTY)
- `@xterm/xterm` 5.5 + `@xterm/addon-fit` 0.10 (renderer-side terminal emulator for the Terminal dock tab)
- `electron-store` (saved sites, plain JSON) + Electron's `safeStorage` (DPAPI-backed credential encryption — no `keytar`)
- `@iconify/vue` + `@iconify-json/lucide` (full icon set pre-registered at startup — see Gotchas)
- Node v22.14.0. npm installs on this machine need `--registry=https://registry.npmjs.org` explicitly.

## Directory structure

```
src/
  main/           Electron main process (Node context)
    ssh/          SessionManager (connection pool), RemoteShell (exec/execLines/sftp wrapper), errors, retry
    fs/           LocalFsService, RemoteFsService — thin functional wrappers, not classes
    transfer/     TransferQueue — bounded-concurrency upload/download over SFTP streams
    tail/         TailManager — tail -F multiplexer with PID-capture kill + reconnect + idle reaper
    terminal/     TerminalManager — one interactive SSH shell (PTY, via RemoteShell.openShell) per terminalId, mirrors TailManager's shape but with no auto-reconnect
    unzip/        UnzipService — remote `unzip -qo` via SSH exec
    activity/     ActivityLog — in-process event bus + ring buffer (app's own activity feed)
    sites/        SiteStore — saved connections (electron-store) + safeStorage-encrypted secrets
    ipc/          One *.ipc.ts per domain, each exposing `registerXHandlers()`; envelope.ts has the typed `handle()` wrapper
    index.ts      App bootstrap: BrowserWindow (hardened), registers all IPC handlers
  preload/        contextBridge whitelist (invoke/on/off), derived from shared/contract.ts — the ONLY renderer↔main bridge
  shared/
    contract.ts   Single source of truth: INVOKE_CHANNELS, EVENT_CHANNELS, every payload type. Both preload and main import from here.
  renderer/
    index.html, src/main.ts (mounts app, registers Lucide icons)
    src/App.vue                    Root: TitleBar + SiteTabBar + (SessionManagerView | dual FilePane + BottomDock) for the active tab, hosts <UApp :toaster>
    src/components/
      shell/      TitleBar (fully custom minimize/maximize/close buttons — see Conventions), SiteTabBar (browser-like open-site tab chips: label/spinner/error, close, +new), BottomDock (tab shell for Transfers/Log Tail/Terminal/Activity)
      sessions/   SessionManagerView (saved-sites list + quick-connect form — always renders for whichever tab is in "picker" state), SiteFormDialog (UModal, add/edit a saved site)
      files/      FilePane (also owns the Local-pane collapse-to-rail toggle — see Conventions), FileList, FileRow, FileToolbar, PathBreadcrumb, FilePreviewDialog (UModal, double-click file preview + tail shortcut)
      terminal/   TerminalView — thin host that attaches/shows per-session xterm.js instances live in terminalStreams.store.ts (see Conventions); never owns a Terminal itself
      transfers/  TransferQueue, TransferItem
      logs/       LogTailViewer, ActivityLog
    src/stores/     One Pinia store per domain: sessions (SessionTab[] — browser-like open-site tabs, all connected concurrently), sites, localFs (global, session-agnostic), remoteFs (per-session keyed — see Conventions), transferQueue, tailStreams, terminalStreams (per-session xterm.js instance cache), activityLog, ui (layout prefs, e.g. hide-local-pane, persisted to localStorage)
    src/composables/ useLogTail (rAF-batched line buffering), useDragAndDrop (module-scoped shared drag payload), useNotify (thin wrapper over @nuxt/ui's useToast — see Conventions)
    src/utils/      fileTypes.ts — text-preview/log-file extension allowlists (mirrors FileRow.vue's isZip-style regex/Set checks)
    src/api.ts      invoke()/onEvent() wrappers — unwraps the IpcResult envelope, JSON-round-trips args to strip Vue proxies
.claude/
  architecture/   Full design docs (backend + frontend) written before implementation
  plan/           Approved implementation plans (ferry-implementation-plan.md = MVP, ferry-feature-round2-plan.md = round-2 UX features, ferry-feature-round3-plan.md = site tabs/Terminal/named sessions/collapsible Local rail)
resources/        Icons for electron-builder (currently empty — no custom icon yet, see Gotchas)
```

## Entry points & key config

- `src/main/index.ts` — main process bootstrap, `createWindow()`, `registerAllHandlers()`
- `src/renderer/src/main.ts` — renderer bootstrap; **registers the full Lucide icon set here** (`addCollection`)
- `src/shared/contract.ts` — change this FIRST when adding any new IPC channel; preload/main won't compile otherwise
- `electron.vite.config.ts` — main/preload/renderer build config, path aliases (`@`, `@renderer`, `@shared`)
- `electron-builder.yml` — packaging config. **Must be named exactly this** (see Gotchas)
- `tsconfig.node.json` / `tsconfig.web.json` — split TS project references (main+preload+shared vs. renderer+shared)

## How the pieces talk to each other

- Renderer → main: `window.api.invoke(channel, ...args)` → preload validates channel against `INVOKE_CHANNELS`/`EVENT_CHANNELS` whitelist → `ipcMain.handle` (registered via `handle()` in `ipc/envelope.ts`) → always resolves `{ok:true,data}` or `{ok:false,code,message}`. Renderer's `api.ts` `invoke()` unwraps this and throws on `ok:false`.
- Main → renderer: `webContents.send(EVENT_CHANNELS.x, payload)` broadcast to all windows; renderer subscribes via `window.api.on(channel, cb)` (`onEvent()` wrapper).
- All SSH operations for a connection go through one `RemoteShell` instance (wraps a single `ssh2.Client`), owned by `SessionManager`, keyed by a renderer-issued `sessionId` (UUID) — NOT tied to a saved site id, so the same site can have multiple concurrent sessions (e.g. browsing + a tail), and the renderer's site-tabs feature keeps one `sessionId` alive per open tab.
- `TailManager`, `TerminalManager`, and `TransferQueue` are separate singletons that look up the `RemoteShell` for a given `sessionId` via `SessionManager.getInstance().shell(sessionId)` — they don't own connections themselves. `SessionManager.close(sessionId)` calls `stopAllForSession`/`closeAllForSession` on both `TailManager` and `TerminalManager` before ending the client — add the same hook here for any future per-session subsystem.
- `ActivityLog` is fire-and-forget: any main-process service calls `ActivityLog.getInstance().emit(...)`, which broadcasts immediately — never gated on the operation it's describing.

## Build / run / test

```bash
npm install --registry=https://registry.npmjs.org   # always pass --registry explicitly on this machine
npm run dev            # electron-vite dev (hot reload)
npm run typecheck       # vue-tsc + tsc, no emit — run this before every build
npm run build           # electron-vite build → out/
npm run package         # build + electron-builder → dist/*.exe (NSIS installer) + dist/win-unpacked/
```

No test suite exists yet (vitest is a devDependency but no test files have been written).

## Conventions

- **IPC contract-first**: every new feature starts by adding channels/types to `src/shared/contract.ts`, then an `ipc/*.ipc.ts` handler file with `registerXHandlers()`, then wire it into `registerAllHandlers()` in `main/index.ts`.
- **fs/ services are plain exported functions, not classes** (stateless) — unlike `SessionManager`/`SiteStore`/`ActivityLog`/`TailManager`/`TransferQueue`, which ARE singletons (`getInstance()`) because they hold state.
- **Secrets never cross the IPC boundary decrypted.** `SiteStore` only returns `hasPassword`/`hasPassphrase` booleans to the renderer; decryption happens main-process-side, in-memory, at connect time only.
- **No silent auto-reconnect for browsing sessions** (stale listings/in-flight transfers would be unsafe) — only `TailManager` auto-reconnects, since re-tailing is safe.
- **Icons**: use `i-lucide-*` names anywhere (`UIcon`, `icon` props, even computed/dynamic bindings) — all Lucide icons are pre-registered offline, no need to worry about static-analysis detection.
- Drag-and-drop between panes uses a module-scoped Vue `ref` (`useDragAndDrop.ts`) as shared state, not `dataTransfer` JSON — same-window drag only.
- **Dialogs use `UModal`** (`v-model:open` or `:open` + `@update:open`, `#body`/`#footer="{ close }"` slots): `SiteFormDialog.vue`, `FilePreviewDialog.vue`, and the inline delete-confirm modal in `SessionManagerView.vue`. `UModal` also has an `#actions` slot rendered next to its built-in close button — used by `FilePreviewDialog.vue` for the tail-shortcut button instead of a fully custom `#header`. `USlideover` is reserved for contextual drill-down panels, not bounded CRUD forms — not used anywhere yet.
- **Toasts**: call `useNotify()` (`src/composables/useNotify.ts`), never `useToast()` directly — keeps styling (`color`, `icon`) consistent across call sites. Toast only on outcomes the user didn't just get obvious visual feedback for (transfer done/error, extract done/error, connect success/error, unexpected disconnect) — deliberately NOT on every fs op, site CRUD, or user-initiated disconnect; those already have an immediate visible UI change and toasting them would be noise.
- **Window chrome is fully custom** — `titleBarStyle: 'hidden'` alone (no `titleBarOverlay`, no `frame: false`), real Vue `<button>`s in `TitleBar.vue` wired to `window:minimize`/`window:maximizeToggle`/`window:close`/`window:isMaximized` IPC + a `window:state-change` broadcast event. Plain `<button>`, not `UButton`, for these three — `UButton`'s rounded/padded default styling doesn't match the flush, 44px-wide, square-hover-target Windows caption-button convention.
- **`main/index.ts` keeps a module-level `mainWindow` reference** (not just a local inside `createWindow()`) so IPC handlers (`window.ipc.ts`) and window event listeners (`maximize`/`unmaximize` → broadcast) can both reach the single app window.
- **Site tabs are a renderer-only concept.** `sessions.store.ts`'s state is `SessionTab[]` (`tabId`, `sessionId | null` while in "picker" state, `label`, `status`, `statusMessage`, `connecting`) + `activeTabId`; there is always ≥1 tab (closing the last one opens a fresh picker tab rather than leaving zero). `activeTab`/`activeSessionId`/`status`/`statusMessage`/`connecting` are **getters** that resolve from the active tab — this keeps `App.vue`/`FilePane.vue`/`SessionManagerView.vue` reading the exact same flat names they always did, with zero template changes. If you add a new such getter, never let anything assign to it directly (getters can't be assigned) — route mutations through an action that finds the specific tab object and mutates it (`tab.status = ...`), never `this.status`.
- **`remoteFs.store.ts` is keyed by `sessionId`** (`bySession: Record<string, PerSessionFs>`) so each open site tab keeps its own independent `currentPath`/`entries`/`selected`/etc., but exposes the identical flat `currentPath`/`entries`/`loading`/`error`/`selected` getter surface as before (resolved via a `current` getter reading the active session's bucket, falling back to a frozen `EMPTY_DEFAULT` when no bucket exists yet) — `FilePane.vue` needed no template changes for this either. Lazy-create a session's bucket only inside actions (e.g. `ensureBucket()` at the top of `load()`), never inside a getter (Pinia/Vue getters must stay pure — no side effects). There's a real (intentional, safe) circular import between `sessions.store.ts` and `remoteFs.store.ts`/`terminalStreams.store.ts` (each calls the other's `useXStore()` inside action bodies, never at module-eval time) — this is a standard, working ESM circular-import pattern for cross-referencing Pinia stores; don't "fix" it by breaking the reference apart.
- **Live xterm.js `Terminal` instances live in a plain module-scoped `Map` inside `terminalStreams.store.ts`, deliberately OUTSIDE Pinia's reactive state**, keyed by `sessionId` (one terminal per session). A single `terminal:data` IPC subscription (set up once, lazily) routes each chunk to the right cached instance — components never subscribe individually. `TerminalView.vue` only ever attaches/shows the DOM (`term.open(el)` exactly once ever per instance, guarded by a local `Set`); it never constructs or disposes a `Terminal` itself. This is the pattern to follow for any future feature that needs a stateful, non-serializable client object (a socket, a canvas context, a third-party widget) to survive across tab/dock-panel switching without being destroyed by Vue's `v-if`.
- **A dock tab that must survive `BottomDock.vue`'s own tab-switching (and its collapse toggle) uses `v-show`, not `v-if`/`v-else-if`.** Transfers/Log Tail/Activity are stateless-enough to freely remount (the existing `v-if`/`v-else-if` chain), but `TerminalView` sits in its own always-present sibling `<div v-show="!collapsed && tab === 'terminal'">` (mounted once, guarded by a `terminalEverShown` flag) specifically so switching dock tabs or collapsing the dock never tears down its live xterm instances.
- **Hiding the Local pane collapses it to a slim rail, it never fully unmounts.** `FilePane.vue` owns this itself (imports `ui.store.ts` directly) rather than `App.vue` conditionally rendering it — the toggle button lives in the pane's own header row (fixed `h-8` height on both sides so LOCAL/REMOTE headers always line up regardless of button/no-button), and the rest of the body is wrapped in `v-if="showBody"`. A `watch` on `ui.showLocalPane` closes any open preview dialog on collapse, since the dialog no longer unmounts for free.

## Gotchas that will waste your first hour

1. **`electron-builder.yml` must be named EXACTLY that** (or `electron-builder.ts`/`.json`/etc.) — NOT `electron-builder.config.ts`. electron-builder's config loader (`read-config-file`) only searches for `electron-builder.<ext>`; `*.config.ts` is silently ignored with no error, and you get default settings (`oneClick: true`, wrong product name, no asarUnpack). We hit this for real — see `.claude/plan/ferry-implementation-plan.md` history. Also: electron-builder's `.ts`-config loader (`config-file-ts`) has a Windows bug where absolute paths with a drive letter break its cache-directory naming — prefer `.yml` over `.ts` for this config on Windows regardless.
2. **Icons will silently 404/CSP-block unless the full Lucide set is registered.** `@nuxt/ui`'s icon component falls back to fetching unrecognized icon names from Iconify's public API at runtime — blocked by our CSP (`default-src 'self'`), and Vite's static icon-bundling can't detect dynamically-bound icon names (computed props, ternaries) anyway. Fix already applied in `main.ts`: `addCollection(lucideIcons)` before mount. If you add a different icon collection, register it the same way.
3. **`titleBarStyle: 'hidden'` alone removes ALL window chrome on Windows** — no close/minimize/maximize button, only Alt+F4 — and that's now intentional: `TitleBar.vue` draws its own buttons wired to `window:*` IPC (see Conventions). Do NOT re-add `titleBarOverlay` "to be safe" — it draws real OS caption buttons over the custom bar with no way to hide just the buttons while keeping the overlay, which is exactly what we removed it to avoid.
4. **`tsconfig.web.json`'s `include` must cover `src/renderer/auto-imports.d.ts`, not just `src/renderer/src/**/*`.** `unplugin-auto-import` (via `@nuxt/ui/vite`) writes global ambient declarations (`useToast`, `useOverlay`, etc.) to that file, one directory above the renderer source root. Component tags (`UButton`, `UModal`, ...) still resolve fine in `<template>` even without it, because Vue's template checker (`@vue/language-core`) discovers `components.d.ts`-style files through a separate mechanism — but a bare composable call in `<script setup>` (e.g. `useToast()`) goes through the real TS program and needs the ambient file in `include` to type-check. Hit this for real adding `useNotify.ts` — fixed by adding the path explicitly.
5. **No recursive directory transfer.** `TransferQueue` handles single files only; the transfer/tail/extract/preview icon buttons on `FileRow`/double-click are hidden or no-op for directories (`!entry.isDir`/`entry.isDir` branch). Dragging a folder onto the other pane silently does nothing (draggable is also gated on `!entry.isDir`).
6. **No app icon set** — `resources/` is empty and `electron-builder.yml`'s `icon:` key is commented out, so packaged builds use the default Electron icon.
7. `@toys\ui` (the local `@nuxt/ui` source clone) is NOT a dependency of this project and has no build output — it's reference material only (source browsing + the `nuxt-ui` skill). Never point tooling at it.
8. **File preview/download/tail affordances only apply to the remote pane, never local.** `FilePreviewDialog.vue`'s download and tail buttons are gated on `side === 'remote'` — downloading or tailing a file that's already on the local machine doesn't make sense, and `TailManager`/`tail:start` only ever operates over an SSH session. If you add a similar affordance elsewhere, gate it the same way (mirrors `FilePane.vue`'s pre-existing `showTail = side === 'remote' && connected` computed).
9. **Never call `xterm.js`'s `term.open()` more than once per `Terminal` instance.** Reparenting a live terminal onto a second element isn't a documented-safe operation, so `TerminalView.vue` guards it with a `Set` of already-attached session ids and relies on the container staying permanently in the DOM (`v-show`, see Conventions) instead. If a future refactor needs the container to actually unmount/remount, dispose the old `Terminal` and create a fresh one rather than re-opening it.
10. **Terminal output crosses IPC as raw `Uint8Array`, not a decoded string.** `TerminalManager` forwards each `stream.on('data', chunk: Buffer)` as `new Uint8Array(chunk)` rather than `chunk.toString()`, because a naive per-chunk UTF-8 decode can split a multi-byte character across two chunks and corrupt it; `xterm.js`'s `Terminal.write()` accepts `Uint8Array` directly so no decode step is needed in the renderer either. Keystrokes going the other way (`terminal:write`) are a plain string — that direction has no chunk-boundary problem.

## Where to go for X

| Task | Files |
|---|---|
| Add a new IPC channel | `shared/contract.ts` → new `ipc/*.ipc.ts` handler → `main/index.ts` `registerAllHandlers()` → renderer store/composable calling `invoke()`/`onEvent()` |
| Change SSH/SFTP behavior | `main/ssh/RemoteShell.ts` (low-level ops), `main/ssh/SessionManager.ts` (connection lifecycle) |
| Change saved-site management UI | `renderer/src/components/sessions/SessionManagerView.vue` (list), `SiteFormDialog.vue` (add/edit form), `renderer/src/stores/sites.store.ts` (hostname-fallback logic lives here) |
| Change the file preview dialog / text-preview or log-file extension lists | `renderer/src/components/files/FilePreviewDialog.vue`, `renderer/src/utils/fileTypes.ts` |
| Change the download default location | `main/ipc/system.ipc.ts` (`system:getDownloadsPath`), consumed in `renderer/src/components/files/FilePane.vue`'s `transferEntry` |
| Add/change a toast notification | `renderer/src/composables/useNotify.ts`; call sites today: `stores/transferQueue.store.ts`, `stores/sessions.store.ts`, `components/files/FilePane.vue`'s `onExtract` |
| Change window control behavior (minimize/maximize/close) | `main/ipc/window.ipc.ts`, `renderer/src/components/shell/TitleBar.vue` |
| Change the tail command / rotation handling | `main/tail/TailManager.ts` (`follow()` method, the `tail -F` command string) |
| Change transfer concurrency/progress throttling | `main/transfer/TransferQueue.ts` (`MAX_CONCURRENT`, `PROGRESS_THROTTLE_MS`) |
| Change visual theme/tokens | `renderer/src/assets/main.css` (`@theme` blocks, `--ui-*` CSS vars) |
| Add a new dock tab (beyond Transfers/Log Tail/Terminal/Activity) | `renderer/src/components/shell/BottomDock.vue` (`DockTab` union + button + template branch — use `v-show` instead of `v-if` if the tab holds state that must survive switching, see Conventions) |
| Change the site-tabs / multi-session model | `renderer/src/stores/sessions.store.ts` (`SessionTab[]`, back-compat getters, `openNewTab`/`setActiveTab`/`closeTab`), `renderer/src/stores/remoteFs.store.ts` (per-session `bySession` keying), `renderer/src/components/shell/SiteTabBar.vue` |
| Add/change the Terminal feature | `main/terminal/TerminalManager.ts`, `main/ssh/RemoteShell.ts` (`openShell`), `main/ipc/terminal.ipc.ts`, `renderer/src/stores/terminalStreams.store.ts` (xterm.js instance cache), `renderer/src/components/terminal/TerminalView.vue`, `renderer/src/components/shell/BottomDock.vue` |
| Packaging/installer settings | `electron-builder.yml` (see Gotcha #1 about the filename) |

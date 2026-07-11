# Ferry — Project Map

## What this is

Ferry is a lightweight WinSCP alternative: an Electron + Vue 3 desktop app for SFTP file transfer with a dual-pane browser, a transfer queue, and — its main differentiator — a genuinely live remote log tail (`tail -F` over SSH) plus a remote "Extract Here" unzip action, all wrapped in a minimal Apple-HIG-inspired UI built on `@nuxt/ui` v4. SFTP/SSH only (no FTP/FTPS/SCP). Single-window, no `vue-router` — view switching is plain reactive state.

## Tech stack

- Electron 30.5.1, electron-vite 2.x (build tool), electron-builder 24.x (packaging, NSIS)
- Vue 3.5 (Composition API, `<script setup>`), Pinia 2.1, TypeScript 5.4 (strict)
- `@nuxt/ui` 4.9.0 (installed from npm, NOT from the local source clone at `C:\toys\ui`) + Tailwind CSS v4 (`@tailwindcss/vite`)
- `ssh2` 1.16 (direct — not `ssh2-sftp-client`, since raw exec channels are needed for tail/unzip alongside SFTP)
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
    src/App.vue                    Root: TitleBar + (SessionManagerView | dual FilePane + BottomDock), hosts <UApp :toaster>
    src/components/
      shell/      TitleBar (fully custom minimize/maximize/close buttons — see Conventions), BottomDock (tab shell for Transfers/Log Tail/Activity)
      sessions/   SessionManagerView (saved-sites list + quick-connect form), SiteFormDialog (UModal, add/edit a saved site)
      files/      FilePane, FileList, FileRow, FileToolbar, PathBreadcrumb, FilePreviewDialog (UModal, double-click file preview + tail shortcut)
      transfers/  TransferQueue, TransferItem
      logs/       LogTailViewer, ActivityLog
    src/stores/     One Pinia store per domain: sessions, sites, localFs, remoteFs, transferQueue, tailStreams, activityLog, ui (layout prefs, e.g. hide-local-pane, persisted to localStorage)
    src/composables/ useLogTail (rAF-batched line buffering), useDragAndDrop (module-scoped shared drag payload), useNotify (thin wrapper over @nuxt/ui's useToast — see Conventions)
    src/utils/      fileTypes.ts — text-preview/log-file extension allowlists (mirrors FileRow.vue's isZip-style regex/Set checks)
    src/api.ts      invoke()/onEvent() wrappers — unwraps the IpcResult envelope, JSON-round-trips args to strip Vue proxies
.claude/
  architecture/   Full design docs (backend + frontend) written before implementation
  plan/           Approved implementation plans (ferry-implementation-plan.md = MVP, ferry-feature-round2-plan.md = round-2 UX features)
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
- All SSH operations for a connection go through one `RemoteShell` instance (wraps a single `ssh2.Client`), owned by `SessionManager`, keyed by a renderer-issued `sessionId` (UUID) — NOT tied to a saved site id, so the same site can have multiple concurrent sessions (e.g. browsing + a tail).
- `TailManager` and `TransferQueue` are separate singletons that look up the `RemoteShell` for a given `sessionId` via `SessionManager.getInstance().shell(sessionId)` — they don't own connections themselves.
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

## Gotchas that will waste your first hour

1. **`electron-builder.yml` must be named EXACTLY that** (or `electron-builder.ts`/`.json`/etc.) — NOT `electron-builder.config.ts`. electron-builder's config loader (`read-config-file`) only searches for `electron-builder.<ext>`; `*.config.ts` is silently ignored with no error, and you get default settings (`oneClick: true`, wrong product name, no asarUnpack). We hit this for real — see `.claude/plan/ferry-implementation-plan.md` history. Also: electron-builder's `.ts`-config loader (`config-file-ts`) has a Windows bug where absolute paths with a drive letter break its cache-directory naming — prefer `.yml` over `.ts` for this config on Windows regardless.
2. **Icons will silently 404/CSP-block unless the full Lucide set is registered.** `@nuxt/ui`'s icon component falls back to fetching unrecognized icon names from Iconify's public API at runtime — blocked by our CSP (`default-src 'self'`), and Vite's static icon-bundling can't detect dynamically-bound icon names (computed props, ternaries) anyway. Fix already applied in `main.ts`: `addCollection(lucideIcons)` before mount. If you add a different icon collection, register it the same way.
3. **`titleBarStyle: 'hidden'` alone removes ALL window chrome on Windows** — no close/minimize/maximize button, only Alt+F4 — and that's now intentional: `TitleBar.vue` draws its own buttons wired to `window:*` IPC (see Conventions). Do NOT re-add `titleBarOverlay` "to be safe" — it draws real OS caption buttons over the custom bar with no way to hide just the buttons while keeping the overlay, which is exactly what we removed it to avoid.
4. **`tsconfig.web.json`'s `include` must cover `src/renderer/auto-imports.d.ts`, not just `src/renderer/src/**/*`.** `unplugin-auto-import` (via `@nuxt/ui/vite`) writes global ambient declarations (`useToast`, `useOverlay`, etc.) to that file, one directory above the renderer source root. Component tags (`UButton`, `UModal`, ...) still resolve fine in `<template>` even without it, because Vue's template checker (`@vue/language-core`) discovers `components.d.ts`-style files through a separate mechanism — but a bare composable call in `<script setup>` (e.g. `useToast()`) goes through the real TS program and needs the ambient file in `include` to type-check. Hit this for real adding `useNotify.ts` — fixed by adding the path explicitly.
5. **No recursive directory transfer.** `TransferQueue` handles single files only; the transfer/tail/extract/preview icon buttons on `FileRow`/double-click are hidden or no-op for directories (`!entry.isDir`/`entry.isDir` branch). Dragging a folder onto the other pane silently does nothing (draggable is also gated on `!entry.isDir`).
6. **No app icon set** — `resources/` is empty and `electron-builder.yml`'s `icon:` key is commented out, so packaged builds use the default Electron icon.
7. `@toys\ui` (the local `@nuxt/ui` source clone) is NOT a dependency of this project and has no build output — it's reference material only (source browsing + the `nuxt-ui` skill). Never point tooling at it.
8. **File preview/download/tail affordances only apply to the remote pane, never local.** `FilePreviewDialog.vue`'s download and tail buttons are gated on `side === 'remote'` — downloading or tailing a file that's already on the local machine doesn't make sense, and `TailManager`/`tail:start` only ever operates over an SSH session. If you add a similar affordance elsewhere, gate it the same way (mirrors `FilePane.vue`'s pre-existing `showTail = side === 'remote' && connected` computed).

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
| Add a new dock tab (beyond Transfers/Log Tail/Activity) | `renderer/src/components/shell/BottomDock.vue` (`DockTab` union + button + template branch) |
| Packaging/installer settings | `electron-builder.yml` (see Gotcha #1 about the filename) |

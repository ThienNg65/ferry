# Ferry — a lightweight WinSCP alternative (Electron + Vue)

## Context

WinSCP works but is bloated and sluggish for daily use, and its transaction log doesn't tail live, making it hard to watch what's happening on a remote server in real time. The goal is a focused, fast, minimal desktop client — same familiar dual-pane file-transfer mental model and toolbar-driven workflow as WinSCP, but visually and behaviorally in line with Apple's design principles (restrained chrome, generous whitespace, one accent color, no menu-bar/status-bar clutter), and with a log-tailing experience that actually feels live.

Decided scope (from user Q&A):
- **Protocol**: SFTP/SSH only — no FTP/FTPS/SCP.
- **MVP features**: saved-site/session manager, dual-pane local+remote file browser, upload/download/rename/delete/mkdir, a transfer queue with progress, a live remote log-tail viewer (`tail -f`-style over SSH), a live in-app activity log (replacing WinSCP's non-tailing log panel), and a **remote unzip** action (`unzip -qo <archive> -d <dir>` run server-side via SSH exec — no download/upload round-trip). Out of scope for v1: two-way sync, built-in editor, scripting console.
- **Location**: `C:\toys\ferry`
- **Name**: **Ferry**

Big finding during investigation: the user already has a closely related project at [C:\toys\hot-deploy-flow](C:\toys\hot-deploy-flow) — an Electron + Vue + TypeScript SSH tool with a proven `ssh2`-based connection pool, a resilient exec/stream wrapper, a `tail -f` log-stream manager with PID-capture/reconnect/reaper, a typed IPC contract, and a hardened `contextBridge` preload. Ferry should **reuse these patterns directly** rather than reinvent them. The user also has a local clone of `@nuxt/ui` v4.9.0 at `C:\toys\ui` (source only, no build — install `@nuxt/ui` from npm instead, keep the clone as reference/skill material) which fits the "Apple-minimal, WinSCP-familiar toolbar" brief almost off the shelf via its Vue-plugin + Tailwind integration and dashboard/resizable-panel primitives.

One accepted tradeoff: Electron's Chromium/Node baseline (~150MB+) is heavier than the Neutralino approach the user used for an earlier lightweight GUI tool (`hot-deploy-gui-1.0.1`). Per explicit instruction we're building with Electron + Vue anyway; mitigate footprint with a single `BrowserWindow`, `sandbox: true`, no devtools/menu in production, and a minimal preload surface.

---

## Architecture Overview

```
C:\toys\ferry\
  package.json
  tsconfig.json
  electron.vite.config.ts
  electron-builder.config.ts
  resources\                     # icons for electron-builder
  src\
    main\
      index.ts                   # app bootstrap, BrowserWindow, register all IPC handlers
      ssh\
        SessionManager.ts        # connection pool keyed by renderer-issued sessionId (UUID)
        RemoteShell.ts           # exec / execLines / sftp helpers over one ssh2.Client
        errors.ts                # SshError + IpcErrorCode mapping
        retry.ts                 # withRetry() helper
      fs\
        LocalFsService.ts        # local dir listing / mkdir / rename / delete
        RemoteFsService.ts       # sftp-backed dir listing / mkdir / rename / delete
      transfer\
        TransferQueue.ts         # bounded-concurrency upload/download queue, throttled progress
      tail\
        TailManager.ts           # tail -F over SSH exec, PID-capture, reconnect, idle reaper
      unzip\
        UnzipService.ts          # remote `unzip -qo` via SSH exec
      activity\
        ActivityLog.ts           # in-process app/session event bus + ring buffer
      sites\
        SiteStore.ts             # saved connections (electron-store) + safeStorage secrets
      ipc\
        envelope.ts               # handle() wrapper -> typed IpcResult
        sites.ipc.ts / session.ipc.ts / fs.ipc.ts / transfer.ipc.ts / tail.ipc.ts / unzip.ipc.ts / activity.ipc.ts
    preload\
      index.ts                   # contextBridge whitelist (invoke/on/off), derived from contract.ts
    renderer\
      index.html
      src\
        main.ts                  # createApp().use(pinia).use(nuxtUiVuePlugin).mount()
        App.vue                  # <UApp><AppShell /></UApp>
        assets/main.css          # tailwind + @nuxt/ui import + design tokens
        components\
          shell\        TitleBar.vue, AppShell.vue, BottomDock.vue, CommandPalette.vue
          sessions\      SessionManagerView.vue, SessionListItem.vue, ConnectionDialog.vue, SiteManagerSlideover.vue
          files\         FilePane.vue, PathBreadcrumb.vue, FileToolbar.vue, FileList.vue, FileRow.vue, FileContextMenu.vue, NewFolderPrompt.vue
          transfers\     TransferQueue.vue, TransferItem.vue
          logs\          ActivityLog.vue, LogTailViewer.vue, RemoteFilePicker.vue
          archive\       ExtractHereAction.ts
          common\        ConfirmModal.vue, EmptyState.vue, ErrorState.vue
        composables\      useFileSelection.ts, useDragAndDrop.ts, useFileIcons.ts, useTransferQueue.ts, useLogTail.ts, useSessions.ts, useResizablePanel.ts
        stores\           sessions.store.ts, localFs.store.ts, remoteFs.store.ts, transferQueue.store.ts, logs.store.ts, ui.store.ts
    shared\
      contract.ts               # INVOKE_CHANNELS / EVENT_CHANNELS / all IPC payload types — single source of truth
```

TypeScript everywhere. Build tooling: **electron-vite** (scaffold via `npm create @quick-start/electron@latest`, template `vue-ts`). Packaging: **electron-builder**, NSIS installer for Windows, `asarUnpack` for `ssh2`/`cpu-features`/`nan` native bits. No `keytar`, no `better-sqlite3` needed.

---

## Backend (Electron main process)

- **Process boundaries**: main owns all SSH/SFTP/fs/credentials; preload exposes exactly `window.api.invoke(channel, ...)` / `.on(channel, cb)` / `.off(...)`, both validated against a whitelist derived from `contract.ts` (copy `hot-deploy-flow/src/preload/index.ts` near-verbatim). `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **SFTP/SSH library**: `ssh2` directly (not `ssh2-sftp-client`) — we need raw exec channels for tail and unzip alongside SFTP, so one `RemoteShell` wrapper (adapted from `hot-deploy-flow/src/main/ssh/RemoteShell.ts`) covers both `exec`/`execLines` and `sftp()` off a single connected client.
- **Sessions**: `SessionManager` keyed by renderer-issued `sessionId` (UUID), supporting multiple concurrent connections (unlike the precedent's single-fixed-DB-row model). `session:open` accepts either a saved `siteId` or an ad-hoc quick-connect profile; `session:close` tears down transfers/tails bound to that session. No silent auto-reconnect for browsing sessions (stale listings/in-flight transfers) — auto-reconnect is reserved for tail streams only.
- **Saved sites & credentials**: `sites.json` under `app.getPath('userData')` via `electron-store`. Secrets (password/key passphrase) encrypted with Electron's `safeStorage` (Windows DPAPI-backed, zero extra native deps — simpler than the precedent's `keytar`, which needed asar-unpack/prebuild handling). Renderer never receives decrypted secrets back, only "is set" booleans.
- **Auth**: password + private key (file path or pasted content) with optional passphrase, plus `keyboard-interactive` fallback. Agent/Pageant support deferred — keep `authMethod` as an extensible string union.
- **File ops IPC**: `fs:local:*` and `fs:remote:*` (list/mkdir/rename/delete), remote listing via `sftp.readdir`, recursive delete implemented in main (SFTP has no native recursive rm).
- **Transfers**: `TransferQueue` per session, bounded concurrency (2–3), using `sftp.createReadStream`/`createWriteStream` (not `fastGet`/`fastPut`) for clean cancellation and backpressure on large files. Progress throttled (~150–250ms or ≥1% delta) via `transfer:event`, computed in main — never per-chunk.
- **Remote log tail** (core differentiator): adapt `hot-deploy-flow/src/main/engine/LogStreamManager.ts` into `TailManager.ts`, generalized to an arbitrary user-picked remote path. Use `tail -n <history> -F '<path>'` (capital `-F`, not `-f`) so it survives log rotation/truncation — the precedent uses `-f`; upgrading to `-F` directly addresses the "log panel doesn't handle rotation" gap. Keep the PID-capture trick (`printf 'PID:%s\n' $$; exec tail ...`) so `tail:stop` can kill the exact remote process — closing the SSH channel alone won't reliably kill a backgrounded remote `tail`. Reconnect with capped exponential backoff on transient drops; idle-reap streams after 30 min.
- **App-side activity log**: `ActivityLog` singleton, in-process only, broadcasts `activity:event` immediately (connect/disconnect/transfer/tail/unzip lifecycle) — never gated on remote I/O, so it feels instant. Bounded ring buffer (~2,000 entries) with an `activity:history` backfill channel.
- **Remote unzip**: `unzip:run` invokes exactly `unzip -qo '<archive>' -d '<targetDir>'` via a buffered `exec`, wrapped in a `command -v unzip` pre-check that emits a `__UNZIP_MISSING__` sentinel on stderr + exit 127 so we can surface a friendly "unzip not installed on this server" error rather than a raw exit code. Both path args must be shell-escaped before interpolation. Fires `ActivityLog` events.
- **Packaging**: electron-builder, NSIS (`oneClick: false`, allow custom install dir), `asarUnpack` for `ssh2`/`cpu-features`/`nan`. Auto-update deferred (stub `electron-updater` dependency, no publish config yet).

## Frontend (Vue renderer)

- **Stack**: Vue 3 Composition API + `<script setup>`, Pinia, TypeScript, no `vue-router` (single-window app — view switching between "Session Manager" and "connected dual-pane" is plain reactive state, not routes).
- **UI library**: `@nuxt/ui` v4.9.0 installed from npm (not the local source-only clone), via its `./vite` + `./vue-plugin` entry points — no full Nuxt needed. Gives accessible primitives for free: resizable dual-pane/dock layout (`UDashboardGroup/Panel/ResizeHandle`), context menus, modals/slideovers, progress bars, tooltips, command palette. `@tanstack/vue-virtual` comes in transitively — use it directly for virtualized file lists and the log-tail viewer.
- **Design tokens** (Apple-HIG translation): `neutral: 'zinc'` for all chrome, one custom blue `primary` accent used sparingly (selection, primary CTAs, focus rings) — nothing else colored. System font stack (`Segoe UI Variable` on Windows, falls back sanely). Compact type scale (11–20px) and dense 4px-grid spacing (~28px file rows) rather than Nuxt UI's comfortable defaults. 8px panel radius, hairline borders instead of drop shadows except on genuinely floating layers (popovers/menus/palette). Icon set: Lucide (bundled default), installed locally (`@iconify-json/lucide`) so icons work offline in a packaged app.
- **Toolbar**: single icon-only row with tooltips, grouped by separators, overflow into a "More" dropdown — no second toolbar row, no classic File/Edit menu bar, no permanent status bar. Replace the menu bar with `Ctrl+K` command palette + a single preferences popover. The collapsed transfer-dock header doubles as the status line.
- **Title bar**: custom frameless chrome (`titleBarStyle: 'hidden'`), minimal Windows-11-style caption buttons (not macOS traffic lights, since this targets Windows), draggable region, connection breadcrumb centered.
- **Layout**: `AppShell.vue` = TitleBar + resizable dual `FilePane`s (local/remote) + a collapsible/resizable `BottomDock` (`UTabs`: Transfer Queue / Activity Log / one tab per open Log Tail). Site manager has three surfaces: a full-pane "no active connection" `SessionManagerView`, a `USlideover` for bulk site management, and a `UModal` `ConnectionDialog` for create/edit/test-connect.
- **File panes**: breadcrumb + path input, icon-only toolbar, virtualized `FileList`/`FileRow`s, context menu (Open/Rename/Delete/New Folder/Extract Here for archives on the remote side/Properties). Standard Explorer-style multi-select (click/ctrl/shift/drag-lasso) and keyboard nav (arrows, Enter, F2, Delete, Ctrl+A, Ctrl+L), via Nuxt UI's `defineShortcuts`.
- **Drag-and-drop**: between panes (in-memory drag payload, not `dataTransfer` JSON) and from Windows Explorer into the app (needs `webUtils.getPathForFile` exposed from preload, since `File.path` is gone in modern Electron — coordinate with the main-process `getDroppedFilePath` handler).
- **Transfer queue**: `UProgress` per item, rate/ETA/status badge, aggregate count shown even when the dock is collapsed.
- **Log tail viewer — the snappy-under-load part**: capped ring buffer (~5,000 lines, `shallowRef`), rendered via `@tanstack/vue-virtual`, incoming lines batched and flushed once per animation frame (not one reactivity trigger per line) — this is the single highest-leverage fix against jank at high line rates. Auto-scroll with a "Jump to latest ↓" pill when the user scrolls up, directly answering the "doesn't tail live" complaint.

---

## Build Order

1. Scaffold `C:\toys\ferry` with `electron-vite` (`vue-ts` template); wire `contract.ts`, preload whitelist, and basic window (copy security flags from `hot-deploy-flow`).
2. Port `RemoteShell`, `errors.ts`, `retry.ts` from `hot-deploy-flow`; build `SessionManager` (multi-session pool) and `SiteStore` (electron-store + `safeStorage`).
3. Wire session connect/disconnect end-to-end (renderer stub UI is fine at this stage) before adding file browsing.
4. Add `RemoteFsService`/`LocalFsService` + IPC, then the Vue dual-pane browser on top (`@nuxt/ui` install, design tokens, `FilePane`/`FileList`/`FileRow`).
5. Add `TransferQueue` (stream-based, throttled progress) + `TransferQueue.vue`/`TransferItem.vue`.
6. Port `LogStreamManager` → `TailManager` (switch `-f` to `-F`), wire `LogTailViewer.vue` with virtualization + rAF batching.
7. Add `ActivityLog` + `ActivityLog.vue`.
8. Add `UnzipService` + "Extract Here" context-menu action.
9. Polish: command palette, drag-and-drop, keyboard shortcuts, dark mode, title bar.
10. Package with electron-builder, smoke-test the NSIS installer.

## Verification

- Unit-test `RemoteShell`/`TailManager`/`UnzipService` against a real or dockerized SSH/SFTP test server (e.g. `docker run -p 2222:22 atmoz/sftp`), mirroring `hot-deploy-flow/src/tests/sshCore.test.ts`'s approach.
- Manually drive the full app: connect to a real server, browse both panes, upload/download a large-ish file and confirm progress/cancel work, rename/delete/mkdir, right-click extract a `.zip` on the remote side, open a live tail on a file and `echo` new lines into it from another shell to confirm real-time streaming and rotation handling (`mv` the file + recreate it while tailing), and watch the activity log update instantly on each action.
- `npm run build` via electron-vite, then package via electron-builder and install the resulting NSIS `.exe` on a clean-ish user profile to confirm it launches, connects, and transfers correctly outside the dev environment.

## Documentation Artifacts to Save

Alongside implementation, persist the design work as durable docs under `C:\toys\ferry\.claude\` (created as part of scaffolding the new project):

- `C:\toys\ferry\.claude\architecture\ferry-electron-backend-architecture.md` — the full main-process/IPC architecture (process boundaries, SSH/SFTP integration, session model, site/credential persistence, auth methods, file-op and transfer IPC contracts, remote log-tailing design, activity log, remote-unzip feature, packaging, project scaffold) as detailed in the Backend section above.
- `C:\toys\ferry\.claude\architecture\ferry-vue-frontend-architecture.md` — the full renderer/UX architecture (tech choices, `@nuxt/ui` adoption rationale, Apple-HIG design tokens, screen/layout structure, component breakdown, key interactions, project scaffold) as detailed in the Frontend section above.
- `C:\toys\ferry\.claude\plan\ferry-implementation-plan.md` — a copy of this plan file, for future reference independent of the plan-mode session file.

## Key Reference Files

- [C:\toys\hot-deploy-flow\src\main\ssh\RemoteShell.ts](C:\toys\hot-deploy-flow\src\main\ssh\RemoteShell.ts) — exec/execLines/sftp wrapper pattern to adapt
- [C:\toys\hot-deploy-flow\src\main\engine\LogStreamManager.ts](C:\toys\hot-deploy-flow\src\main\engine\LogStreamManager.ts) — tail -f/PID-capture/reconnect/reaper pattern to adapt into TailManager
- [C:\toys\hot-deploy-flow\src\preload\index.ts](C:\toys\hot-deploy-flow\src\preload\index.ts) — contextBridge whitelist to copy near-verbatim
- [C:\toys\hot-deploy-flow\src\shared\contract.ts](C:\toys\hot-deploy-flow\src\shared\contract.ts) — IPC channel-contract pattern to replicate
- [C:\toys\hot-deploy-flow\src\main\ipc\envelope.ts](C:\toys\hot-deploy-flow\src\main\ipc\envelope.ts) — typed handle() wrapper
- [C:\toys\hot-deploy-flow\electron-builder.config.ts](C:\toys\hot-deploy-flow\electron-builder.config.ts) — NSIS/asarUnpack config to adapt (drop keytar/better-sqlite3 unpack entries)
- [C:\toys\ui\skills\nuxt-ui\SKILL.md](C:\toys\ui\skills\nuxt-ui\SKILL.md) — @nuxt/ui plain-Vite install pattern
- [C:\toys\ui\skills\nuxt-ui\references\layouts\dashboard.md](C:\toys\ui\skills\nuxt-ui\references\layouts\dashboard.md) — resizable panel primitives basis for the dual-pane + dock layout
- [C:\toys\ui\skills\nuxt-ui\references\guidelines\design-system.md](C:\toys\ui\skills\nuxt-ui\references\guidelines\design-system.md) — semantic tokens for the Apple-HIG visual system

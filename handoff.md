# Handoff — Ferry round-2 UX features (2026-07-11)

## Goal

Adapt the shipped Ferry MVP to real user feedback gathered after the first build. Five requested changes, all delivered this session:

1. Option to hide the Local pane.
2. Saved-site management (add/update/delete, name defaults to hostname, one-click reconnect).
3. Double-click a file → preview dialog (download fallback for non-text files; tail-icon shortcut for log files, on top of the existing per-row hover tail icon).
4. Downloads default into the OS Downloads folder (not wherever the local pane happens to be browsing) + toast notifications for notable async outcomes.
5. Custom-drawn minimize/maximize/close titlebar buttons matching the app's own design, replacing the OS-drawn `titleBarOverlay` caption buttons.

Full design rationale and exact decisions live in `.claude/plan/ferry-feature-round2-plan.md` (written and approved via plan mode before implementation).

## Status: all 5 features implemented, verified, committed

`npm run typecheck` and `npm run build` are both clean. Committed as `b372122` on `main` ("Add saved sites, file preview/tail dialog, hide-local toggle, custom titlebar, and download/toast polish"), 25 files changed, working tree clean. Branch is 1 commit ahead of `origin/main` (not pushed — not asked to).

I also booted `npm run dev` once as a smoke test: log showed a clean boot (`start electron app...`) with only benign Windows Chromium cache-permission and DevTools-protocol warnings, no app-level errors. **I did not — and could not — do full interactive UI verification**: no tool here can drive an Electron desktop window (browser-automation tools only reach web pages), and I have no real SFTP server to connect to. This is the single biggest thing left for you to do — see "Next step."

## Current state of the code

See `.claude/PROJECT_MAP.md` (updated this session) for the full directory map and conventions. Short version of what's new since the MVP:

- Saved-site management is now a real UI: `sites.store.ts` + `SiteFormDialog.vue` (the app's first `UModal`) + a reworked `SessionManagerView.vue` with a connect/edit/delete list above the existing quick-connect form.
- File double-click now opens `FilePreviewDialog.vue` (another `UModal`) instead of doing nothing; reads go through two new capped (1 MiB) IPC channels, `fs:local:readFile`/`fs:remote:readFile`.
- Downloads always target `app.getPath('downloads')` via a new `system:getDownloadsPath` channel, instead of wherever the local pane was browsing.
- A toast system exists for the first time (`useNotify.ts` wrapping `@nuxt/ui`'s `useToast()`, plus a toaster region on `<UApp>`), wired into transfer done/error, extract done/error, and connect success/error.
- The titlebar is now fully custom-drawn (real Vue `<button>`s for minimize/maximize/close, wired to new `window:*` IPC channels) — `titleBarOverlay` is gone; `titleBarStyle: 'hidden'` alone now controls the window chrome.
- A new `ui.store.ts` holds the local-pane visibility toggle, persisted to `localStorage`.

## Files actively edited this session

New files:
- `src/renderer/src/stores/ui.store.ts`, `src/renderer/src/stores/sites.store.ts`
- `src/renderer/src/components/sessions/SiteFormDialog.vue`
- `src/renderer/src/components/files/FilePreviewDialog.vue`
- `src/renderer/src/utils/fileTypes.ts`
- `src/renderer/src/composables/useNotify.ts`
- `src/main/ipc/system.ipc.ts`, `src/main/ipc/window.ipc.ts`

Modified files (most likely to need follow-up first):
- `src/shared/contract.ts` — added `FileReadResult`, `DownloadsPathResult`, `WindowStateEvent`, `WindowIsMaximizedResult` types and the `fs:local:readFile`/`fs:remote:readFile`/`system:getDownloadsPath`/`window:minimize`/`window:maximizeToggle`/`window:close`/`window:isMaximized`/`window:state-change` channels.
- `src/main/index.ts` — module-level `mainWindow` variable (previously only a local in `createWindow()`), removed `titleBarOverlay`, registers `registerSystemHandlers()`/`registerWindowHandlers()`, broadcasts `windowStateChange` on maximize/unmaximize.
- `src/renderer/src/components/files/FilePane.vue` — `onOpen` now opens the preview dialog for files (was a no-op); download destination now comes from `system:getDownloadsPath` instead of `localFs.currentPath`; extract success/error now toasts.
- `src/renderer/src/components/sessions/SessionManagerView.vue` — full rework (saved-sites list + delete-confirm modal, on top of the unchanged quick-connect form).
- `src/renderer/src/components/shell/TitleBar.vue` — full rewrite (custom buttons, was OS-overlay-only).
- `src/renderer/src/stores/sessions.store.ts` — added `pendingLabel`, shared `openSession` action, `connectToSite`, connect/lost-connection toasts.
- `src/renderer/src/stores/transferQueue.store.ts` — transfer done/error now toasts.
- `tsconfig.web.json` — `include` gap fix (see Failed Attempts).
- `src/main/fs/LocalFsService.ts`, `src/main/fs/RemoteFsService.ts`, `src/main/ssh/RemoteShell.ts`, `src/main/ipc/fs.ipc.ts` — new `readFileText`/`readFile` functions and their IPC registration.
- `src/renderer/src/App.vue` — hide-local toggle button + `v-if`, `<UApp :toaster>`.
- `src/renderer/components.d.ts` — auto-regenerated by `unplugin-vue-components` to include the two new components; no manual edits.

## Changes made (chronological, by feature)

1. **Hide Local pane** — `ui.store.ts` (localStorage-backed `showLocalPane`), toggle button in `App.vue`'s connected-session header, `v-if` around the local `FilePane` (chosen over `v-show` so it cleanly unmounts its `FilePreviewDialog` instance when hidden).
2. **Downloads folder + toasts** (built before saved-sites so its toast infra was ready to reuse) — `system:getDownloadsPath` channel/handler, `FilePane.vue`'s download branch switched from `localFs.currentPath` to the Downloads path, `useNotify.ts` composable, `<UApp :toaster>`, toast hooks in `transferQueue.store.ts` (done/error) and `FilePane.vue`'s `onExtract` (success/error).
3. **Saved-site management** — `sites.store.ts` (hostname-fallback logic lives here, client-side, exactly once — `SiteStore` in main stays a pure passthrough), `SiteFormDialog.vue` (first `UModal` in the app — chosen over `USlideover` since this is a bounded CRUD form, not a drill-down panel), reworked `SessionManagerView.vue`, `sessions.store.ts`'s new `openSession`/`connectToSite` with connect-success/failure toasts placed directly in the try/catch (not the `sessionStatus` event subscription — verified `SessionManager.connect()` only ever resolves after the SSH handshake fully succeeds or throws, so there's no intermediate-state race to guard against).
4. **File preview/tail dialog** — `fs:local:readFile`/`fs:remote:readFile` contract additions, `LocalFsService.readFileText`/`RemoteShell.readFile`/`RemoteFsService.readFile` (all capped at 1 MiB, `truncated` flag for oversized files), `fs.ipc.ts` registration, `fileTypes.ts` extension allowlists (preview: txt/log/conf/cfg/json/yml/yaml/ini/md; log-detection: log/txt), `FilePreviewDialog.vue` (uses `UModal`'s `#actions` slot for the tail button alongside the built-in close button), wired into `FilePane.vue`'s `onOpen`. Download/tail affordances inside the dialog are gated to `side === 'remote'` only — downloading or tailing a file that's already local doesn't make sense.
5. **Custom titlebar buttons** — dropped `titleBarOverlay` entirely (Windows always draws real OS caption buttons in that region; there's no way to keep the overlay but hide just the buttons), kept `titleBarStyle: 'hidden'` alone as the standard fully-custom-titlebar recipe. New `window:*` IPC channels + `window.ipc.ts`, module-level `mainWindow` reference in `main/index.ts` so both the IPC handlers and the `maximize`/`unmaximize` listeners can reach it, full rewrite of `TitleBar.vue` with plain styled `<button>`s (not `UButton` — its rounded/padded default styling doesn't match the flush, 44px-wide, square-hover Windows caption-button convention).
6. Verification: `npm run typecheck` and `npm run build`, one `npm run dev` boot smoke test, `git commit`.

## Everything tried that failed

- **`useToast()` didn't type-check** (`TS2304: Cannot find name 'useToast'`) even though it's globally auto-imported at runtime by `@nuxt/ui/vite`. Root cause: the auto-import plugin writes its ambient global declarations to `src/renderer/auto-imports.d.ts`, but `tsconfig.web.json`'s `include` only covered `src/renderer/src/**/*` — one directory too narrow. Component tags (`UButton` etc.) still resolved fine in templates because Vue's template type-checker (`@vue/language-core`) discovers `components.d.ts`-style files through its own mechanism, separate from the plain TS program that checks `<script setup>` identifiers — that's why this only broke on a bare composable call, not on any of the many pre-existing unimported component usages. **Fixed** by adding `"src/renderer/auto-imports.d.ts"` to `tsconfig.web.json`'s `include`.
- **Invalid `v-model:open="() => Boolean(deleteTarget)"` on the delete-confirmation `UModal`** — a function isn't a valid v-model target. **Fixed** by switching to `:open="Boolean(deleteTarget)"` + `@update:open="(v: boolean) => { if (!v) deleteTarget = null }"`.
- **Stray second `<script lang="ts">` block** in a first draft of `SiteFormDialog.vue`, added by mistake while trying to import `ref` after already writing the main `<script setup>` block — Vue SFCs can't have two script blocks importing into the same setup scope like that. **Fixed** by adding `ref` to the existing `<script setup>` import line and deleting the stray block. Caught immediately since I re-read the file before editing further (Edit tool requires a prior Read).
- **Couldn't cleanly tear down the `npm run dev` smoke-test process** — backgrounded it with a trailing `&` inside the Bash-tool's own `run_in_background`, which was redundant: the outer tracked command exited immediately (echoing the child's MSYS-emulated PID) while the actual `npm`/`electron-vite`/Electron process tree ran detached under a different real Windows PID. `taskkill //PID <that pid>` correctly reported "process not found" — the PID from `$!` in Git Bash doesn't map to a real Windows PID for a backgrounded chain like this. Confirmed via `Get-Process` (PowerShell, real Windows process view) that no Electron process was actually left running, so no cleanup was needed — but the lesson is: don't add a manual `&` on top of the harness's own `run_in_background`, and use `Get-Process`, not `ps`/`taskkill` with a Git-Bash PID, to check for real Windows processes.
- No design decisions were reverted — the Plan-mode design pass (a background Plan agent, cross-checked against direct reads of the actual current source) caught the two ambiguous points before any code was written: `sessions.store.ts`'s connect-toast placement (resolved via reading `SessionManager.connect()` directly rather than guessing at event timing), and the exact `sitesUpdate`/`sitesDelete` IPC call shapes (positional args, not object payloads — checked directly against `sites.ipc.ts` rather than assumed).

## Next step

Nothing is broken or blocking, but nothing has been hands-on verified against a real server or real window either. In priority order:

1. **Manual verification against a real SFTP server** (I could not do this — see Status). Specifically: saved-site create/edit (leaving password blank on edit should preserve the old one)/delete/connect; double-click preview on a `.txt`/`.log`/`.json` file and on a binary/unlisted-extension file; the preview dialog's tail button vs. the row's hover tail icon opening the same Log Tail dock tab; a real download landing in the actual Windows Downloads folder with a success toast; forcing a transfer failure and confirming an error toast without progress-toast spam; clicking the new minimize/maximize/close buttons and confirming the maximize icon flips on double-click-titlebar or drag-to-edge (not just via the button itself); confirming the "Ferry" label is still draggable now that the button group is carved out as `no-drag`.
2. **Recursive directory transfer** — still the biggest functional gap from the original MVP handoff; unrelated to this session's work. Transfer/tail/extract/drag/preview are all still gated to files only (`!entry.isDir`).
3. Deferred polish (unchanged from before, still independent, pick any): command palette (Ctrl+K), drag-in from Windows Explorer, light/dark mode toggle, custom app icon, code signing, auto-update wiring.
4. No test suite exists yet — still true; `vitest` is installed but nothing under `src/tests/`. If adding tests, the new `readFileText`/`readFile` (size cap + truncation) and the `window:*` handlers (mock `BrowserWindow`) would be reasonable first targets alongside the previously-suggested `RemoteShell`/`TailManager`/`UnzipService`.
5. Not done: pushing the `b372122` commit to `origin/main` — left for you to decide.

# Handoff — Ferry MVP build (2026-07-11)

## Goal

Build "Ferry" — a lightweight WinSCP alternative — from scratch: Electron + Vue 3 + TypeScript, SFTP/SSH only, Apple-HIG-inspired minimal UI on `@nuxt/ui`, with a genuinely live remote log tail (WinSCP's log panel doesn't tail live — that's the core complaint driving this project) and a "extract archive on the remote server" action. Full plan at `.claude/plan/ferry-implementation-plan.md`; full architecture docs at `.claude/architecture/ferry-*-architecture.md`.

## Status: MVP feature-complete, packaged, committed

All 11 build-order tasks done. `npm run typecheck` and `npm run build` are clean. `npm run package` produces a working `dist/Ferry-Setup-0.1.0.exe` (NSIS installer, `oneClick: false`). Initial commit made: `5aa908b` on `main` ("Initial Ferry scaffold: SFTP client with live log tailing"), 62 files, working tree clean.

Live-tested twice against real servers (by the user, mid-session): a failed-auth attempt correctly surfaced through the full IPC round-trip into the UI alert, and a successful connection showed real local + remote directory listings side by side.

## Current state of the code

See `.claude/PROJECT_MAP.md` for the full directory map, conventions, and gotchas — it's up to date as of this session (freshly created). Short version: contract-first IPC (`src/shared/contract.ts` is the single source of truth), one singleton service per domain in `src/main/` (SessionManager, SiteStore, ActivityLog, TailManager, TransferQueue), stateless functional services for fs (`LocalFsService`/`RemoteFsService`), one Pinia store per domain in the renderer, `@nuxt/ui` v4 for all components.

## Files actively edited this session

Effectively the whole project — it was built from an empty directory. Files touched most recently (last few edits, most likely to need follow-up):

- `src/main/index.ts` — BrowserWindow config (`titleBarOverlay` fix)
- `electron-builder.yml` — **renamed from `electron-builder.config.ts`** (see Failed Attempts)
- `tsconfig.node.json` — updated `include` after the rename
- `src/renderer/src/main.ts` — added `addCollection(lucideIcons)` icon fix
- `package.json` — added `@iconify/vue` as an explicit dependency
- `src/renderer/src/components/files/FileRow.vue`, `FileList.vue`, `FilePane.vue` — drag-and-drop + keyboard delete shortcut wiring
- `.gitignore`, `.claude/PROJECT_MAP.md` (new), `handoff.md` (this file)

## Changes made (chronological, by feature)

1. Scaffolded project (electron-vite, TS project references, `@nuxt/ui` + Tailwind v4 wiring, hardened `BrowserWindow`, `contextBridge` preload whitelist derived from `contract.ts`) — reused patterns directly from a sibling project `C:\toys\hot-deploy-flow` (same author, similar Electron+SSH tool).
2. `RemoteShell` (exec/execLines/sftp wrapper over one `ssh2.Client`), `SessionManager` (multi-session pool keyed by UUID, not saved-site id), `SiteStore` (electron-store + `safeStorage`-encrypted secrets).
3. Session open/close IPC wired end-to-end; minimal quick-connect UI (`SessionManagerView.vue`).
4. `LocalFsService`/`RemoteFsService` + dual-pane file browser (`FilePane`/`FileList`/`FileRow`/`FileToolbar`/`PathBreadcrumb`).
5. `TransferQueue` (SFTP streams, not fastGet/fastPut, for clean cancel + real progress) + `TransferQueue.vue`/`TransferItem.vue`.
6. `TailManager` (`tail -F`, PID-capture kill, reconnect-with-backoff, idle reaper) + `LogTailViewer.vue` (rAF-batched line buffering via `useLogTail.ts`) + `BottomDock.vue` shell.
7. `ActivityLog` (in-process, instant, ring buffer) + `ActivityLog.vue` panel.
8. `UnzipService` (`unzip -qo` via SSH exec, missing-binary detection via stderr sentinel) + "Extract Here" icon action on `.zip` files.
9. Polish: fixed window closability (`titleBarOverlay`), drag-and-drop between panes (`useDragAndDrop.ts`, module-scoped shared drag state), Delete-key removes selected entries.
10. Packaged with electron-builder; fixed the config-discovery bug (below); confirmed the packaged `Ferry.exe` launches cleanly with no console errors.
11. Initialized git (was already `git init`'d with no commits when I checked), staged everything except `node_modules`/`out`/`dist`, committed.

## Everything tried that failed

- **Icons silently broken (real bug, not cosmetic):** `@nuxt/ui`'s Icon component fell back to fetching unrecognized icon names from `api.iconify.design`/`unisvg.com`/`simplesvg.com` at runtime — blocked by our CSP (`default-src 'self'`). Root cause: Vite's static icon-bundling can't detect dynamically-bound icon names (computed props, ternaries — e.g. `:icon="transferIcon"`, `collapsed ? 'i-lucide-chevron-up' : '...'`), so those fall through to the runtime-fetch path. **Fixed** by calling `addCollection(lucideIcons)` (from `@iconify/vue`, using `@iconify-json/lucide/icons.json`) in `main.ts` before mount — registers the entire Lucide set in memory so nothing ever needs the network. Added `@iconify/vue` as an explicit dependency (was previously only transitive via `@nuxt/ui`).
- **`electron-builder.config.ts` was silently ignored** — packaged output showed `oneClick=true` and lowercase `ferry` product name despite our config saying otherwise. Root cause: electron-builder's config loader (`read-config-file`) only searches for a file literally named `electron-builder.<ext>` — never `*.config.ts`. Renamed to `electron-builder.ts`; that surfaced a **second** bug: `config-file-ts` (electron-builder's TS-config compiler) breaks on Windows when the absolute path contains a drive-letter colon (`EINVAL` trying to `mkdir` a cache dir named `...\:-toys-ferry-...`). **Fixed** by converting to `electron-builder.yml` instead (sidesteps the TS-compile step entirely; confirmed via build log: `loaded configuration file=...\electron-builder.yml`, `oneClick=false`, artifact named `Ferry-Setup-0.1.0.exe`).
- **Screenshot-based visual verification was unreliable and I stopped using it.** Window-rect-based screen capture (`GetWindowRect` + `CopyFromScreen`) captures whatever's on top of those screen coordinates, not the target window's actual content if anything overlaps it. This grabbed the user's WinSCP session (internal host IPs, masked password) once, their Notepad++ scratchpad (containing unrelated feedback notes about this very app) once, and my own terminal window once. All three screenshots were deleted immediately. For the rest of the session I relied on build/typecheck exit codes, process-running checks, and log output instead — which proved sufficient and reliable.
- No dead-end code changes were reverted — every implementation attempt (SessionManager reconnect logic, TransferQueue stream handling, TailManager PID capture, etc.) worked on the first pass, verified by typecheck+build+live testing.

## Next step

Nothing is broken or blocking. Reasonable next steps, roughly in priority order:

1. **Saved-site management UI** — `sites:list/create/update/delete` IPC already works, but there's no `ConnectionDialog.vue`/`SiteManagerSlideover.vue`; `SessionManagerView.vue` only does quick-connect. This is probably the highest-value gap (re-entering host/user/password every time is tedious).
2. **Recursive directory transfer** — currently transfer/tail/extract/drag are all gated to files only (`!entry.isDir`); folders can't be uploaded/downloaded at all.
3. Deferred polish (each independent, pick any): command palette (Ctrl+K), drag-in from Windows Explorer (needs `webUtils.getPathForFile` exposed via preload), light/dark mode toggle, custom app icon (`resources/` is empty, `electron-builder.yml`'s `icon:` key is commented out), code signing, auto-update wiring.
4. No test suite exists yet — `vitest` is installed but nothing under `src/tests/` (the precedent project has `sshCore.test.ts` testing against a dockerized SFTP server, worth mirroring for `RemoteShell`/`TailManager`/`UnzipService`).
5. Consider running the full NSIS installer (not just the unpacked exe) on a clean profile before calling packaging fully done — I deliberately only smoke-tested `dist/win-unpacked/Ferry.exe` to avoid an uninvited system-level install (shortcuts/registry/elevation).

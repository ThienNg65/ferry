# ADR-0001: Neutralinojs + Node.js Sidecar Host Migration

- **Status:** Accepted (`GO` — PR #45 / Issue #37)
- **Date:** 2026-11-13
- **Issue:** [#37 — Migrate Ferry from Electron to Neutralinojs](https://github.com/ThienNg65/ferry/issues/37)

## Context

Ferry originally embedded a full Electron/Chromium runtime (~89.92 MB NSIS installer, ~323.58 MB unpacked) to run a Vue 3 + TypeScript UI alongside a Node.js backend (`ssh2`, SFTP, remote tailing, PTY shell, resource monitoring, and DPAPI-encrypted stores under `%APPDATA%\Ferry`).

## Decision

Migrate Ferry's desktop shell to **Neutralinojs (`WebView2`)** paired with a **bundled Node.js v22 sidecar extension (`js.ferry.sidecar`)**, while keeping the Vue 3 + TypeScript renderer and `src/main` backend unified behind a runtime-agnostic `Host` abstraction (`electronHost` and `nodeHost`).

### Key Architectural Choices

1. **Runtime-Agnostic `Host` Abstraction (`src/main/host/host.ts`):**
   - Decouples services, stores, and IPC handlers from Electron APIs (`app`, `BrowserWindow`, `safeStorage`, `dialog`, `shell`, `autoUpdater`).
   - Preserves zero-code-duplication dual targets (`npm run build` for Electron; `npm run build:neutralino` / `package:neutralino` for Neutralino) until post-migration stabilization completes.
2. **Bidirectional `{ __b64 }` Sidecar RPC Bridge (`neutralinoApi.ts`, `protocol.ts`, `wsExtension.ts`):**
   - Routes `12` shell-owned invoke channels directly to Neutralino (`dialog:*`, `window:*`, `system:*`, `profile:report`) and forwards all `65` backend invoke channels (including `update:*` and `fs:local:stage-drop`) + `3` send channels + `18` event channels to the Node sidecar over Neutralino's one-time-token WebSocket extension protocol.
   - Enforces `readyTimeoutMs` (`15_000 ms`), `rpcTimeoutMs` (`120_000 ms`), and immediate pending-call rejection on `extClientDisconnect` / `serverOffline`.
3. **Least-Privilege Native Permissions (`neutralino.config.json`):**
   - Eliminates wildcard namespaces (`os.*`, `filesystem.*`, `app.*`) and restricts `nativeAllowList` strictly to the `15` explicit methods used by Ferry (`app.broadcast`, `app.exit`, `window.minimize`, `window.maximize`, `window.unmaximize`, `window.isMaximized`, `window.move`, `os.showOpenDialog`, `os.showFolderDialog`, `os.showSaveDialog`, `os.getPath`, `clipboard.readText`, `extensions.dispatch`, `extensions.getStats`, `debug.log`), blocking `os.execCommand`, `os.spawnProcess`, and `filesystem.*`.
4. **Native Addon Build Strategy (`vite.sidecar.config.mts`):**
   - Externalizes `.node` native addons (including `ssh2/lib/protocol/crypto/build/Release/sshcrypto.node` and optional `cpu-features`), `electron`, and `electron-updater` prior to CommonJS bundling, allowing `ssh2`'s built-in `try/catch` JS fallback using Node's native OpenSSL `crypto` module without compiling native C++ addons.
5. **Existing-User Credential & Data Continuity (`dpapiKey.ts`, `secretBox.ts`, `neutralino-installer.nsi`):**
   - Reads and writes Chromium's `%APPDATA%\Ferry\Local State` (`os_crypt.encrypted_key`) via Windows DPAPI and `v10` AES-256-GCM ciphertexts, preserving saved passwords, passphrases, jump-host secrets, proxy credentials, bookmarks, settings, history, and `known_hosts.json` across both upgrade and rollback.
   - The NSIS installer cleans legacy Electron runtime binaries (`Ferry.exe`, `*.pak`, `locales/`, `resources/`) during in-place upgrade without touching `%APPDATA%\Ferry`.
6. **Sidecar Auto-Updater (`src/main/update/SidecarUpdater.ts`):**
   - `SidecarUpdater` now checks canonical `latest.yml` and `Ferry-Setup-*.exe` (retiring `latest-neutralino.yml` and `Ferry-Neutralino-Setup-*.exe` in v0.24.0; `v0.23.1` Neutralino preview users perform a one-time manual `Ferry-Setup-0.24.0.exe` install preserving `%APPDATA%\Ferry`, while Electron `v0.22.x`/`v0.23.x` and Neutralino `v0.24.0+` update automatically). Both `nodeHost.ts` and `neutralinoApi.ts` inject `__FERRY_APP_VERSION__` from `package.json` at Vite build time, and `release-please-config.json` keeps `neutralino.config.json` synchronized across releases.
7. **External OS Drag-and-Drop Staging (`FilePane.vue`, `fs:local:stage-drop`, `LocalFsService.ts`):**
   - Stages external OS files/folders dropped onto WebView2 (when host file paths are hidden) into a validated `ferry-drop-*` temporary directory via `LocalFsService.stageDroppedEntries` (capped at `16 MB` to bound memory/Base64 IPC overhead; larger transfers use the Local pane).
   - `TransferQueue` and sidecar startup/shutdown automatically remove `ferry-drop-*` temporary directories after upload completion/cancellation and sweep stale directories on launch.

## Measured Results (Windows x64)

| Metric | Electron Baseline | Neutralino + Sidecar | Delta |
|---|---|---|---|
| NSIS Installer (`Ferry-*-Setup-0.22.0.exe` vs `0.14.9`) | `89.92 MB` (`94,287,880 B`) | `22.25 MB` (`23,325,589 B`) | **-75.26%** |
| Portable Compressed ZIP (`win-x64.zip`) | — | `33.30 MB` (`34,912,400 B`) | **-62.97%** vs Electron setup |
| Unpacked Distribution Size | `323.58 MB` (`339,303,409 B`) | `85.49 MB` (`89,646,568 B`) | **-73.58%** |
| Process RAM (`WorkingSet` at idle live boot) | Electron multi-process baseline | Host `36.12 MB` + Sidecar `46.49 MB` (`node.exe`) + OS shared `msedgewebview2.exe` `121.73 MB` | Split native + Node runtime |
| Live Renderer First Paint | — | `226.6 ms` (`profile:report` in `neutralinojs.log`) | Sub-250 ms UI boot |
| Sidecar Readiness (`spawn` to `sidecar:ready`) | — | `511.8 ms` (prototype) / `2.60 s` full packaged cold NSIS smoke | Clean `0` stdout bytes in `--nl-mode` |

## Consequences

- CI (`windows-latest`) executes `typecheck`, `test`, `build`, `build:neutralino`, `package:neutralino`, and `smoke:neutralino` (which exercises NSIS silent upgrade over a simulated Electron install directory, verifies DPAPI/sidecar RPC channels, and runs a live in-process `ssh2` SSH/SFTP/Transfer/Tail/PTY end-to-end flow against the installed binaries). Release workflow `.github/workflows/release.yml` publishes `Ferry-Neutralino-Setup-*.exe`, `Ferry-Neutralino-*-win-x64.zip`, and `latest-neutralino.yml` alongside Electron release assets.
- OS-level *drag-out* from inside the app (`system:startDrag` -> OS Explorer/Finder) is an accepted WebView2 platform limitation and intentionally a no-op under Neutralino (`neutralinoApi.ts`); users download files via in-app Remote -> Local pane drag, the Download toolbar action, or the Local pane's Explorer integration. In-app Local <-> Remote drag and external OS drag-*in* (`fs:local:stage-drop`, up to `16 MB`) are both supported.
- Windows-specific DPAPI secret protection assumes Windows x64 as the primary distribution target; non-Windows keychain adapters remain future work if macOS/Linux builds are added.

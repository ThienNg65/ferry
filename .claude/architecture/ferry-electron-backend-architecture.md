# Ferry — Electron Main-Process / IPC Architecture

Precedent reused throughout: [C:\toys\hot-deploy-flow](C:\toys\hot-deploy-flow) (same author, Electron+Vue+TS SSH tool). Its `ssh2`-direct approach, `RemoteShell` exec/sftp wrapper, `SshPool` connection lifecycle, `LogStreamManager` tail pattern, `contract.ts` IPC schema, and `contextBridge` preload are proven and adapted here rather than reinvented.

Footprint note: Electron's Chromium/Node baseline (~150MB+) is heavier than the Neutralino approach used previously for `hot-deploy-gui-1.0.1`. Accepted tradeoff per explicit direction to use Electron + Vue. Mitigations: single `BrowserWindow`, `sandbox: true`, no devtools/menu in production builds, minimal preload surface.

## 1. Process Architecture

- **Main process** owns everything privileged/stateful: SSH/SFTP connections (`ssh2.Client` pool), local filesystem access, saved-site persistence + secret encryption (`safeStorage`), the transfer queue, remote tail streams, remote exec (unzip), and the app-activity event bus. Renderer never touches Node/`fs`/`ssh2` directly.
- **Preload** (`src/preload/index.ts`) exposes a single narrow `window.api` object via `contextBridge.exposeInMainWorld`, with exactly `invoke(channel, ...args)`, `on(channel, listener) -> unsubscribe`, `off(channel, listener)`. Every channel string is validated against a whitelist derived from `src/shared/contract.ts` (`Object.values(INVOKE_CHANNELS)` / `EVENT_CHANNELS`) — unlisted channels are rejected at the bridge. No raw `ipcRenderer` is ever exposed. Copy `hot-deploy-flow/src/preload/index.ts` near-verbatim.
- **Renderer** (Vue 3 + Pinia) only calls `window.api.invoke(...)` / subscribes via `window.api.on(...)`. Zero knowledge of `ssh2`, `fs`, or credential storage.
- **BrowserWindow security flags** (mirror `hot-deploy-flow/src/main/index.ts`):
  ```ts
  webPreferences: {
    preload: PRELOAD_PATH,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false
  }
  ```
  Single `BrowserWindow` (multiple SSH sessions live inside one window, see §3). External links via `shell.openExternal` through `setWindowOpenHandler`. `Menu.setApplicationMenu(null)`; disable devtools in packaged builds.

## 2. SFTP/SSH Client Integration

Use **`ssh2` directly**, not `ssh2-sftp-client` — the latter only wraps the SFTP subsystem with no clean path to raw `exec` channels, which are required for both remote `tail -F` and remote `unzip`. A single `RemoteShell` wrapper around one `ssh2.Client` covers SFTP and exec with one dependency and one connection.

`RemoteShell` (adapted from `hot-deploy-flow/src/main/ssh/RemoteShell.ts`) exposes:
- `exec(cmd, opts)` — buffered stdout/stderr/exit-code, hard timeout + `AbortSignal` + retry (for unzip, mkdir, rename, delete, stat).
- `execLines(cmd, { onLine, onStderr, ... })` — streamed line callback with idle-timeout re-arming (for remote tail).
- `sftp()` — lazy `SFTPWrapper` (`client.sftp()`) for `readdir`, `stat`, `mkdir`, `rmdir`, `unlink`, `rename`, and `createReadStream`/`createWriteStream` for transfers (preferred over `fastGet`/`fastPut` — gives pause/resume, backpressure, and clean abort for large-file progress).

Every `RemoteShell` operation enforces a hard timeout, honors an `AbortSignal`, and can retry transient failures with backoff (`withRetry`) — a stuck remote command or network blip must not hang the window.

## 3. Connection/Session Model

Unlike the precedent's one-persistent-connection-per-DB-row model, Ferry needs ad hoc, possibly multiple concurrent connections (e.g. one for browsing, one for a tail view, even to the same site).

- `SessionManager` (singleton, `src/main/ssh/SessionManager.ts`) keyed by a **renderer-issued `sessionId` (UUID)**.
- Entry shape: `{ sessionId, siteId | null, client: ssh2.Client, shell: RemoteShell, status, cwdRemote, createdAt }`.
- `session:open` (invoke) takes a `siteId` (decrypted from the site store) or an ad-hoc quick-connect profile; returns `sessionId` + initial status.
- `session:close` destroys the client and aborts any transfers/tails bound to that session; broadcasts `disconnected`.
- Status changes broadcast on `session:status-change` (`{ sessionId, status: 'connecting'|'connected'|'error'|'disconnected', message? }`).
- **No silent auto-reconnect for browsing sessions** — stale directory listings and in-flight transfers make silent reconnect dangerous. On unexpected `close`, mark `error`/`disconnected` and let the user explicitly reconnect. Auto-reconnect is reserved for the tail subsystem only (§7).
- All subsequent IPC calls (`fs:remote:*`, `transfer:*`, `tail:*`, `unzip:run`) take `sessionId` first; main rejects with a `NOT_FOUND`/`SSH_CONNECT` error if the session isn't connected.

## 4. Site/Session Manager Persistence

- Saved connection profiles in `sites.json` under `app.getPath('userData')`, via `electron-store` (atomic writes, schema validation) — plain JSON, no relational DB needed.
- `Site` record: `{ id, name, host, port, username, authMethod: 'password'|'privateKey', remoteInitialPath, localInitialPath, createdAt, updatedAt }` plus an encrypted secrets blob:
  - `secretPassword?`, `secretPassphrase?` (base64 ciphertext)
  - `secretPrivateKey?` (base64 ciphertext, only if key *content* is pasted; if the user points to a key **file path** instead, store the path in plaintext metadata and read the file at connect-time — nothing to encrypt).
- Encryption: `safeStorage.encryptString(plaintext) -> Buffer`, stored base64; `safeStorage.decryptString(...)` at connect-time only, held in memory for the session's life, never returned to the renderer. Guard with `safeStorage.isEncryptionAvailable()` at startup. On Windows this is DPAPI-backed, tied to the OS user account — **no extra native dependency** (unlike `keytar`, which the precedent had to `asarUnpack` and prebuild against Electron's ABI). This removes a whole class of packaging pain.
- CRUD via `sites:list` / `sites:create` / `sites:update` / `sites:delete` — connecting decrypts secrets server-side only; the renderer only ever sees "is set" booleans for form UI, never plaintext secrets back.

## 5. Auth Methods

- **v1**: password auth, private-key auth (file path or pasted content) with optional passphrase. `ssh2`'s `ConnectConfig` accepts `privateKey: Buffer|string` + `passphrase` directly; read key file bytes in main via `fs.readFileSync`, never expose raw key material to the renderer.
- Support `keyboard-interactive` fallback (`client.on('keyboard-interactive', (...,finish) => finish([password]))`) since some servers require it even for "password" auth.
- **Deferred**: SSH agent forwarding / Pageant support. Not architecturally hard later (`ssh2` accepts an `agent:` named-pipe path, e.g. `\\.\pipe\pageant` or `\\.\pipe\openssh-ssh-agent`) but adds a third auth UI path not worth v1 scope. Keep `authMethod` as an extensible string union so adding `'agent'` is additive.

## 6. File Browsing & Transfer IPC

**Directory/file ops** (both local and remote need main-process mediation):

| Channel (invoke) | Payload → Result |
|---|---|
| `fs:local:list` | `{ path }` → `FileEntry[]` |
| `fs:local:mkdir` / `rename` / `delete` | `{ path, ... }` → `void` |
| `fs:remote:list` | `{ sessionId, path }` → `FileEntry[]` (`sftp.readdir`) |
| `fs:remote:mkdir` | `{ sessionId, path }` → `void` (`sftp.mkdir`) |
| `fs:remote:rename` | `{ sessionId, from, to }` → `void` (`sftp.rename`) |
| `fs:remote:delete` | `{ sessionId, path, isDir }` → `void` (`sftp.unlink`/`rmdir`; recursive delete implemented in main by listing+recursing, since SFTP has no native recursive rm) |

`FileEntry = { name, path, isDir, size, modifiedAt, permissions? }`.

**Transfers** — a `TransferQueue` per session, bounded concurrency (2–3), using `sftp.createReadStream`/`createWriteStream` piped through a throttled progress reporter (cancellation via `stream.destroy()`):

| Channel | Direction | Payload |
|---|---|---|
| `transfer:enqueue` | invoke | `{ sessionId, kind: 'upload'|'download', localPath, remotePath }` → `{ transferId }` |
| `transfer:cancel` | invoke | `{ transferId }` → `void` |
| `transfer:event` | event | `{ transferId, kind: 'queued'|'started'|'progress'|'done'|'error'|'cancelled', bytesTransferred?, totalBytes?, bytesPerSec?, etaMs?, error? }` |

Progress events throttled to ~150–250ms or ≥1% delta (computed in main, never per-chunk), with `bytesPerSec`/`etaMs` from a rolling window of recent byte deltas.

## 7. Remote Log Tailing (core differentiator)

Adapt `LogStreamManager` (`hot-deploy-flow/src/main/engine/LogStreamManager.ts`) into `TailManager.ts`, generalized to an arbitrary user-chosen remote path:

- `tail:start` (invoke): `{ tailId, sessionId, remotePath, historyLines? }`. Runs via `RemoteShell.execLines`:
  ```sh
  printf 'PID:%s\n' $$; exec tail -n <historyLines> -F '<remotePath>'
  ```
  **`-F`** (retry + follow-by-name), not plain `-f` — survives log rotation (file replaced) and reports truncation, directly addressing the "log panel doesn't tail live / handle rotation" pain point.
- PID-capture trick lets `tail:stop` kill the exact remote process (`kill <pid>`) — closing the SSH channel alone does not reliably kill a backgrounded remote process without a PTY.
- Lines stream via `tail:line` (`{ tailId, line }`); teardown via `tail:end` (`{ tailId, error? }`).
- Auto-reconnect **is** appropriate here (unlike browsing sessions): on transient drop, reconnect with exponential backoff (capped attempts, e.g. 5), re-running `tail -F` with `historyLines: 0` (don't replay history twice). Truncation is reported by `tail -F` itself via a stderr notice, surfaced as a `tail:notice` sub-event.
- `tail:stop` aborts the `AbortController`, best-effort kills the remote PID, fires `tail:end`.
- Idle reaper: streams idle beyond 30 min are reaped (same pattern as `LogStreamManager.ensureReaper`).
- On `session:close`, all tails bound to that session are stopped explicitly (avoids zombie map entries/duplicate `tail:end` races even though the channel dies with the connection anyway).

## 8. App-Side Live Activity Log

A separate, purely in-process `ActivityLog` singleton (`src/main/activity/ActivityLog.ts`) — not gated by any remote I/O:

- Emits structured events synchronously as `SessionManager`/`TransferQueue`/`RemoteShell` call sites fire them: `ActivityLog.emit({ kind, sessionId?, message, level, at })`.
- Kinds: `connect-start | connect-ok | connect-error | disconnect | transfer-start | transfer-done | transfer-error | tail-start | tail-end | unzip-start | unzip-done | unzip-error`.
- Broadcasts immediately via `activity:event` (`webContents.send`) — inherently async/non-blocking, so the log feels instant even when the underlying operation is slow.
- Bounded in-memory ring buffer (~2,000 entries) exposed via `activity:history` (invoke) so a freshly opened panel can backfill without a live event. Optional future addition: rotating NDJSON file under `userData/logs/` for post-mortem debugging — skip for MVP.

## 9. Remote Unzip Feature

`unzip:run` (invoke): `{ sessionId, archivePath, targetDir }` → `{ ok: true, stdout, stderr, exitCode }` via a buffered `RemoteShell.exec` (no streaming needed — `unzip -qo` produces negligible stdout by design):

```sh
sh -c "command -v unzip >/dev/null 2>&1 || { echo '__UNZIP_MISSING__' >&2; exit 127; }; unzip -qo '<archivePath>' -d '<targetDir>'"
```

- Detect "not installed": exit code `127` **and** stderr containing `__UNZIP_MISSING__` → dedicated `IpcErrorCode: 'UNZIP_NOT_FOUND'` with a friendly message ("`unzip` is not installed on this server — ask your admin to `apt/yum install unzip`."). Don't rely on exit 127 alone (also produced by `unzip`'s own failure modes in some shells).
- Any other non-zero exit surfaces `exitCode` + `stderr` verbatim (bad archive, disk full, permission denied).
- Fires `ActivityLog` events (`unzip-start`/`unzip-done`/`unzip-error`).
- Both `archivePath` and `targetDir` **must be shell-escaped** (single-quote + escape embedded `'`) before interpolation — never pass raw user input straight into the `sh -c` string.

## 10. Packaging

- **electron-builder** over electron-forge — the precedent already has a working config; forge means re-solving native-module/asar problems from scratch for no benefit.
- Target: NSIS installer (`win.target: [{ target: 'nsis', arch: ['x64'] }]`), `oneClick: false` + `allowToChangeInstallationDirectory: true` (behaves like a normal installer, not silent one-click).
- `ssh2` has native optional deps (`cpu-features` on some platforms) — mirror the precedent's `asarUnpack` list (`node_modules/ssh2/**/*`, `node_modules/cpu-features/**/*`, `node_modules/nan/**/*`); native `.node` binaries can't execute from inside an asar archive. `safeStorage` needs **no** unpacking — built into Electron, no native npm dependency, another advantage over `keytar` (which needed `npmRebuild: false` + prebuild-install gymnastics in the precedent).
- Auto-update: deferred — add `electron-updater` as a dependency and a no-op `checkForUpdatesAndNotify()` stub behind a feature flag, no publish/feed config until a distribution channel is chosen (GitHub Releases is the easy default later).

## 11. Project Scaffold

```
C:\toys\ferry\
  package.json
  tsconfig.json
  electron-builder.config.ts
  electron.vite.config.ts          (electron-vite, same tool as the precedent)
  src\
    main\
      index.ts                     bootstrap: app.whenReady, createWindow, registerAllHandlers
      ssh\
        SessionManager.ts          §3
        RemoteShell.ts             §2 (exec/execLines/sftp)
        errors.ts                  SshError + IpcErrorCode mapping
        retry.ts                   withRetry() helper (copied from precedent)
      fs\
        LocalFsService.ts
        RemoteFsService.ts
      transfer\
        TransferQueue.ts           §6
      tail\
        TailManager.ts             §7 (renamed from LogStreamManager)
      unzip\
        UnzipService.ts            §9
      activity\
        ActivityLog.ts             §8
      sites\
        SiteStore.ts               §4 (electron-store + safeStorage)
      ipc\
        envelope.ts                handle() wrapper → IpcResult (copied from precedent)
        sites.ipc.ts / session.ipc.ts / fs.ipc.ts / transfer.ipc.ts / tail.ipc.ts / unzip.ipc.ts / activity.ipc.ts
    preload\
      index.ts                     contextBridge whitelist (copied from precedent)
    renderer\                      (Vue app — see ferry-vue-frontend-architecture.md)
    shared\
      contract.ts                  INVOKE_CHANNELS / EVENT_CHANNELS / payload types — single source of truth
  resources\                       icons for electron-builder
```

- **TypeScript** project-wide — the `contract.ts` single-source-of-truth pattern only pays off with static typing on both sides of the IPC boundary; copy the precedent's typed `handle<T>()` wrapper and channel unions verbatim.
- **Build tooling**: `electron-vite` — dev server + main/preload/renderer builds in one config, matching the precedent, avoids hand-rolled webpack configs.
- Core dependencies: `ssh2`, `electron-store`, `vue`, `pinia`, `vue-router` not needed (see frontend doc). No `better-sqlite3`/`keytar` needed — `safeStorage` replaces `keytar` entirely, and there's no relational data heavy enough to need SQLite.

## Critical Reference Files

- `C:\toys\hot-deploy-flow\src\main\ssh\SshPool.ts` — connection lifecycle pattern to adapt into `SessionManager.ts`
- `C:\toys\hot-deploy-flow\src\main\ssh\RemoteShell.ts` — exec/execLines/sftp wrapper, directly reusable
- `C:\toys\hot-deploy-flow\src\main\engine\LogStreamManager.ts` — tail/PID-capture/reconnect/reaper pattern to adapt into `TailManager.ts`
- `C:\toys\hot-deploy-flow\src\shared\contract.ts` — IPC envelope/channel-contract pattern to replicate
- `C:\toys\hot-deploy-flow\src\preload\index.ts` and `C:\toys\hot-deploy-flow\src\main\ipc\envelope.ts` — contextBridge whitelist + `handle()` wrapper, copy near-verbatim
- `C:\toys\hot-deploy-flow\electron-builder.config.ts` — NSIS/asarUnpack packaging config to adapt (drop `keytar`/`better-sqlite3` unpack entries, keep `ssh2`/`cpu-features`/`nan`)

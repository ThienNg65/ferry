# Plan: Rust migration, milestone 1: russh spike + Tauri shell with Node sidecar

## Summary
Move Ferry from Electron to Tauri v2 while keeping the Vue renderer and `src/shared/contract.ts`
unchanged. The existing TypeScript backend (`src/main`) runs as a bundled Node sidecar process
behind the same channel contract. Before that, a time-boxed spike shows whether `russh` covers every
SSH auth path Ferry supports, and whether Rust can read secrets that Electron encrypted. Porting
backend domains from the sidecar into Rust is a later milestone and is not in this plan.

## User story
As a Ferry user, I want a smaller, lighter app that upgrades in place from my current install,
so that I keep my saved sites, passwords and host keys without re-entering anything.

## Problem → Solution
Ferry ships Electron: a 118 MB installer with a bundled Chromium and Node, and a 6.2k-line backend
tied to Electron APIs in 15 files. → Ferry ships a Tauri host (Rust, system WebView2) plus the same
backend running as a Node sidecar. The installer is under 50 MB, user data is read in place, and
the backend is decoupled so each domain can later move into Rust behind an unchanged contract.

## Metadata
- **Stack**: Electron 43 + Vue 3.5 + TypeScript (main/preload/renderer). `detect-stack-commands.sh`
  printed `stack=UNKNOWN` because this is not an Axin repo, so the validation commands below come
  from `package.json` scripts plus cargo.
- **Complexity**: Large
- **Source ticket**: N/A. User request in session, 2026-11-10.
- **Decisions taken with the user (2026-11-10)**:
  - Scope is the spike plus the Tauri shell, shippable at the end.
  - The backend runs as a Node sidecar during the transition.
  - Secrets are auto-migrated with no re-entry.

## Acceptance criteria
- [ ] R1: `.claude/report/rust-migration-spike.md` records pass/fail with evidence for russh against
  the Docker test container: password, private key, keyboard-interactive (2 prompts), Pageant agent,
  2-hop jump chain, SFTP readdir, a 100 MB download timed against the same download through `ssh2`,
  and an `exec` stream (`tail -F`). It ends in an explicit go/no-go for porting in milestone 2.
- [ ] R2: A site whose password was saved by the current Electron build connects in the Tauri build
  without the user re-entering it. A site saved in the Tauri build still decrypts after an app
  restart.
- [ ] R3: Under Tauri, every `INVOKE_CHANNELS` entry has exactly one handler, in either the Rust host
  or the sidecar, and every `EVENT_CHANNELS` event reaches the renderer. The renderer changes only in
  the bridge, `main.ts`, `index.html`, `TitleBar.vue`, `FilePane.vue`, `FileRow.vue` and
  `useDragAndDrop.ts`.
- [ ] R4: Sites, app settings, known hosts, bookmarks and history are read from and written to the
  existing Electron userData folder (`%APPDATA%\Ferry`) in the same JSON format, with no conversion
  step.
- [ ] R5: Window minimize/maximize/close with the `window:state-change` event, the three file dialogs,
  clipboard read, Downloads path, app version, open-in-default-app, open external link, dragging a
  local row out to Explorer, and dropping OS files onto the remote pane all work.
- [ ] R6: A Tauri build auto-updates to a newer Tauri build through a signed `latest.json`. The last
  Electron release (0.15.x) upgrades into the Tauri build, the old Electron install is removed, and
  user data is kept.
- [ ] R7: Release-please is unchanged. `release.yml`'s publish job builds the Tauri NSIS installer,
  its `.sig` and `latest.json`, and uploads them to the release-please release.
- [ ] R8: The packaged installer is under 50 MB (baseline 118 MB), and its size is recorded in the
  PR description.
- [ ] R9: `electron`, `electron-vite`, `electron-builder`, `electron-store` and `electron-updater`
  are gone from `package.json`, and `src/preload` plus `electron-builder.yml` are deleted.
- [ ] README.md, CLAUDE.md and `.claude/PROJECT_MAP.md` describe the Tauri + sidecar architecture
  and the new commands.

## Traceability
| Req | Requirement | Test row(s) | Task(s) |
|---|---|---|---|
| R1 | russh spike go/no-go | T10 | Task 1 |
| R2 | Secrets carry over | T1, T6, T10, M1 | Task 2, Task 6, Task 9 |
| R3 | Every channel routed, renderer barely touched | T2, T3, T4, T5, T8, T13 | Task 3, Task 5, Task 7, Task 10, Task 11, Task 12 |
| R4 | User data read in place | T5, M2 | Task 4, Task 9 |
| R5 | Host-native features | T9, M3, M4 | Task 11, Task 12 |
| R6 | Auto-update and Electron→Tauri upgrade | T11 | Task 13, Task 14 |
| R7 | Release pipeline | T11 | Task 14 |
| R8 | Installer < 50 MB | T12 | Task 8, Task 15 |
| R9 | Electron removed | T3 | Task 15 |
| enabling | Host abstraction that makes the backend Electron-free | T5, T8 | Task 3, Task 4 |
| enabling | Docs | n/a | Task 16 |

## Mandatory reading
| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/shared/contract.ts` | 813-935 | All 94 channel names. The bridge and router are keyed on these |
| P0 | `src/preload/index.ts` | 1-130 | The `window.api` surface the Tauri bridge must reproduce exactly |
| P0 | `src/main/ipc/envelope.ts` | 1-53 | `handle()` and the `{ok,data}`/`{ok:false,code,message,hostKey}` envelope |
| P0 | `src/renderer/src/api.ts` | 1-77 | How the renderer unwraps the envelope. Must keep working unchanged |
| P0 | `src/main/index.ts` | 167-238 | `registerAllHandlers()`: which registrations go to the host and which to the sidecar |
| P1 | `src/main/app/AppSettingsStore.ts` | 20-46 | safeStorage encrypt/decrypt (duplicated in SiteStore) |
| P1 | `src/main/tail/TailManager.ts` | 64-90 | Broadcast pattern repeated in 9 files |
| P1 | `src/main/ipc/system.ipc.ts` | 1-40 | startDrag/clipboard/downloads/version: moves to the Rust host |
| P1 | `src/renderer/src/components/files/FilePane.vue` | 455-520 | OS drop vs in-app drop, `getPathForFile` |
| P1 | `src/renderer/src/components/files/FileRow.vue` | 25-46 | Local rows start a native drag; remote rows use the in-app payload |
| P1 | `.github/workflows/release.yml` | 1-80 | Publish job to be switched from electron-builder to Tauri |
| P2 | `electron-builder.yml` | all | NSIS options, appId `com.ferry.app`, productName `Ferry`: carry over to `tauri.conf.json` |
| P2 | `.claude/PROJECT_MAP.md` | 97 | Integration-test setup (Docker container, `fileParallelism: false`) |

## Patterns to mirror

### IPC envelope
// SOURCE: src/main/ipc/envelope.ts:14-30
```ts
export function handle<T>(
  channel: InvokeChannel,
  fn: (...args: unknown[]) => Promise<T> | T
): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<IpcResult<T>> => {
    try {
      return ok(await fn(...args))
    } catch (e) {
      if (e instanceof SshError) {
        return err(e.code, e.message, e.hostKey)
      }
      const code: IpcErrorCode = 'UNKNOWN'
      return err(code, e instanceof Error ? e.message : String(e))
    }
  })
}
```
Keep the try/catch and the `ok`/`err` mapping. Only the registration target changes: `ipcMain` becomes
a `Map<channel, fn>` that the Electron entry (temporarily) and the sidecar dispatcher both read from.

### Event broadcast (repeated in 9 files)
// SOURCE: src/main/tail/TailManager.ts:64-71
```ts
  private broadcastLine(tailId: string, line: string): void {
    const payload: TailLineEvent = { tailId, line }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.tailLine, payload)
      }
    }
```
Each loop becomes `host().broadcast(EVENT_CHANNELS.tailLine, payload)`.

### Secret encryption (duplicated in AppSettingsStore and SiteStore)
// SOURCE: src/main/app/AppSettingsStore.ts:22-46
```ts
function encrypt(plaintext: string | undefined): string | undefined {
  if (!plaintext) {
    return undefined
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SshError('AUTH', 'OS credential encryption is unavailable on this machine')
  }
  return safeStorage.encryptString(plaintext).toString('base64')
}
```
Both copies become calls to one `src/main/host/secrets.ts`. The error messages and the `SshError('AUTH', …)`
codes stay the same.

### Preload bridge surface
// SOURCE: src/preload/index.ts:77-104
```ts
contextBridge.exposeInMainWorld('api', {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const allowed = ALLOWED_INVOKE_CHANNELS as readonly string[]
    if (!allowed.includes(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel: string, listener: IpcListener): () => void {
```
The Tauri bridge keeps the same whitelist rejection and the same `on` → unsubscribe shape.

### electron-store usage (5 stores)
// SOURCE: src/main/bookmarks/BookmarkStore.ts:16
```ts
      this._store = new Store<StoreSchema>({ name: 'bookmarks', defaults: { bookmarks: [] } })
```
This becomes `new Conf<StoreSchema>({ cwd: host().dataDir, configName: 'bookmarks', defaults: … })`.
`conf@10.2.0` is the library electron-store 8 already wraps (it's in `node_modules` today), with the same API and on-disk format.

### Test structure, Electron singletons mocked
// SOURCE: src/main/app/AppSettingsStore.test.ts:42-57
```ts
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: (plaintext: string) => Buffer.from(`ENC:${plaintext}`),
    decryptString: (buf: Buffer) => {
```
After Task 3, tests mock `../host/host` (or call `setHost(fakeHost)`) instead of `electron`.
Integration tests keep their `probeServer()` self-skip (`RemoteShell.integration.test.ts` header).

## Files to change
| File | Action | Justification |
|---|---|---|
| `spikes/russh-spike/` (Cargo bin, outside the app build) | CREATE | Task 1-2 spike. Deleted or kept unreferenced after the report |
| `.claude/report/rust-migration-spike.md` | CREATE | Spike evidence and go/no-go |
| `src/main/host/host.ts` | CREATE | `Host` interface + `setHost()`/`host()`: broadcast, encrypt/decrypt, dataDir, openPath |
| `src/main/host/electronHost.ts` | CREATE | Electron implementation, so the refactor lands while Electron still runs (removed again in Task 15) |
| `src/main/host/secrets.ts` | CREATE | Single encrypt/decrypt replacing the two duplicated copies |
| `src/main/host/secretBox.ts` + `.test.ts` | CREATE | Node AES-256-GCM in Electron's `v10` format, for the sidecar |
| `src/main/{tail,terminal,monitor,operations,transfer,edit}/*.ts`, `src/main/ssh/SessionManager.ts` | UPDATE | Broadcast loops → `host().broadcast`; `shell.openPath` → `host().openPath` |
| `src/main/{sites/SiteStore,app/AppSettingsStore,bookmarks/BookmarkStore,history/HistoryStore,ssh/KnownHostsStore}.ts` | UPDATE | electron-store → conf with `cwd: host().dataDir`; safeStorage → `secrets.ts` |
| matching `*.test.ts` for those stores | UPDATE | Mock target `electron-store`/`electron` → `conf`/host |
| `src/main/ipc/envelope.ts` | UPDATE | Register into a handler map instead of `ipcMain` |
| `src/main/ipc/registerSidecar.ts` | CREATE | `registerSidecarHandlers()`: every domain except dialog/system/window/update/profile |
| `src/shared/contract.ts` | UPDATE | Add `HOST_INVOKE_CHANNELS` (the 15 channels the Rust host owns). No channel renamed |
| `src/sidecar/index.ts`, `protocol.ts`, `nodeHost.ts` + tests | CREATE | Sidecar entry, NDJSON protocol, Node host implementation |
| `vite.sidecar.config.ts`, `vite.renderer.config.ts` | CREATE | Replace `electron.vite.config.ts` sections |
| `scripts/prepare-sidecar.mjs` | CREATE | Copy the pinned `node.exe` to `src-tauri/binaries/node-x86_64-pc-windows-msvc.exe` |
| `src-tauri/**` (`Cargo.toml`, `build.rs`, `tauri.conf.json`, `capabilities/default.json`, `src/main.rs`, `src/secret_key.rs`, `src/sidecar.rs`, `src/host_cmds.rs`, `windows/hooks.nsh`, `icons/`) | CREATE | Rust host |
| `src/renderer/src/bridge/tauriApi.ts` + `.test.ts` | CREATE | Installs `window.api` with the preload's surface on top of `@tauri-apps/api` |
| `src/renderer/src/main.ts` | UPDATE | Import the bridge first |
| `src/renderer/index.html` | UPDATE | CSP `connect-src` must allow `ipc: http://ipc.localhost` |
| `src/renderer/src/components/shell/TitleBar.vue` | UPDATE | `-webkit-app-region` → `data-tauri-drag-region` |
| `src/renderer/src/components/files/FilePane.vue`, `FileRow.vue`, `composables/useDragAndDrop.ts` | UPDATE | OS drop via Tauri drag-drop event; local drag-out via drag plugin; in-app remote→local drag via pointer events if Task 1's DnD check fails |
| `package.json` | UPDATE | Scripts (`dev`, `build`, `package` → tauri), add `@tauri-apps/api`, `@tauri-apps/cli`, `conf`, plugin JS packages; remove Electron deps |
| `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `.github/actions/setup-node-deps` | UPDATE | Rust toolchain, `cargo test`, tauri build/publish |
| `src/main/index.ts`, `src/preload/`, `src/main/update/AutoUpdater.ts`, `src/main/ipc/{dialog,system,window,update}.ipc.ts` (+tests), `electron.vite.config.ts`, `electron-builder.yml` | DELETE (Task 15) | Replaced by the Rust host |
| `README.md`, `CLAUDE.md`, `.claude/PROJECT_MAP.md` | UPDATE | New architecture and commands |

## Side effects and risks
| Side effect / risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Electron's Windows `safeStorage` format is not the assumed `v10` + AES-256-GCM with the key in `Local State` `os_crypt.encrypted_key` (DPAPI-wrapped, `DPAPI` prefix), e.g. Electron 43 uses app-bound `v20` | Medium | All saved passwords lost on upgrade | Task 2 proves it on a real ciphertext before any product code. If it fails, stop and fall back to the re-enter decision with the user |
| Sidecar writes non-protocol text to stdout (a dependency's `console.log`) | Medium | Corrupted responses, hung invokes | Sidecar entry redirects `console.log/info/debug` to stderr before importing anything. Protocol test T2 |
| Sidecar process crashes | Low | Whole backend gone, renderer hangs on pending invokes | Host rejects all pending invokes with `{ok:false, code:'UNKNOWN'}`, logs stderr, shows a fatal dialog and exits. No auto-restart in this milestone |
| Shipped `node.exe` is a general-purpose interpreter, which loses the protection of Electron Fuses `runAsNode:false` | Certain | Local LOLBin surface (same class as any installed Node) | Spawn with `NODE_OPTIONS` removed and an explicit script path. Accepted as transitional; it goes away when the sidecar is emptied (milestone 3) |
| Tauri `dragDropEnabled: true` (needed for OS file paths) disables HTML5 in-page DnD on Windows, which breaks remote→local row drag | High | Download-by-drag stops working | Task 1 checks it. Task 12 moves remote-row drag to pointer events, contained to `FileRow`/`FilePane`/`useDragAndDrop` |
| Renderer `localStorage` (theme, accent, dock height, hidden-local-pane) lives in Electron's Chromium profile, which Tauri's WebView2 profile can't see | Certain | Users lose display prefs once | Accepted. Listed in release notes. Not worth a LevelDB reader |
| Old Electron install left behind after upgrade, giving two Start-menu entries | Medium | Confusing duplicate app | NSIS `NSIS_HOOK_PREINSTALL` runs the old electron-builder uninstaller silently (`QuietUninstallString` from its Uninstall registry key). electron-builder keeps userData by default (`deleteAppDataOnUninstall` unset). Verified by M6 on a clean VM |
| electron-updater in 0.15.x may not accept the Tauri NSIS installer as an update | Medium | Existing users stranded on Electron | Bridge release (Task 14): publish a `latest.yml` (sha512 + size) pointing at the Tauri installer. Verified by M6. Fallback is a release-notes link to a manual download |
| CSP meta tag blocks Tauri IPC | Certain if missed | Blank app, every invoke fails | Task 10 updates `index.html` `connect-src` |
| WebView2 missing on old Windows 10 | Low | App won't start | `bundle.windows.webviewInstallMode: downloadBootstrapper` |
| Hard cutover, no feature flag | Certain | Rollback = reinstall previous release | Tauri→Tauri updates are reversible by publishing a fix. The Electron→Tauri step is one-way. M6 gates the release |
| Test coverage | n/a | n/a | All existing vitest suites keep running against the same TS backend; new protocol/bridge/secret tests added; Rust host gets cargo unit tests |

## Affected services
| Service/Repo | Relationship | Why touched | Confidence |
|---|---|---|---|
| `ferry` (this repo), Electron desktop app | Owner | Shell, packaging and backend wiring all change | Confirmed |
| GitHub Releases feed (`ThienNg65/ferry`) | Update channel for every installed client | Asset set changes (`latest.yml` → `latest.json` + `.sig`), with a one-time bridge release | Confirmed (`electron-builder.yml` publish block, `release.yml`) |
| Users' `%APPDATA%\Ferry` data (`sites.json`, `app-settings.json`, `known_hosts.json`, `bookmarks.json`, `history.json`, `Local State`) | Shared on-disk state between old and new builds | Read and written in place, same format | Confirmed (`new Store` call sites listed above). Exact folder casing/name verified in Task 2 |
| SignPath dormant signing stage | CI consumer of the built installer | Artifact name/path changes | Confirmed (`release.yml` dormant stage) |

## Security
| Concern | Evidence | Mitigation |
|---|---|---|
| Secrets crossing a process boundary | Today secrets never leave main decrypted (`CLAUDE.md` "Secrets never cross the IPC boundary decrypted") | The data key goes host→sidecar once, over the sidecar's stdin (never argv/env, which show up in process listings). The renderer still only gets `hasPassword` booleans. No log line prints key or plaintext |
| Encryption at rest | `AppSettingsStore.ts:22-46`, `SiteStore.ts:62-80` | Same key (Electron's DPAPI-wrapped `Local State` key), same `v10` AES-256-GCM format, so ciphertexts stay valid for both old and new builds. Fresh installs create a new 32-byte key, DPAPI-protected, in `ferry-secret-key.bin` |
| Renderer → backend authorization | Preload whitelist `src/preload/index.ts:77-84` | Bridge keeps the whitelist. Rust `ipc` command accepts only `INVOKE_CHANNELS` names. Tauri capabilities grant only the plugins used (dialog open/save, clipboard read-text, opener, updater, drag, window controls) |
| Input validation | Handlers cast `args` as today (`fs.ipc.ts:32-33`) | Unchanged: the same TS handlers run. Host-native Rust commands validate types through serde |
| CSP | `src/renderer/index.html:9-12` | Keep `script-src 'self'`; add only `ipc: http://ipc.localhost` to `connect-src` |
| Code-signing / update integrity | electron-updater checks the sha512 in `latest.yml` | Tauri updater verifies a minisign signature. Private key lives in GitHub secret `TAURI_SIGNING_PRIVATE_KEY` (+ password), public key in `tauri.conf.json` |
| Navigation / new windows | `src/main/index.ts:94-114` blocks all navigation and opens only http(s) externally | `on_navigation` allows the app origin only; new windows go through the opener for http(s) only (Task 8) |
| Process hardening | Electron Fuses in `electron-builder.yml` | No equivalent for a sidecar `node.exe`. See risk table. Spawned with `NODE_OPTIONS` removed |

## NOT building
- Porting any backend domain to Rust (sites, fs, SSH, transfer, tail, terminal…). That's milestone 2 and later; the spike only informs it.
- Rust types generated from `contract.ts` (or the other way round). Host-native commands are hand-written for 15 channels.
- Migrating renderer `localStorage` prefs from the Electron profile.
- Sidecar auto-restart, macOS/Linux builds, a multi-window app.
- Re-porting the startup profiler (`profile:report`). The host answers it with `null`.
- Changing any channel name, payload shape or renderer store.
- Code-signing changes beyond repointing the dormant SignPath stage at the new artifact path.

## Step-by-step tasks

### Phase 0: Spike (time-boxed to 3 days; product code untouched)

### Task 1: russh capability spike
- **ACTION**: Create `spikes/russh-spike` (own `Cargo.toml`, not referenced by the app). One subcommand
  per scenario against the Docker container from `RemoteShell.integration.test.ts`'s header: password,
  ed25519 key, keyboard-interactive answering 2 prompts, Pageant agent, 2-hop jump chain
  (`channel_open_direct_tcpip` + session over the channel stream), `russh-sftp` readdir + 100 MB
  download (time it against the same file through `ssh2` in a 20-line Node script), and `exec "tail -F"`
  streaming. Also build a 30-line Tauri hello app with `dragDropEnabled: true`, and record whether
  HTML5 `dragstart`/`drop` between two divs still fires on Windows (this decides Task 12's pointer
  rewrite).
- **MIRROR**: none. Throwaway spike code. Scenarios mirror `SessionManager.jumphost.integration.test.ts`.
- **GOTCHA**: Pageant can't be scripted in CI. Run it by hand following `SessionManager.agent.integration.test.ts`'s manual QA header.
- **VALIDATE**: T10: `.claude/report/rust-migration-spike.md` (rust-migration-spike.md) has pass/fail plus a log excerpt per scenario and a go/no-go line.

### Task 2: Legacy secret decryption spike
- **ACTION**: Add a `decrypt-legacy` subcommand: read `%APPDATA%\Ferry\Local State` → `os_crypt.encrypted_key`
  → base64 → strip `DPAPI` → `CryptUnprotectData` (crate `windows`, feature `Win32_Security_Cryptography`)
  → AES-256-GCM decrypt one `secretPassword` from `sites.json` (base64 → `v10` | 12-byte nonce | ciphertext | 16-byte tag).
  Record the exact userData folder name and the ciphertext prefix in the report.
- **MIRROR**: none. Format is from Chromium `os_crypt` (win).
- **GOTCHA**: Never print the decrypted value; print `len` + `ok`. If the prefix is `v20` or decryption fails: **stop**, put the evidence to the user, and switch R2 to "re-enter".
- **VALIDATE**: T10: rust-migration-spike.md shows `ok` for one real secret and confirms the folder path.

### Phase 1A: Make the backend Electron-free (Electron still runs; each task ships green)

### Task 3: Host abstraction + handler registry
- **ACTION**: Create `src/main/host/host.ts`:
  `interface Host { broadcast(channel: string, payload: unknown): void; encrypt(p: string): string; decrypt(c: string): string; isEncryptionAvailable(): boolean; dataDir: string; openPath(p: string): Promise<string> }`
  with `setHost`/`host()`. Create `electronHost.ts` from the existing loops and `safeStorage` calls. Create
  `secrets.ts` with the `encrypt`/`decrypt` functions moved verbatim from `AppSettingsStore.ts:22-46`,
  calling `host()`. Delete the duplicates in both stores. Replace every `BrowserWindow.getAllWindows()` broadcast in
  EditSessionManager, MonitorManager (2), OperationRegistry, SessionManager (3), TailManager (3),
  TerminalManager (2) and TransferQueue with `host().broadcast`. Replace `shell.openPath` in
  `EditSessionManager.ts:57,68,102,155` with `host().openPath`. Change `envelope.ts` so `handle()` stores into an
  exported `handlers` map, and `src/main/index.ts` loops the map into `ipcMain.handle`. Move all domain
  registrations except dialog/system/window/update/profile into `registerSidecar.ts`. Add
  `HOST_INVOKE_CHANNELS` to `contract.ts` (dialog ×3, system ×4, window ×4, update ×3, profileReport).
- **MIRROR**: IPC envelope; Event broadcast; Secret encryption.
- **GOTCHA**: `handleWithEvent` (only used by `system:startDrag`) imports `ipcMain`. Move it and its import into `src/main/ipc/system.ipc.ts`, so `envelope.ts` has no `electron` import (otherwise T3 fails and the sidecar bundle drags in `electron`).
- **VALIDATE**: `npm run typecheck && npm test` (T8 green: integration suites plus all existing unit suites updated to mock `host` instead of `electron`). `npm run dev` smoke: connect, tail, terminal.

### Task 4: electron-store → conf
- **ACTION**: Add `conf@10.2.0` as a direct dependency (the version already installed under electron-store). In the 5
  stores, replace `new Store({ name, defaults })` with `new Conf({ cwd: host().dataDir, configName: name, defaults })`.
  `electronHost.dataDir = app.getPath('userData')`. Update the store tests' `vi.mock('electron-store')` → `vi.mock('conf')`.
- **MIRROR**: electron-store usage.
- **GOTCHA**: electron-store sets `projectSuffix: ''`. With `cwd` given, conf ignores the suffix. Confirm the file lands at the same path (T5).
- **VALIDATE**: `npx vitest run src/main/app/AppSettingsStore.test.ts src/main/bookmarks src/main/history src/main/sites src/main/ssh/KnownHostsStore.test.ts` (T5: AppSettingsStore.test and the other store tests green); `npm run dev` shows existing saved sites.

### Phase 1B: Node sidecar

### Task 5: secretBox (Node implementation of the Electron format)
- **ACTION**: `src/main/host/secretBox.ts`: `createSecretBox(key: Buffer)` returns `{ encrypt, decrypt }`, using
  `crypto.createCipheriv('aes-256-gcm')`. Output is base64(`'v10'` + 12-byte random nonce + ciphertext + tag). Decrypt
  rejects other prefixes and a bad tag with `SshError('AUTH', 'Could not decrypt a saved secret: …')`.
- **MIRROR**: Secret encryption (error texts).
- **VALIDATE**: `npx vitest run src/main/host/secretBox.test.ts` (T1).

### Task 6: Sidecar entry + protocol
- **ACTION**: `src/sidecar/protocol.ts` reads NDJSON from stdin. The first line is `{"type":"init","key":"<b64>","dataDir":"…"}`,
  then `{"id":n,"channel":c,"args":[…]}`. It replies `{"id":n,"result":IpcResult}` via the `handlers` map
  (unknown channel → `err('UNKNOWN', …)`). `nodeHost.ts` implements `broadcast` as the stdout line
  `{"event":c,"payload":p}`, encrypt/decrypt via secretBox, and `openPath` via `spawn('explorer.exe', [p])`
  (shortcut: Windows-only, upgrade when a non-Windows build is planned). `src/sidecar/index.ts`
  redirects `console.log/info/debug` to stderr **first**, then `setHost`, then `registerSidecarHandlers()`.
  It must not call `KnownHostsStore`/`TransferQueue` init (from `src/main/index.ts` bootstrap) before init arrives.
  **After init** it runs the same post-start steps as `src/main/index.ts:128-143`: `initHistoryRecorder()`,
  `TransferQueue.getInstance().setBandwidthLimitKBps(AppSettingsStore.getInstance().get().bandwidthLimitKBps)` and
  the `KnownHostsStore.getInstance()` warm-up in try/catch. `initAutoUpdater` moves to the host (Task 13).
  **Binary payloads**: JSON turns a `Uint8Array` into `{type:'Buffer',data:[...]}`, and `TerminalDataEvent.data`
  (`contract.ts:589-592`) is a `Uint8Array`. The protocol's stringify replacer encodes any `Uint8Array`/`Buffer` as
  `{"__b64":"..."}`, and `bridge/tauriApi.ts` (Task 10) decodes it back to `Uint8Array` before calling listeners.
  **Shutdown**: on `{"type":"shutdown"}` **or stdin EOF** (host gone), run `HistoryStore.getInstance().flush()` then
  `await EditSessionManager.getInstance().disposeAll()` (same order as `src/main/index.ts:300-314`), then
  `process.exit(0)`. This also stops an orphaned `node.exe` from keeping SSH sessions open.
  `openPath`: check `fs.existsSync(p)` first and return `Could not open ...: not found` as the error string
  (EditSessionManager treats a non-empty result as failure, as with `shell.openPath`).
- **MIRROR**: IPC envelope.
- **GOTCHA**: Calls overlap: never await one request before reading the next line.
- **VALIDATE**: `npx vitest run src/sidecar/protocol.test.ts src/sidecar/channelCoverage.test.ts` (T2 protocol.test, T3 channelCoverage.test).

### Task 7: Sidecar build
- **ACTION**: `vite.sidecar.config.ts` (`build.ssr: 'src/sidecar/index.ts'`, `ssr.noExternal: true`, output `out/sidecar/index.cjs`,
  `cpu-features` external because ssh2 loads it in try/catch). `scripts/prepare-sidecar.mjs` copies `process.execPath` to
  `src-tauri/binaries/node-x86_64-pc-windows-msvc.exe`. npm script `build:sidecar`.
- **MIRROR**: `electron.vite.config.ts` main section (externals list).
- **GOTCHA**: ssh2's optional `sshcrypto.node` must also stay external. Pure-JS fallback is fine. `process.execPath` is whatever Node runs the build, so pin an exact `node-version` (22.14.0, matching PROJECT_MAP) in `.github/actions/setup-node-deps`. The shipped runtime and the installer size depend on it.
- **VALIDATE**: `npm run build:sidecar`, then `echo '{"type":"init",…}' | node out/sidecar/index.cjs` replies to a `sites:list` line (manual), plus T2.

### Phase 1C: Tauri host

### Task 8: Scaffold src-tauri + renderer vite config
- **ACTION**: `vite.renderer.config.ts` copies the `renderer` section of `electron.vite.config.ts` (root, plugins, aliases), with
  `server.port: 5173, strictPort: true`. `src-tauri/tauri.conf.json`: `productName: Ferry`, `identifier: com.ferry.app`,
  window 1280×800, `minWidth: 900`, `minHeight: 600`, `backgroundColor: "#18181b"` (from `src/main/index.ts:66-72`), `decorations: false`, `dragDropEnabled: true`, `build.devUrl/frontendDist`,
  `bundle.externalBin: ["binaries/node"]`, `bundle.resources: {"../out/sidecar/index.cjs": "sidecar/index.cjs"}`,
  NSIS `installMode: both`, `webviewInstallMode: downloadBootstrapper`.
  Reuse `resources/icon.ico`/`1024x1024.png` (`npx tauri icon`). Pin Tauri 2.x crates/JS packages to the
  current latest at implementation time.
- **MIRROR**: `electron-builder.yml` (appId, productName, NSIS options).
- **Navigation guard**: build the main window in `main.rs` with `WebviewWindowBuilder::on_navigation`, allowing only
  the app origin (`tauri://localhost`, `http://tauri.localhost`, and the dev URL in debug). New-window requests open
  through the opener plugin for `http:`/`https:` only and are otherwise denied. This mirrors `src/main/index.ts:94-114`.
- **GOTCHA**: the old installer allowed per-user or per-machine (`oneClick: false`, `allowElevation: true`). Use `installMode: both` so the Task 14 hook can remove an HKLM install.
- **VALIDATE**: `npx tauri dev` opens a window showing the renderer (IPC not wired yet).

### Task 9: Secret key + data dir in Rust
- **ACTION**: `src-tauri/src/secret_key.rs`: `legacy_data_dir()` = `%APPDATA%\Ferry` (name confirmed in Task 2).
  `load_key(dir)`: if `Local State` has `os_crypt.encrypted_key`, DPAPI-unwrap it; else read or create
  `ferry-secret-key.bin` (32 random bytes, DPAPI-protected). Code ported from the spike.
- **MIRROR**: Task 2 spike code.
- **GOTCHA**: never log the key. `Local State` is read-only for us; never write it.
- **VALIDATE**: `cargo test --manifest-path src-tauri/Cargo.toml secret_key` (T6, tests in secret_key.rs).

### Task 10: Sidecar supervisor + ipc router + bridge
- **ACTION**: `src-tauri/src/sidecar.rs` spawns via `tauri-plugin-shell` sidecar `node` with
  `[resource_dir/sidecar/index.cjs]`, `NODE_OPTIONS` removed, and writes the init line. A pending
  `HashMap<u64, oneshot::Sender>` correlates responses. Stdout `event` lines go to `app.emit(channel, payload)`;
  stderr goes to the log. If the sidecar exits unexpectedly: fail all pending, then show a fatal dialog. On window close /
  `RunEvent::ExitRequested`: send `{"type":"shutdown"}`, wait up to 3 s for the child to exit, then kill it. `#[tauri::command] ipc(channel, args)`
  handles `HOST_INVOKE_CHANNELS` in Rust and forwards everything else. Renderer: `bridge/tauriApi.ts` sets
  `window.api = { invoke, on, off, getPathForFile: () => '', getPreloadTime }` using `invoke('ipc', …)` and
  `listen`, with the contract whitelist. Before calling a listener it decodes `{"__b64":...}` values back to `Uint8Array` (recursively). `main.ts` imports it first. `index.html` CSP adds `ipc: http://ipc.localhost`
  to `connect-src`.
- **MIRROR**: Preload bridge surface; IPC envelope (Rust returns the same `{ok,…}` JSON for host channels).
- **GOTCHA**: `listen()` is async but the preload's `on()` returns its unsubscribe synchronously. Return a function that awaits the pending unlisten promise.
- **VALIDATE**: `cargo test --manifest-path src-tauri/Cargo.toml sidecar` (T7, tests in sidecar.rs), `npx vitest run src/renderer/src/bridge/tauriApi.test.ts` (T4 tauriApi.test), then `npx tauri dev`: connect to the Docker container, browse, tail, terminal.

### Task 11: Host-native channels
- **ACTION**: `src-tauri/src/host_cmds.rs` covers window min/max-toggle/close/isMaximized plus `window:state-change` on resize
  (`tauri::WindowEvent::Resized`), dialogs (`tauri-plugin-dialog`), clipboard read (`tauri-plugin-clipboard-manager`),
  Downloads path (`app.path().download_dir()`), app version, `profile:report` → `null`, and external links
  (`tauri-plugin-opener`). `capabilities/default.json` grants only these. `TitleBar.vue`: replace
  `style="-webkit-app-region: drag"` with `data-tauri-drag-region`; remove the `no-drag` styles.
- **MIRROR**: Return shapes from `src/main/ipc/{dialog,system,window}.ipc.ts`.
- **VALIDATE**: `cargo test --manifest-path src-tauri/Cargo.toml host_cmds` (T9, tests in host_cmds.rs); `npx vitest run src/shared/hostChannels.test.ts` (T13 hostChannels.test); M3 by hand.

### Task 12: Drag and drop
- **ACTION**: Local row drag-out: `FileRow.vue` `onDragStart` (local) calls `startDrag({ item: [path], icon })`
  from `@crabnebula/tauri-plugin-drag` instead of `systemStartDrag`. OS drop: `FilePane.vue` subscribes to
  `getCurrentWebview().onDragDropEvent`; on `drop`, `document.elementFromPoint(position)` picks the pane, and the
  existing `onOsDrop` logic runs with `paths` instead of `getPathForFile`. Tauri gives only paths, so get
  `name` from the basename and `isDir` by calling the existing `fs:local:list` on each distinct parent folder and
  matching by name. No new channel is needed. If Task 1 showed HTML5 DnD is dead, move **both** row kinds in
  `FileRow`/`FilePane`/`useDragAndDrop` from `dragstart`/`drop` to `pointerdown`/`pointermove`/`pointerup`,
  keeping the module-scoped payload. Remote rows drop in-app. Local rows call the plugin's `startDrag` from
  `pointermove` once the pointer has moved more than 5 px.
- **MIRROR**: `useDragAndDrop.ts` module-scoped payload; `FilePane.vue:478-495` `onOsDrop`.
- **GOTCHA**: `onDragDropEvent` positions are physical pixels. Divide by `devicePixelRatio` before `elementFromPoint`.
- **VALIDATE**: M4 by hand (in, out, remote→local).

### Task 13: Updater
- **ACTION**: `tauri-plugin-updater` + `tauri-plugin-process`. Map `update:check/getStatus/installNow` and the
  `update:available/downloaded/status` events to the same payloads `src/main/update/AutoUpdater.ts` emits.
  Updater endpoint: `https://github.com/ThienNg65/ferry/releases/latest/download/latest.json`.
  Generate a keypair (`npx tauri signer generate`). Pubkey goes in config; the private key goes to a repo secret (user does this).
  Carry over `AutoUpdater.ts:76-140`: a check on startup and every 6 h, auto-download, and install on quit (when an update is
  downloaded, install it from the `ExitRequested` handler after the sidecar shutdown). Skip the checks when
  `autoCheckUpdates === false`. The host reads that setting by forwarding `settings:get` to the sidecar, so there's
  still a single owner of `app-settings.json`.
- **MIRROR**: Status payload shapes in `AutoUpdater.ts`.
- **GOTCHA**: dev builds must no-op, as `app.isPackaged` does today (`cfg!(debug_assertions)`). The updater runs the NSIS installer and exits the process, so send the sidecar shutdown first or `node.exe` stays locked and the install fails.
- **VALIDATE**: T11 (M5).

### Task 14: Release pipeline + Electron bridge release
- **ACTION**: `release.yml` publish job: add `dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache`, run `npm run build:sidecar`
  and the sidecar prep, then `tauri-apps/tauri-action` with `tagName: ${{ needs.release-please.outputs.tag_name }}` (uploads
  the installer, `.sig` and `latest.json` to the existing release). Also generate a `latest.yml`
  (version, path, sha512, size of the NSIS exe) so 0.15.x electron-updater clients pick up the Tauri installer.
  `src-tauri/windows/hooks.nsh` `NSIS_HOOK_PREINSTALL` finds the old install under
  `Software\Microsoft\Windows\CurrentVersion\Uninstall\<GUID>`, where the GUID is electron-builder's UUIDv5 of appId
  `com.ferry.app`. Compute it once in Task 14 from a real 0.15.x install's registry and hard-code it. Check **HKCU then
  HKLM**. Run `ExecWait '"$oldUninstaller" /S _?=$oldInstDir'` so the old uninstaller finishes before Tauri creates
  its `Ferry.lnk` shortcuts (without `_?=` it runs in the background and can delete the new shortcuts), then delete
  `$oldInstDir`. Old per-machine installs (HKLM) need elevation, which is why Task 8 sets `installMode: both`. Repoint the SignPath stage glob. `ci.yml` `verify` job: add `cargo test` + `cargo clippy -D warnings`.
  Version sync: release-please must also bump `src-tauri/tauri.conf.json` `version` (an `extra-files` entry in `release-please-config.json`).
- **MIRROR**: existing `release.yml` retry/caching structure.
- **GOTCHA**: electron-updater verifies `sha512` (base64), not hex.
- **VALIDATE**: T11 (M5, M6 on a clean Windows VM).

### Task 15: Remove Electron
- **ACTION**: Delete `src/main/index.ts`, `src/main/host/electronHost.ts`, `src/preload/`, `src/main/update/`, the Electron
  `dialog/system/window/update.ipc.ts` (+tests), `electron.vite.config.ts` and `electron-builder.yml`. Remove the Electron deps; update the
  `tsconfig.node.json` includes. Scripts: `dev` = `tauri dev`, `build` = `build:sidecar && vite build -c vite.renderer.config.ts`,
  `package` = `tauri build`. Record the installer size.
- **MIRROR**: none. Deletion only.
- **VALIDATE**: `npm run typecheck && npm test && npm run package` (final gate). T3 still green. `grep -r "from 'electron'" src` is empty. T12 (M7).

### Task 16: Docs
- **ACTION**: Update README (install/dev commands, Rust toolchain prerequisite), CLAUDE.md (architecture section: Tauri
  host + sidecar, host vs sidecar channel split, `HOST_INVOKE_CHANNELS`), and PROJECT_MAP (tech stack, directory map,
  gotchas: stdout discipline, CSP, drag-drop, data dir). Release notes mention the one-time loss of display prefs.
- **MIRROR**: none. Docs only.
- **VALIDATE**: docs mention every new command in Validation commands.

## Testing strategy
| # | Req | Test class (existing or new path) | Scenario | Expected | Fails today because |
|---|---|---|---|---|---|
| T1 | R2 | `src/main/host/secretBox.test.ts` (new) | Ciphertext built in-test as `v10`+nonce+GCM with a known key; also round-trip, a tampered tag and a wrong prefix | Decrypts to the plaintext; tamper/prefix → `SshError` code `AUTH` | `secretBox.ts` doesn't exist |
| T2 | R3 | `src/sidecar/protocol.test.ts` (new) | Feed init + two overlapping request lines; a handler throws `SshError('HOST_KEY_MISMATCH')`; unknown channel; `host().broadcast` of a `terminal:data` event with bytes `[0xff,0x00,0x1b]`; post-init steps; `shutdown` line and stdin EOF | Replies matched by id in completion order; error keeps code+hostKey; unknown → `UNKNOWN`; event line carries `{"__b64":"/wAb"}`; `initHistoryRecorder` + bandwidth limit applied after init; shutdown flushes history and calls `disposeAll` before exit; nothing else on stdout | No sidecar exists |
| T3 | R3, R9 | `src/sidecar/channelCoverage.test.ts` (new) | `registerSidecarHandlers()` then compare against `INVOKE_CHANNELS` minus `HOST_INVOKE_CHANNELS` | Exact set equality; module graph imports no `electron` | Registration is tied to `ipcMain` in `src/main/index.ts` |
| T4 | R3 | `src/renderer/src/bridge/tauriApi.test.ts` (new) | Mock `@tauri-apps/api/core` + `/event`; call `invoke` on a valid and an invalid channel; `on` then unsubscribe; `on` for every `EVENT_CHANNELS` value; a `terminal:data` payload with `{__b64}` | Valid → `invoke('ipc',{channel,args})`; invalid rejects `IPC channel not allowed`; unsubscribe calls unlisten; every event name subscribed via `listen` and valid for Tauri (`/^[A-Za-z0-9\-\/:_]+$/`); listener gets a `Uint8Array` with the same bytes | Bridge doesn't exist |
| T5 | R4 | Existing store tests: `AppSettingsStore.test.ts`, `BookmarkStore.test.ts`, `HistoryStore.test.ts`, `SiteStore.test.ts`, `KnownHostsStore.test.ts` (updated mocks) | Same assertions with `conf`/host mocked | Green | regression guard: passes today on electron-store |
| T6 | R2 | `src-tauri/src/secret_key.rs` `#[cfg(test)]` (new) | Temp dir with a `Local State` whose key was DPAPI-protected in-test; dir without one | Same 32 bytes back; key file created once, reused on second call | Module doesn't exist |
| T7 | R3 | `src-tauri/src/sidecar.rs` `#[cfg(test)]` (new) | Pure line parser: response line, event line, garbage line | Routed to pending id / emitted / logged-and-ignored | Module doesn't exist |
| T8 | R3 | Existing integration suites `RemoteShell`/`SessionManager`/`jumphost`/`TransferQueue` `.integration.test.ts` | Run against the Docker container after Task 3/4 | Green (self-skip without Docker) | regression guard: passes today |
| T9 | R5 | `src-tauri/src/host_cmds.rs` `#[cfg(test)]` (new) | Every name in the Rust `HOST_CHANNELS` const | Matched by a host handler; any other name → forward | Module doesn't exist |
| T13 | R3 | `src/shared/hostChannels.test.ts` (new) | Read `src-tauri/src/host_cmds.rs` as text, extract the `HOST_CHANNELS` string literals | Equal to `HOST_INVOKE_CHANNELS` from `contract.ts` (no drift between Rust and TS lists) | Neither list exists |
| T10 | R1, R2 | `.claude/report/rust-migration-spike.md` (spike evidence) | Scenarios in Task 1-2 | Pass/fail + evidence per row, go/no-go | Spike not run |
| T11 | R6, R7 | Manual on a packaged build (M5, M6 below) | Tag release N, then N+1, via release.yml; separately upgrade a 0.15.x Electron install on a clean VM | Update toast → install → restart at N+1; Electron→Tauri lands with data intact | No Tauri updater or bridge release exists |
| T12 | R8 | Manual: size of the NSIS exe from `npm run package` (M7) | Package after Task 15 | < 50 MB | Electron installer is 118 MB |

Manual checks on a packaged build (fill in during Task 15):

- **M1** (R2): Install 0.15.x, save a password site, upgrade to the Tauri build, connect without a prompt; save a new password, restart, connect
- **M2** (R4): After the upgrade: sites, groups, bookmarks, history, known-hosts (no TOFU prompt for known server) all present; a new transfer then shows up in History and the saved bandwidth cap applies
- **M3** (R5): Title-bar drag, min/max/close, maximize-state icon flips, the 3 dialogs, clipboard paste in terminal, external link opens browser, Edit opens default app
- **M4** (R5): Drag file+folder from Explorer onto remote pane uploads; drag local row to Explorer copies; drag remote row to local pane downloads
- **M5** (R6, R7): Release N installs, release N+1 is published, app shows update toast, installs **while an SSH session is connected**, restarts at N+1, and no `node.exe` is left running
- **M6** (R6): Clean VM with 0.15.x: auto-update lands on the Tauri build, one Start-menu entry remains, data intact; repeat with an old **per-machine** install
- **M7** (R8): `dist` NSIS installer size < 50 MB recorded

## Validation commands
| Command | When | Expect |
|---|---|---|
| `npm run typecheck` | **final gate** | zero errors |
| `npm test` | **final gate** | all suites green (integration self-skip without Docker) |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **final gate** | all green |
| `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | **final gate** | zero warnings |
| `npm run package` | **final gate** | NSIS installer + `.sig` produced, < 50 MB |

## Notes
- Motivation (confirmed 2026-11-10): a lightweight app, meaning installer size and memory. Baseline installer is 89.9 MB
  (`Ferry-Setup-0.14.9.exe`). This milestone (sidecar) stays as planned. The memory goal is only fully met once milestones 2–3
  remove Node.
- Spike status (2026-11-10): secret gate passed; russh runs blocked on MSVC Build Tools + Docker. See
  `.claude/report/rust-migration-spike.md`.
- Plan file is in `.claude/plan/` (project convention, per CLAUDE.md) rather than the skill default
  `.claude/rocket/plans/`.
- Spike gate: if Task 2 fails, stop before Task 5 and re-decide the secrets question with the user.
  A russh no-go (Task 1) doesn't block Phase 1. It changes milestone 2's library choice (fallback: `ssh2` crate / libssh2).
- Ordering lets Phase 1A ship as normal Electron releases (pure refactor), so the risky cutover PR is smaller.
- Follow-up milestones (not planned here): M2 ports domains into Rust in the order sites/settings stores →
  local fs → session/SSH → remote fs → transfer queue → tail/terminal/archive/monitor/edit/sync, each moving its channels
  from the sidecar list to the host list. M3 deletes the sidecar and `node.exe`.
- Crate/package versions: pin the Tauri 2.x line current at implementation time; this plan cites no versions it couldn't verify.

- Reviewed: yes, 12 findings addressed (independent Plan reviewer, 2026-11-10).

**Wiki consulted**: none. The rk-wiki covers fintech services; Ferry isn't documented there.
**Wiki gaps**: none found.

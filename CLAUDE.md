# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ferry is a lightweight WinSCP alternative: an Electron + Vue 3 desktop SFTP client (dual-pane file
browser, recursive transfer queue with bandwidth cap, live remote log tail via `tail -F`, remote
archive extract/compress, browser-like multi-session site tabs, an interactive SSH Terminal per
site, command palette, light/dark theme). SSH/SFTP only — no FTP/FTPS/SCP.

**For anything beyond this file** — full directory map, every convention, and a running list of
gotchas that have already cost a session real time — read
[.claude/PROJECT_MAP.md](.claude/PROJECT_MAP.md) first. It is actively maintained; update it (not
just this file) whenever you add a convention or hit a new gotcha worth remembering.

## Commands

```bash
npm install --registry=https://registry.npmjs.org   # always pass --registry explicitly on this machine
npm run dev          # electron-vite dev, hot reload
npm run typecheck    # vue-tsc --build + tsc --build tsconfig.node.json, no emit — run before every build
npm run build        # electron-vite build -> out/
npm run package       # build + electron-builder -> dist/*.exe (NSIS) + dist/win-unpacked/
npm test              # vitest run (single pass)
npm run test:watch    # vitest watch mode
```

Run a single test file: `npx vitest run src/main/ssh/shellEscape.test.ts`. Run by name:
`npx vitest run -t "pattern"`.

Most tests are pure-logic unit tests needing no server. A handful
(`RemoteShell.integration.test.ts`, `SessionManager.integration.test.ts`,
`SessionManager.jumphost.integration.test.ts`, `TransferQueue.integration.test.ts`) are real-server
integration tests against a local Docker SFTP/SSH container (command in
`RemoteShell.integration.test.ts`'s file header); each self-skips with a console warning if the
container isn't running. `vitest.config.ts` sets `fileParallelism: false` — this is load-bearing
(shared on-disk `known_hosts.json` state across integration suites), not a style choice.

## Architecture

- **Three-process Electron split**: `src/main` (Node context — SSH/SFTP, filesystem, transfer
  queue, tail, terminal, archive, sites, IPC handlers), `src/preload` (the only renderer↔main
  bridge — a `contextBridge` whitelist derived from `src/shared/contract.ts`), `src/renderer`
  (Vue 3 + Pinia UI, no Node access, `sandbox: true`).
- **`src/shared/contract.ts` is the single source of truth for IPC**: every channel name and
  payload type. Change it FIRST when adding a feature that crosses the process boundary — preload
  and main both import from it and won't compile otherwise.
- **IPC flow**: renderer calls `window.api.invoke(channel, ...)` -> preload validates against the
  contract whitelist -> `ipcMain.handle` (registered via `ipc/envelope.ts`'s `handle()`) -> always
  resolves `{ok:true,data}` or `{ok:false,code,message}`. Main -> renderer is
  `webContents.send(EVENT_CHANNELS.x, ...)`, subscribed via `window.api.on(channel, cb)`.
  One `*.ipc.ts` file per domain in `src/main/ipc/`, each exposing `registerXHandlers()`, wired
  into `registerAllHandlers()` in `src/main/index.ts`.
- **One `RemoteShell` (wraps one `ssh2.Client`) per connection**, owned by the `SessionManager`
  singleton and keyed by a renderer-issued `sessionId` (not a saved site id — the same site can
  have multiple concurrent sessions/tabs). `TailManager`, `TerminalManager`, and `TransferQueue`
  are separate singletons that look up a session's `RemoteShell` rather than owning connections
  themselves.
- **`main/fs/` services (`LocalFsService`, `RemoteFsService`) are plain exported functions, not
  classes** — everything else stateful in `main/` (`SessionManager`, `SiteStore`, `TailManager`,
  `TransferQueue`, `TerminalManager`) is a `getInstance()` singleton.
- **Renderer state is one Pinia store per domain** in `src/renderer/src/stores/`: `sites`,
  `sessions` (browser-like open-site tabs), `localFs` (global), `remoteFs` (keyed per `sessionId`
  so each tab has independent listings/selection), `transferQueue`, `tailStreams`,
  `terminalStreams` (xterm.js instances live outside Pinia's reactive state, in a module-scoped
  `Map`), `ui` (localStorage-persisted display prefs), `settings` (thin wrapper over main-process
  `AppSettingsStore`), `ipcActivity` (drives the global busy indicator).
- **Secrets never cross the IPC boundary decrypted.** `SiteStore` only ever returns
  `hasPassword`/`hasPassphrase` booleans to the renderer; decryption (via Electron's `safeStorage`)
  happens main-process-side, in-memory, at connect time only.
- No `vue-router` — single window, view/tab switching is plain reactive state.

See PROJECT_MAP.md's "Conventions" and "Where to go for X" sections before making any nontrivial
change — they cover things like the exec-first recursive delete, optimistic store patching instead
of full reloads, the drag-and-drop dual-mechanism split, host-key TOFU verification, and the
real-2FA prompt flow, in more depth than belongs here.

## Design docs and plans (historical, not authoritative for current state)

`.claude/architecture/` holds the original backend/frontend design docs written before
implementation began; `.claude/plan/` holds every approved feature-round implementation plan in
sequence. Both are useful for *why* something was built a certain way, but the code and
PROJECT_MAP.md are the source of truth for current behavior — plans describe intent at the time,
not necessarily what shipped.

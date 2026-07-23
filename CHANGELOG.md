# Changelog

All notable changes to Ferry are documented in this file, in Keep a Changelog style.

## 0.14.5 - 2026-07-23

## 0.14.5 - 2026-07-23
### Added
- Detailed connection progress dialog matching WinSCP UX and "Happy Eyeballs" socket implementation for faster connection speeds.

### Changed
- Shrink the packaged installer by ~21% (118MB -> 93.5MB) by no longer bundling renderer-only packages' (and their build-tool dependency trees) raw source into the app, and by dropping unused Chro[...]
- File transfers from remote to local now intuitively target the active local directory rather than the OS Downloads folder, complete with a new conflict resolution modal to prevent silent overwri[...]

### Fixed
- Prevent app crash on unhandled ssh client error events
- Live Tail log panel navigation and immediate output: Clicking "Live Tail" now immediately navigates to the log panel, and the log state is managed globally so initial history is never missed.
- Prevent remote-to-local path traversal vulnerabilities by enforcing strict filename sanitization prior to enqueuing transfers.

## 0.14.4 - 2026-07-20
### Added
- Confirm before deleting a folder (hover trash button, context menu, or the keyboard Delete/Backspace shortcut); file deletes via the trash button or context menu now confirm too, while the keybo[...]

## 0.14.3 - 2026-07-20
### Added
- Add bulk select and delete for saved sites.

### Fixed
- Fail fast on permanent errors instead of retrying.
- Stop WinSCP import self-recursion producing duplicated names.
- Batch import into one refetch and avoid duplicate re-creates.

## 0.14.2 - 2026-07-20
### Fixed
- FilePane.vue: scope keydown shortcuts away from text inputs (fixes data-loss on Delete/Ctrl+A while typing), fix Ctrl+A vs active filter, stuck rename state, and multi-select-aware row delete.
- RemoteShell: reject unsafe SFTP entry names (path traversal) and destroy the exec/execLines stream on abort instead of leaking it.
- TransferQueue/SyncService: defense-in-depth root-boundary check on joinLocal.
- SessionManager: scope host-key-mismatch trust to the exact hop/target that was confirmed, instead of force-trusting every hop on retry; fix proxy socket leak on failed connect.
- EditSessionManager: add closeEdit() + edit:close IPC channel.
- tailStreams/sessions store: dedup tails per-session, close them on tab close, and await an in-flight connect before detaching a closing tab.
- CompressService: guard remote zip source arg against option injection.
- SiteStore/AppSettingsStore: guard decrypt() against unavailable/failed OS encryption.
- TerminalView/App.vue: fix stale-session reattach races and avoid double term.open() by keeping the connected view mounted via v-show.

## 0.14.0 — Release first version

## 0.13.0 — WinSCP-parity gap review: 13 features across file browsing, connections, and sync

A feature/UX gap review against WinSCP (as a daily-driver user) produced an 11-item punch list, phased into four rounds and built essentially back to back: file-browser basics, connection/auth dep[...]

**New features:**
- **Edit in external editor** — double-click (or right-click → Edit) any file, local or remote, to open it in the OS's default app; a remote file downloads in full first (unlike the existing c[...]
- **One-way directory sync (mirror)** — push (local → remote) or pull (remote → local) a whole folder tree, diffing by size and a tolerant mtime comparison (SFTP's whole-second precision vs.[...]
- **Multi-hop jump-host (bastion) chaining** — a saved site can now tunnel through an ordered chain of jump hosts instead of just one, with per-hop host-key verification kept correctly isolated [...]
- **SSH key generation** — generate a new ed25519 keypair from the site form, preferring the system `ssh-keygen` (supports a passphrase) and falling back to a pure-JS `openssh-key-v1` encoder wh[...]
- **SOCKS5 / HTTP CONNECT proxy support** — a global default proxy (Settings) or a per-site override (inherit/none/custom), for connecting through a corporate proxy with no bastion host availabl[...]
- **Persisted transfer/operation history** — a searchable, filterable log of every completed transfer and long-running operation (previously only visible live in the Activity dock), with a debou[...]
- **Directory bookmarks** — quick-jump bookmarks per local/remote folder, independent of saved-site groups; cascade-deleted when their site is deleted.
- **In-listing search/filter** — type-to-filter within either pane's file listing, entirely client-side.
- **Custom accent color** — curated presets or a full color picker in Settings, replacing the fixed brand blue.

**Bug fixes (found doing the gap review, not new-feature regressions):**
- Remote symlinked directories showed up as plain files (SFTP `readdir` reports lstat-style attrs); local broken symlinks were silently dropped from the listing instead of shown with a broken indi[...]
- WinSCP/PuTTY session import only scanned the top level of the registry, silently dropping every session organized into a folder group. Fixed with a recursive walk — which in turn uncovered and[...]
- SSH-agent/Pageant authentication shipped previously without ever being verified end-to-end; it now pre-flight-checks the agent is reachable and has identities loaded, with actionable error messa[...]

**Hardening (from this release's own code review):**
- Edit-in-editor's temp directory and downloaded file are now created with restrictive permissions (`0700`/`0600`) — previously default-permissioned, which would have been world-readable on a sh[...]
- Quick-connect can now bypass a configured app-wide default proxy — previously it had no opt-out and always inherited it, unlike saved sites' inherit/none/custom choice.
- `ssh-keygen`'s passphrase-via-argv exposure (visible to other local processes for the tool's brief lifetime) is now a documented, deliberate limitation rather than a silent gap — there's no fi[...]

**Not code — decisions for a maintainer:**
- Auto-update's build/publish config was already fixed in a prior release; what's left is a real code-signing certificate and cutting an actual first `v*` release tag, neither of which this sessio[...]

## 0.12.0 — Monitor dashboard overhaul: storage, top processes, resizable dock

Customer feedback on the 0.10.0 Monitor dock tab was that it was "useless" in practice — no way to see the connected server's total storage, and no way to see *what* was actually consuming its C[...]

**New features:**
- **Root filesystem storage usage** — a "used / total" bar (e.g. "98 GB / 100 GB") for the connected server's `/` filesystem, polled alongside the existing CPU/memory/load stats via the same tic[...]
- **Top-processes table** — a live table of the server's processes by resource usage (Name, PID, RAM, CPU%), sortable by clicking any column header (default: CPU% descending), virtualized via `@[...]
- **Resizable dock** — drag the bottom dock's top edge to make it taller, persisted across restarts, so the process table (and every other dock tab — Transfers, Activity, Terminal) gets real r[...]

**Under the hood:**
- Process/disk collection extends the existing tick-based `/proc` polling model (`MonitorManager`) rather than introducing a new streaming mechanism or shelling out to `ps` (whose flag dialects di[...]

## 0.11.0 — Electron security & performance hardening, Electron 43 upgrade

An audit against Electron's own official security and performance checklists — fundamentals (context isolation, sandbox, no Node integration, bundled build, CSP, no default menu) were already in[...]

**Security hardening:**
- All renderer permission requests (camera, mic, geolocation, notifications) are now explicitly denied — the app never needs any of them.
- Top-level page navigation is now blocked outright; there's no in-app router, so any navigation attempt is illegitimate.
- External links (`shell.openExternal`) are now restricted to `http`/`https` — a maliciously crafted filename or log line from a remote server could previously have triggered an arbitrary OS sch[...]
- The Content-Security-Policy now explicitly scopes `img-src`/`connect-src` to the app itself.
- Electron Fuses are now locked down in the packaged build (disables `runAsNode` and Node CLI/env-var escape hatches, enables cookie encryption and asar integrity validation) — verified against [...]

**Performance:**
- The SSH (`ssh2`) and zip-archive (`archiver`) libraries now load on first use instead of at app startup, shortening cold start.
- The file list now virtualizes long directory listings (via `@tanstack/vue-virtual`, previously an unused dependency) instead of mounting one DOM row per file — large remote/local folders scrol[...]
- Reading a private key for SSH authentication no longer blocks the main process while the file loads.

**Dependency upgrade:**
- Electron bumped from 30 (end-of-life) to 43 (current stable), with electron-builder and electron-vite brought forward to match. Verified: the app boots under the new Electron both in dev and as[...]
- Fixed OS drag-and-drop uploads (Explorer → remote pane), which the Electron 43 upgrade would otherwise have silently broken — Electron 32 removed the DOM API this relied on to read a droppe[...]

## 0.10.0 — UX & visibility pass: visual hierarchy, live operation progress, terminal keyboard fix, remote resource monitor

Customer feedback on 0.9.0 raised four issues, all addressed this round: the UI was "modern, minimal, but hard to distinguish the content"; only file transfers reported progress, so remote extrac[...]

**New features:**
- **Activity dock tab** — remote extract/compress, local compress, and recursive deletes now show real progress and elapsed time instead of running silently. Multi-select delete is now one oper[...]
- **Monitor dock tab** — live CPU% (aggregate + per-core sparkline), memory/swap, load averages, and uptime for the connected remote server, polled every 2s over the existing SSH connection via[...]

**Bug fixes:**
- **Terminal keyboard** — Ctrl+C (copy selection or SIGINT), Ctrl+Shift+C, Ctrl+V/Ctrl+Shift+V/Shift+Insert (paste), and right-click copy-or-paste now all work. Root cause was the terminal neve[...]

**Visual hierarchy:**
- Chrome regions (title bar, site tab bar, pane headers, dock header) now sit on a distinct `bg-muted` surface with borders at region boundaries, instead of one flat background shared with conten[...]
- Selected rows use an unmistakable `bg-primary/10` tint instead of two nearly-identical zinc shades previously shared with hover.
- Per-file-type icon colors (archives amber, images violet, video rose, audio pink, spreadsheets emerald, code/json teal) and three-tier text contrast (headers vs. size/date/permissions metadata)[...]

## 0.9.0 — WinSCP-parity Phase 4 continued: compress, bandwidth limit, tab persistence, theme, command palette

The remaining WinSCP-parity Phase 4 items land: an inverse to the existing "Extract here" action, an app-wide transfer speed cap, tabs that survive a restart, a light/dark toggle, and a Ctrl/Cmd+[...]

**New features:**
- **Compress to .zip** — the inverse of "Extract here", available from every file/folder's right-click menu. Zips in place: locally via the streamed `archiver` package (no memory blow-up on lar[...]
- **Transfer bandwidth limit** — a new Settings dialog (gear icon in the title bar, or via the command palette) caps all transfers combined to a configurable KB/s ceiling, applied app-wide via [...]
- **Site tabs are restored across app restarts** — as picker tabs only, never auto-connected: the app remembers which saved sites had open tabs at last shutdown, but you still click to connect,[...]
- **Light/dark theme toggle** — a sun/moon button in the title bar, defaulting to the OS's own preference on first run, persisted across restarts.
- **Command palette (Ctrl/Cmd+K)** — quick actions (new tab, toggle theme, toggle the Local pane, open Settings) plus jump-to-site search, so connecting to a saved site no longer requires leavi[...]
- **Auto-update scaffolding** — packaged builds check GitHub Releases on launch and prompt to restart-and-install once a new version has finished downloading in the background. This is genuinel[...]

## 0.8.0 — File-op performance pass, and a shell-injection fix found in review

User feedback that Ferry felt much slower than WinSCP (and than a plain terminal) for delete/rename/chmod/navigate led to a focused performance pass tracking down the actual causes rather than co[...]

**Performance:**
- Remote recursive delete now runs a single `rm -rf` over the already-open SSH connection instead of walking the tree one SFTP round-trip at a time — deleting a folder with hundreds of files is[...]
- Delete/rename/chmod (both local and remote panes) patch the in-memory file list directly instead of doing a full directory reload after every mutation.
- Multi-select delete fires every delete concurrently and patches the list once, instead of N sequential delete-then-reload round-trips.
- Local directory listing stats entries in parallel instead of one at a time — speeds up opening local folders with many files.

**Security fix (found in this release's own review):**
- Remote Extract built its shell command by wrapping already-escaped paths in a hand-written double-quoted `sh -c "..."` string. Because `$(...)`/backticks are still live inside double quotes, a [...]

## 0.7.0 — Bug fixes, WinSCP-parity Phase 4 (partial), and a security/performance review

Two real bugs reported from manual testing, fixed; three of Phase 4's six items landed; and a dedicated security + performance review of the existing Phase 1/2 work, with the findings acted on ra[...]

**Bug fixes:**
- Right-click → Rename no longer opens the inline edit box and instantly closes it again — the context menu was stealing focus back a moment after the rename input appeared.
- The per-row action-button column is back to a single Delete button — tail/extract/transfer's hover icons were redundant now that the right-click context menu covers them.

**WinSCP-parity Phase 4 (partial):**
- Saved sites can be grouped (a free-text tag, e.g. "Work"), searched, and duplicated.
- Per-file-type icons — images, video, audio, code, archives, spreadsheets, and documents each get their own icon instead of one generic file icon.
- Import existing WinSCP and PuTTY sessions from this machine's saved sessions (Windows registry scan). Passwords are deliberately never imported — neither client stores one in a form Ferry can[...]

**Security fixes (found in this release's own review):**
- A site's stored password could keep getting silently replayed into keyboard-interactive prompts even after switching that site to key- or agent-based auth. Switching a site's auth method now cl[...]
- The remote log-tail feature's history-line count was passed into a remote shell command without validation — a possible injection point if the app's renderer process were ever compromised. No[...]

**Performance fix (found in this release's own review):**
- Uploading/downloading a whole folder moved one file at a time, even on a high-latency connection. Up to 4 files now transfer concurrently within a single folder transfer.

## 0.6.0 — WinSCP-parity Phase 2: security & auth, plus the first real-server test suite

Closes Phase 2 of `.claude/plan/ferry-winscp-parity-roadmap.md` — the trust/security gaps flagged in the original gap analysis as "would concern a security-conscious WinSCP user." This is also [...]

**Security & auth parity:**
- Host-key verification (trust-on-first-use, pinned per host:port) — a changed key now blocks the connection with a clear warning and an explicit "trust and continue" instead of connecting sile[...]
- Real keyboard-interactive/2FA — a genuine OTP/verification-code prompt is now shown to the user instead of the password being blindly replayed into it (which just failed).
- SSH-agent authentication (Windows OpenSSH Agent / Pageant / `$SSH_AUTH_SOCK`, with an optional per-site path override).
- Jump-host (bastion) support — tunnel a connection through an intermediate SSH host.
- Editable permissions — a WinSCP-style chmod dialog (owner/group/other × read/write/execute) on the permissions column, replacing the old read-only display.
- Transfer retry — a retry button on any failed or cancelled transfer, instead of only being able to cancel.

## 0.5.0 — Round 5 UX/perf polish + WinSCP-parity Phase 1

An honest gap analysis against WinSCP (see `.claude/plan/ferry-winscp-parity-roadmap.md`) found several table-stakes file-manager basics missing entirely. This release closes Phase 1 of that road[...]

**WinSCP-parity Phase 1:**
- Recursive directory transfer — upload/download whole folder trees, not just single files.
- Rename wired into the UI (F2 or right-click) — the backend already supported it, nothing called it.
- Click-to-sort file-list columns (name/size/modified), ascending/descending.
- Real Explorer-style multi-select: plain click, Ctrl+click, Shift+click range-select, Ctrl+A.
- Right-click context menu per file row (transfer, tail, extract, rename, copy path, delete).
- OS drag-and-drop: drop files/folders from Explorer straight onto the remote pane to upload; local rows can now be dragged out to Explorer/other apps via a native OS drag.
- Toolbar "Upload/Download N selected" button for bulk transfer of a multi-selection.

**Round 5 (UX/perf polish + real-device bug fixes):**
- Deferred the full Lucide icon-set load past first paint for a faster cold start, and fixed a CSP-violation regression that fix introduced.
- Broadened text-preview and archive support (`.jar`/`.war`/`.ear`, more tar variants).
- Bigger file preview dialog.
- A generic busy indicator — an in-flight IPC counter — now drives a titlebar dot, a wait cursor, and a click-blocking overlay across virtually every operation, not just transfers.
- Fixed the Local-pane collapse animation (a previous attempt silently didn't animate).
- App version now visible in the UI; LOCAL/REMOTE pane labels made more prominent.
- The Terminal now opens at the site's configured remote start path.
- The refresh icon spins while refreshing.
- Extracting an archive now creates a same-named subfolder, prompting on conflict, instead of dumping into the current directory.

## 0.4.0 — Round 4: UX feedback

- Centered the "Ferry" title in the title bar.
- Removed the Activity feature entirely (dock tab, backend ring buffer, IPC channel, store, component).
- Moved the hide-Local-pane toggle from the Local pane's own header into the site tab bar, pinned to the right end.
- Connecting to a saved site that already has an open tab now switches to that tab instead of opening a duplicate connection.
- The SSH terminal now opens automatically in the background as soon as a site connects, labeled `username@host`, instead of waiting for the Terminal dock tab to be clicked.
- Added a remote-only file-permissions column, with a toggle between a friendly plain-English label and the classic technical `rwxr-xr-x` string.
- Custom scrollbar styling matching the app's neutral color palette, in both light and dark mode.
- Added tooltips to every icon-only button across the app.
- Added a Ctrl+R shortcut to refresh the focused pane's directory listing.
- Shipped the app's icon/favicon assets (installer, taskbar/window icon, renderer favicon).

## 0.3.0 — Round 3: site tabs, SSH terminal, named sessions

- Browser-like site tabs — open multiple sites at once, switch between them instantly, each with its own live SSH session.
- Interactive SSH Terminal dock tab per site tab, backed by `ssh2`'s PTY shell and `@xterm/xterm`.
- Entering a saved site shows `Session {name}` instead of a raw session UUID.
- The hide-Local toggle moved into the Local pane's own header row.
- Removed the redundant "Disconnect" button/bar (closing a tab already disconnects its session).

(commit `5b67425`)

## 0.2.0 — Round 2: saved sites, preview, and polish

- Saved sites (add/edit/delete), quick-connect, and file preview/tail dialog.
- Hide-Local-pane toggle, custom frameless titlebar, download/toast polish.

(commit `b372122`)

## 0.1.0 — Initial scaffold

- Ferry's initial SFTP client scaffold: dual-pane browser, transfer queue, and live remote log tailing.

(commit `5aa908b`)

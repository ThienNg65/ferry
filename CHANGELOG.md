# Changelog

All notable changes to Ferry are documented in this file, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style. `package.json`'s `version` and the standalone `VERSION` file must always be bumped together.

## 0.14.5 - 2026-07-21
### Changed
- Shrink the packaged installer by ~21% (118MB -> 93.5MB) by no longer bundling renderer-only packages' (and their build-tool dependency trees) raw source into the app, and by dropping unused Chromium locale files.

## 0.14.4 - 2026-07-20
### Added
- Confirm before deleting a folder (hover trash button, context menu, or the keyboard Delete/Backspace shortcut); file deletes via the trash button or context menu now confirm too, while the keyboard shortcut still deletes files instantly.

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

A feature/UX gap review against WinSCP (as a daily-driver user) produced an 11-item punch list, phased into four rounds and built essentially back to back: file-browser basics, connection/auth depth, then sync and polish. 222 tests passing (2 pre-existing environmental integration-test failures against the local Docker SSH container — a genuine channel-open failure on the container's own internal sshd port, unrelated to any change in this release).

**New features:**
- **Edit in external editor** — double-click (or right-click → Edit) any file, local or remote, to open it in the OS's default app; a remote file downloads in full first (unlike the existing capped preview), then re-uploads automatically on every save via a debounced file watcher. An edit session survives the SSH connection dropping (stops syncing, keeps the temp file) and survives app quit (a pending, never-uploaded edit is never silently deleted).
- **One-way directory sync (mirror)** — push (local → remote) or pull (remote → local) a whole folder tree, diffing by size and a tolerant mtime comparison (SFTP's whole-second precision vs. local ms precision). An optional "delete extras" mode mirrors the destination exactly; a mandatory preview step (counts + bytes) is the only safety net before that destructive option runs, and the diff is recomputed fresh at run time rather than trusting the previewed plan.
- **Multi-hop jump-host (bastion) chaining** — a saved site can now tunnel through an ordered chain of jump hosts instead of just one, with per-hop host-key verification kept correctly isolated across the chain.
- **SSH key generation** — generate a new ed25519 keypair from the site form, preferring the system `ssh-keygen` (supports a passphrase) and falling back to a pure-JS `openssh-key-v1` encoder when it's not installed, cross-validated against a real `ssh-keygen -y`/`-l` during development.
- **SOCKS5 / HTTP CONNECT proxy support** — a global default proxy (Settings) or a per-site override (inherit/none/custom), for connecting through a corporate proxy with no bastion host available; layers onto the jump-host chain as hop 0's transport only.
- **Persisted transfer/operation history** — a searchable, filterable log of every completed transfer and long-running operation (previously only visible live in the Activity dock), with a debounced disk write so a large sync's burst of completions doesn't hammer the main process.
- **Directory bookmarks** — quick-jump bookmarks per local/remote folder, independent of saved-site groups; cascade-deleted when their site is deleted.
- **In-listing search/filter** — type-to-filter within either pane's file listing, entirely client-side.
- **Custom accent color** — curated presets or a full color picker in Settings, replacing the fixed brand blue.

**Bug fixes (found doing the gap review, not new-feature regressions):**
- Remote symlinked directories showed up as plain files (SFTP `readdir` reports lstat-style attrs); local broken symlinks were silently dropped from the listing instead of shown with a broken indicator. Both fixed, plus a visible symlink badge/tooltip on both panes.
- WinSCP/PuTTY session import only scanned the top level of the registry, silently dropping every session organized into a folder group. Fixed with a recursive walk — which in turn uncovered and fixed a real latent infinite-recursion bug in the registry-subkey parser (a recursive query's own echoed header line was being mistaken for a child of itself).
- SSH-agent/Pageant authentication shipped previously without ever being verified end-to-end; it now pre-flight-checks the agent is reachable and has identities loaded, with actionable error messages instead of a generic handshake failure, plus a documented manual QA checklist for the parts that can't be scripted (a real Windows OpenSSH Agent / Pageant).

**Hardening (from this release's own code review):**
- Edit-in-editor's temp directory and downloaded file are now created with restrictive permissions (`0700`/`0600`) — previously default-permissioned, which would have been world-readable on a shared Linux/macOS machine with a world-readable `/tmp`.
- Quick-connect can now bypass a configured app-wide default proxy — previously it had no opt-out and always inherited it, unlike saved sites' inherit/none/custom choice.
- `ssh-keygen`'s passphrase-via-argv exposure (visible to other local processes for the tool's brief lifetime) is now a documented, deliberate limitation rather than a silent gap — there's no file/stdin-based alternative in ssh-keygen's own interface.

**Not code — decisions for a maintainer:**
- Auto-update's build/publish config was already fixed in a prior release; what's left is a real code-signing certificate and cutting an actual first `v*` release tag, neither of which this session could or should decide.

## 0.12.0 — Monitor dashboard overhaul: storage, top processes, resizable dock

Customer feedback on the 0.10.0 Monitor dock tab was that it was "useless" in practice — no way to see the connected server's total storage, and no way to see *what* was actually consuming its CPU/RAM. This round adds both, plus the dock room to show them properly. 180 unit tests passing (one pre-existing environmental integration-test failure against the local Docker SSH container, unrelated to this round).

**New features:**
- **Root filesystem storage usage** — a "used / total" bar (e.g. "98 GB / 100 GB") for the connected server's `/` filesystem, polled alongside the existing CPU/memory/load stats via the same tick.
- **Top-processes table** — a live table of the server's processes by resource usage (Name, PID, RAM, CPU%), sortable by clicking any column header (default: CPU% descending), virtualized via `@tanstack/vue-virtual` so it scrolls smoothly through hundreds of rows without mounting one DOM node per process. View-only by design, no kill/signal actions. Per-process CPU% reuses the same aggregate `/proc/stat` delta already computed for the overall CPU figure, so it needs no extra HZ constant or wall-clock timing assumption.
- **Resizable dock** — drag the bottom dock's top edge to make it taller, persisted across restarts, so the process table (and every other dock tab — Transfers, Activity, Terminal) gets real room instead of a fixed ~184px strip.

**Under the hood:**
- Process/disk collection extends the existing tick-based `/proc` polling model (`MonitorManager`) rather than introducing a new streaming mechanism or shelling out to `ps` (whose flag dialects differ across GNU/BSD/BusyBox) — per-process figures come from a portable `/proc`-only scan (the shell's own `read` builtin over each `/proc/[pid]/stat`, no forked `cat`/`ps`/`awk`), consistent with how CPU/memory were already gathered.

## 0.11.0 — Electron security & performance hardening, Electron 43 upgrade

An audit against Electron's own official security and performance checklists — fundamentals (context isolation, sandbox, no Node integration, bundled build, CSP, no default menu) were already in place, so this round closes the remaining defense-in-depth gaps, banks a few perf wins, and brings Electron off an end-of-life major version. 176 unit tests passing (one pre-existing environmental integration-test failure against the local Docker SSH container, unrelated to this round).

**Security hardening:**
- All renderer permission requests (camera, mic, geolocation, notifications) are now explicitly denied — the app never needs any of them.
- Top-level page navigation is now blocked outright; there's no in-app router, so any navigation attempt is illegitimate.
- External links (`shell.openExternal`) are now restricted to `http`/`https` — a maliciously crafted filename or log line from a remote server could previously have triggered an arbitrary OS scheme handler.
- The Content-Security-Policy now explicitly scopes `img-src`/`connect-src` to the app itself.
- Electron Fuses are now locked down in the packaged build (disables `runAsNode` and Node CLI/env-var escape hatches, enables cookie encryption and asar integrity validation) — verified against the actual packaged binary.

**Performance:**
- The SSH (`ssh2`) and zip-archive (`archiver`) libraries now load on first use instead of at app startup, shortening cold start.
- The file list now virtualizes long directory listings (via `@tanstack/vue-virtual`, previously an unused dependency) instead of mounting one DOM row per file — large remote/local folders scroll smoothly instead of degrading.
- Reading a private key for SSH authentication no longer blocks the main process while the file loads.

**Dependency upgrade:**
- Electron bumped from 30 (end-of-life) to 43 (current stable), with electron-builder and electron-vite brought forward to match. Verified: the app boots under the new Electron both in dev and as a Fuses-hardened packaged installer.
- Fixed OS drag-and-drop uploads (Explorer → remote pane), which the Electron 43 upgrade would otherwise have silently broken — Electron 32 removed the DOM API this relied on to read a dropped file's path; it now goes through a small preload-exposed helper instead.

## 0.10.0 — UX & visibility pass: visual hierarchy, live operation progress, terminal keyboard fix, remote resource monitor

Customer feedback on 0.9.0 raised four issues, all addressed this round: the UI was "modern, minimal, but hard to distinguish the content"; only file transfers reported progress, so remote extract/compress, local compress, and recursive deletes ran silently for up to 5 minutes behind a 6px title-bar dot; the Terminal's Ctrl+C/Ctrl+V "did nothing" (only typing + Enter worked); and there was no way to see a connected server's memory or CPU usage. 134 unit tests passing.

**New features:**
- **Activity dock tab** — remote extract/compress, local compress, and recursive deletes now show real progress and elapsed time instead of running silently. Multi-select delete is now one operation with an item-count progress, not N separate silent deletes. Compress/extract are cancellable; deletes are not (can't safely abort `rm -rf` mid-flight).
- **Monitor dock tab** — live CPU% (aggregate + per-core sparkline), memory/swap, load averages, and uptime for the connected remote server, polled every 2s over the existing SSH connection via a single combined `/proc` read — no extra connections or PID-tracking.

**Bug fixes:**
- **Terminal keyboard** — Ctrl+C (copy selection or SIGINT), Ctrl+Shift+C, Ctrl+V/Ctrl+Shift+V/Shift+Insert (paste), and right-click copy-or-paste now all work. Root cause was the terminal never receiving keyboard focus except right after a direct click on the xterm canvas.

**Visual hierarchy:**
- Chrome regions (title bar, site tab bar, pane headers, dock header) now sit on a distinct `bg-muted` surface with borders at region boundaries, instead of one flat background shared with content everywhere.
- Selected rows use an unmistakable `bg-primary/10` tint instead of two nearly-identical zinc shades previously shared with hover.
- Per-file-type icon colors (archives amber, images violet, video rose, audio pink, spreadsheets emerald, code/json teal) and three-tier text contrast (headers vs. size/date/permissions metadata).

## 0.9.0 — WinSCP-parity Phase 4 continued: compress, bandwidth limit, tab persistence, theme, command palette

The remaining WinSCP-parity Phase 4 items land: an inverse to the existing "Extract here" action, an app-wide transfer speed cap, tabs that survive a restart, a light/dark toggle, and a Ctrl/Cmd+K command palette — plus the first (currently inert) scaffolding for auto-update. 92 unit tests passing.

**New features:**
- **Compress to .zip** — the inverse of "Extract here", available from every file/folder's right-click menu. Zips in place: locally via the streamed `archiver` package (no memory blow-up on large folders), remotely via a single SSH-exec `zip -r` (no download/upload round-trip), both rooting the archive's internal paths at the source's own basename.
- **Transfer bandwidth limit** — a new Settings dialog (gear icon in the title bar, or via the command palette) caps all transfers combined to a configurable KB/s ceiling, applied app-wide via a shared rate limiter rather than per-file (so it doesn't multiply with concurrency), and takes effect on transfers already in flight, not just new ones.
- **Site tabs are restored across app restarts** — as picker tabs only, never auto-connected: the app remembers which saved sites had open tabs at last shutdown, but you still click to connect, so no saved credential or 2FA challenge fires unattended on launch.
- **Light/dark theme toggle** — a sun/moon button in the title bar, defaulting to the OS's own preference on first run, persisted across restarts.
- **Command palette (Ctrl/Cmd+K)** — quick actions (new tab, toggle theme, toggle the Local pane, open Settings) plus jump-to-site search, so connecting to a saved site no longer requires leaving the keyboard.
- **Auto-update scaffolding** — packaged builds check GitHub Releases on launch and prompt to restart-and-install once a new version has finished downloading in the background. This is genuinely untested scaffolding, not a working feature yet: it needs a real published repo/release and a code-signing certificate, neither of which exists in this environment — safely inert (a no-op) until then.

## 0.8.0 — File-op performance pass, and a shell-injection fix found in review

User feedback that Ferry felt much slower than WinSCP (and than a plain terminal) for delete/rename/chmod/navigate led to a focused performance pass tracking down the actual causes rather than cosmetic tweaks, plus a dedicated security review of the file-op changes that turned up a real remote-command-injection bug in the (separately in-progress) remote Extract feature — fixed before this release, with a regression test proving it.

**Performance:**
- Remote recursive delete now runs a single `rm -rf` over the already-open SSH connection instead of walking the tree one SFTP round-trip at a time — deleting a folder with hundreds of files is now one round-trip instead of hundreds. Falls back to the old per-entry SFTP walk only when exec isn't available at all (e.g. an sftp-only chroot account) or the shell command itself fails.
- Delete/rename/chmod (both local and remote panes) patch the in-memory file list directly instead of doing a full directory reload after every mutation.
- Multi-select delete fires every delete concurrently and patches the list once, instead of N sequential delete-then-reload round-trips.
- Local directory listing stats entries in parallel instead of one at a time — speeds up opening local folders with many files.

**Security fix (found in this release's own review):**
- Remote Extract built its shell command by wrapping already-escaped paths in a hand-written double-quoted `sh -c "..."` string. Because `$(...)`/backticks are still live inside double quotes, a remote file or archive with a crafted name could execute arbitrary commands on the remote host the moment a user extracted it. Fixed by re-escaping the whole inner command as a single argument instead of stacking a second hand-built quoting layer around already-escaped values, with a new regression test that runs the built command through a real shell with an injection payload to prove it's inert. (The same bug was independently caught and fixed in the not-yet-released remote Compress feature before it ever shipped.)

## 0.7.0 — Bug fixes, WinSCP-parity Phase 4 (partial), and a security/performance review

Two real bugs reported from manual testing, fixed; three of Phase 4's six items landed; and a dedicated security + performance review of the existing Phase 1/2 work, with the findings acted on rather than just reported. 104 tests passing (up from 76).

**Bug fixes:**
- Right-click → Rename no longer opens the inline edit box and instantly closes it again — the context menu was stealing focus back a moment after the rename input appeared.
- The per-row action-button column is back to a single Delete button — tail/extract/transfer's hover icons were redundant now that the right-click context menu covers them.

**WinSCP-parity Phase 4 (partial):**
- Saved sites can be grouped (a free-text tag, e.g. "Work"), searched, and duplicated.
- Per-file-type icons — images, video, audio, code, archives, spreadsheets, and documents each get their own icon instead of one generic file icon.
- Import existing WinSCP and PuTTY sessions from this machine's saved sessions (Windows registry scan). Passwords are deliberately never imported — neither client stores one in a form Ferry can safely decode.

**Security fixes (found in this release's own review):**
- A site's stored password could keep getting silently replayed into keyboard-interactive prompts even after switching that site to key- or agent-based auth. Switching a site's auth method now clears the secret it no longer uses.
- The remote log-tail feature's history-line count was passed into a remote shell command without validation — a possible injection point if the app's renderer process were ever compromised. Now validated before use.

**Performance fix (found in this release's own review):**
- Uploading/downloading a whole folder moved one file at a time, even on a high-latency connection. Up to 4 files now transfer concurrently within a single folder transfer.

## 0.6.0 — WinSCP-parity Phase 2: security & auth, plus the first real-server test suite

Closes Phase 2 of `.claude/plan/ferry-winscp-parity-roadmap.md` — the trust/security gaps flagged in the original gap analysis as "would concern a security-conscious WinSCP user." This is also the first release with any automated tests: 76 passing, including real-server integration suites run against a local Docker SFTP/SSH container (not mocks) — see `.claude/PROJECT_MAP.md`'s Build/run/test section.

**Security & auth parity:**
- Host-key verification (trust-on-first-use, pinned per host:port) — a changed key now blocks the connection with a clear warning and an explicit "trust and continue" instead of connecting silently. This was a real MITM exposure before.
- Real keyboard-interactive/2FA — a genuine OTP/verification-code prompt is now shown to the user instead of the password being blindly replayed into it (which just failed).
- SSH-agent authentication (Windows OpenSSH Agent / Pageant / `$SSH_AUTH_SOCK`, with an optional per-site path override).
- Jump-host (bastion) support — tunnel a connection through an intermediate SSH host.
- Editable permissions — a WinSCP-style chmod dialog (owner/group/other × read/write/execute) on the permissions column, replacing the old read-only display.
- Transfer retry — a retry button on any failed or cancelled transfer, instead of only being able to cancel.

## 0.5.0 — Round 5 UX/perf polish + WinSCP-parity Phase 1

An honest gap analysis against WinSCP (see `.claude/plan/ferry-winscp-parity-roadmap.md`) found several table-stakes file-manager basics missing entirely. This release closes Phase 1 of that roadmap — the "daily-driver blockers" — alongside a separate, previously-uncommitted round of UX/perf polish.

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

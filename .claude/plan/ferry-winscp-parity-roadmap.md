# Ferry vs. WinSCP — Honest Gap Analysis & Roadmap

## Context

Ferry's own planning docs (`.claude/plan/ferry-implementation-plan.md`) state the vision explicitly: *"WinSCP works but is bloated and sluggish for daily use... The goal is a focused, fast, minimal desktop client — same familiar dual-pane file-transfer mental model as WinSCP, but visually and behaviorally in line with Apple's design principles."* Five rounds of UX-feedback iteration have been shipped (dual-pane browsing, transfer queue, live `tail -F`, remote archive extraction, site tabs, an embedded terminal). Round 5 is uncommitted in the working tree right now.

The user (a WinSCP daily user) asked for an honest comparison and a plan to close the gap. Three research passes (backend/main-process, frontend/renderer, and project docs) turned up a consistent picture: **Ferry nails its stated differentiators but is missing several WinSCP table-stakes that a daily user hits in the first five minutes.** This plan captures that assessment and lays out the work to close it, in priority order.

## Honest Assessment

**Where Ferry already beats WinSCP:**
- Live `tail -F` log streaming with auto-reconnect (`src/main/ipc/tail.ipc.ts`) — WinSCP has nothing like this.
- Remote "extract here" without a download round-trip (`src/main/unzip/UnzipService.ts`).
- Browser-like site tabs with multiple concurrent live sessions (`SiteTabBar`), vs. WinSCP's single-window-per-session model.
- A real embedded terminal (xterm.js) docked alongside the file panes (`BottomDock.vue`) — no need to alt-tab to PuTTY.
- Modern, coherent UI (Nuxt UI + Tailwind) and a much lighter/faster app shell than WinSCP's dated WinForms UI.

**Where it currently loses — and would lose a daily user immediately:**
- **No recursive folder transfer.** `TransferQueue.ts` and the transfer IPC only move single files. Dragging a folder to download/upload — WinSCP's most basic action — silently doesn't work. Flagged as the single biggest gap in the project's own `handoff.md`.
- **No column sorting.** Rows render in whatever order the SFTP/`fs` listing returns them (`FileRow.vue`, `localFs.store.ts`/`remoteFs.store.ts`) — no click-to-sort by name/size/date.
- **Broken multi-select semantics.** Selection is a plain per-click toggle — no Shift range-select, no Ctrl add/remove, no Select All. Anyone used to Explorer/WinSCP selection habits will select the wrong files.
- **No right-click context menu at all.** Every action is a hover-icon on the row. No "New folder here", "Copy path", "Properties" — all standard WinSCP reflexes are gone.
- **Rename is effectively missing from the UI.** The backend has rename IPC (`fs.ipc.ts`) but nothing in the renderer calls it — no F2, no menu entry, no dialog.
- **No drag-and-drop from the OS.** Drag only works pane-to-pane inside the app; you can't drag a file in from Windows Explorer, which is one of WinSCP's most-used flows.
- **No bulk download/upload** — transfer is wired per-row only, so multi-selecting 10 files and hitting "download" doesn't do what you'd expect.

**Where it loses on trust/security (would concern a security-conscious WinSCP user):**
- **No host-key verification.** `SessionManager.ts` never checks/pins the server's host key — no `known_hosts`-style trust-on-first-use, unlike WinSCP and even bare OpenSSH. This is an actual MITM exposure, not just a UX gap.
- **Keyboard-interactive auth is faked.** It just replies to any prompt with the plain password (`SessionManager.ts:171-173`) — real 2FA/OTP prompts will simply fail.
- **No SSH-agent auth, no jump-host/bastion/proxy support.** A meaningful slice of WinSCP's power-user base (anyone behind a bastion) can't connect at all.
- **Nothing has ever been verified against a real SFTP/SSH server.** Every round's "testing" was typecheck/build only (per `handoff.md`) — the app is unproven against real-world server quirks.

**Where it's simply thinner than WinSCP (expected for an early tool, but real):**
- No chmod/permissions editing (permissions are shown, not settable).
- No transfer retry/resume — only cancel.
- Flat site list — no folders/groups, no duplicate, no search.
- No sync/mirror between local and remote directories.
- No edit-in-place (open remote file in a local editor, auto-reupload on save).
- No per-file-type icons — every file uses the same generic icon.
- SFTP-only — no SCP/FTP/FTPS (explicitly intentional per the project's own plan, so not scored as a real gap).

**Verdict:** Ferry today is a well-built *prototype of the vision*, not yet a replacement. The differentiators are real and worth protecting, but the missing basics (folder transfer, sort, multi-select, context menu, rename, host-key checking) are exactly the things that break trust and workflow muscle-memory in session one.

## Roadmap

### Phase 1 — Daily-driver blockers (do first; nothing else matters until these land)
1. **Recursive directory transfer** (upload + download folder trees) — `src/main/transfer/TransferQueue.ts`, `src/main/ssh/RemoteShell.ts`, `src/main/ipc/transfer.ipc.ts`, `src/shared/contract.ts`. Needs recursive local walk + recursive SFTP walk, a flattened work-list feeding the existing queue, and progress aggregation across the whole tree.
2. **Wire up rename** — the IPC already exists (`fs.ipc.ts`); add F2 keybinding + inline-rename UI in `FileRow.vue`/`FilePane.vue`.
3. **Column sorting** — sort state in `localFs.store.ts`/`remoteFs.store.ts`, clickable headers in `FileRow.vue`'s header row.
4. **Real multi-select** — Shift range-select, Ctrl toggle, Ctrl+A select-all in the same stores + `FilePane.vue` click handlers.
5. **Right-click context menu** — new shared component wired into `FileRow.vue`/`FilePane.vue` (rename, delete, download, new folder, copy path, permissions).
6. **OS drag-and-drop** — extend `useDragAndDrop.ts` to accept native `dataTransfer` files dropped from Explorer, and to support drag-out to OS.
7. **Bulk download/upload** for multi-selected rows, reusing the Phase 1.1 recursive-transfer plumbing.

### Phase 2 — Security & auth parity (close the trust gap before wider rollout) — DONE, verified against a real server
1. **Done. Host-key verification.** Trust-on-first-use pinning + change detection, via `KnownHostsStore.ts` (new) and `SessionManager.ts`'s `hostVerifier`. A changed key rejects the connect with `HOST_KEY_MISMATCH` (a new `IpcErrorCode`) instead of silently connecting; the renderer shows a dedicated warning dialog (`SessionManagerView.vue`) with an explicit "Trust new key & connect" retry rather than a plain toast. Verified against the real test container: TOFU-trust on first connect, silent reconnect on a match, rejection on a simulated mismatch, and override-and-reconnect — all four in `SessionManager.integration.test.ts`.
2. **Done. Real keyboard-interactive/2FA flow.** The old code replied to every keyboard-interactive prompt with the plain password (would silently fail any real OTP/2FA server). Now (`keyboardInteractive.ts`'s `partitionPrompts`/`mergeAnswers`, wired into `SessionManager.ts`): prompts that look like a password re-ask are still auto-answered (the common PAM-via-keyboard-interactive case — confirmed for real against the test container, which routes password auth through keyboard-interactive), but anything else (a genuine 2FA/OTP challenge) is forwarded to the renderer as a `session:keyboard-interactive-prompt` event and answered through a real dialog (`SessionManagerView.vue`), not guessed at.
3. **Done. SSH-agent auth + jump-host/proxy support.** `AuthMethod` gained `'agent'` (`SessionManager.ts`'s `defaultAgentPath()` — the Windows OpenSSH Agent named pipe or `$SSH_AUTH_SOCK`, overridable per-site). Jump-host tunneling connects a separate `Client` to the bastion first, then rides `forwardOut`'s stream as the target connection's `sock` (`SessionManager.ts`'s `connectClient`/`forwardThroughJump`); both hops get independent host-key verification. Verified end-to-end against the real test container acting as both hops at once (`SessionManager.jumphost.integration.test.ts`) — this also caught a real container-config issue (`AllowTcpForwarding no` by default) that had to be fixed on the test server, not in Ferry's code. SSH-agent auth itself could NOT be verified against a live agent+key pair in this environment (none was available) — it's wired per ssh2's documented API and mirrors the already-working privateKey path, but is otherwise unverified against reality; flag this if it's ever reported broken.
4. **Done. chmod.** `RemoteShell.chmod()` (SFTP `chmod`), a new `fs:remote:chmod` channel, and a WinSCP-style 3×3 checkbox grid (`ChmodDialog.vue`, reachable from the permissions column's right-click menu) replace the old read-only permissions cell. `permissions.ts` gained `parseMode`/`formatMode` (pure, unit-tested) alongside the existing `toTechnical`/`toFriendlyLabel`. Verified against the real container: sets real bits, confirmed via both SFTP `stat()` and a live `stat -c '%a'` shell command.
5. **Done. Transfer retry.** `TransferQueue.vue`'s `TransferItem.vue` gained a retry button for any `error`/`cancelled` row; `transferQueue.store.ts`'s `retry()` re-enqueues the exact same job from scratch (new `transferId`, old row dropped) — reuses the already-real-server-tested `enqueue()`/`enqueueTree()` path rather than adding new transfer machinery.

### Phase 3 — Validate against reality
1. **Done (backend layer only).** A `linuxserver/openssh-server` Docker container (`ferry-test-sftp`, port 2299, user `ferrytest`) now exists and is exercised by real-server integration tests — see below. **Still not done: the Electron GUI itself has never been driven against a real server or by a human** — no tool available in this environment can type into/click the actual app window, so every UI-level behavior (drag-and-drop, context menu, inline rename, sort clicks, multi-select) remains unverified beyond typecheck/build. A human needs to do this manually, pointing a saved site at `127.0.0.1:2299` / `ferrytest` / `ferrytest123`.
2. **Done.** First automated tests added: pure-logic unit tests (`shellEscape.test.ts`, `archive.test.ts`, `fileSort.test.ts`, `fileSelection.test.ts`) plus two real-server integration suites (`RemoteShell.integration.test.ts`, `TransferQueue.integration.test.ts`) that connect an actual `ssh2.Client`/`SessionManager` to the container above and exercise exec/SFTP/recursive-transfer/cancel end to end. All 45 tests pass. `retry.ts` backoff timing logic still has no test — a good next addition (needs fake timers, not a real server).

### Phase 4 — Round out parity + lean into differentiation
1. **Done. Site folders/groups, duplicate, search.** A flat free-text `group` tag (not a nested folder tree) on `Site`/`SiteInput`/`StoredSite`; `SessionManagerView.vue` shows no group headers at all until a site actually has one set, then groups alphabetically with a trailing "Ungrouped" section. Search filters by name/host/username. `sites:duplicate` clones the on-disk record (ciphertext copied as-is, no decrypt/re-encrypt — `safeStorage` is OS-account-scoped, not per-record).
2. **Done. Per-file-type icons.** `fileTypes.ts`'s new `iconForFile()` — archive check first (reusing `isArchive()`), then image/video/audio/spreadsheet/JSON/code/document extension buckets, falling back to the generic file icon — wired into `FileRow.vue`.
3. Sync/mirror local↔remote directories (new feature, no current analog) — **not started**.
4. Edit-in-place (open in local editor, watch, auto-reupload) — **not started**.
5. **Done (partially). Import existing WinSCP/PuTTY sessions** — highest-leverage adoption unlock. `main/sites/SessionImporter.ts` scans `HKCU\Software\SimonTatham\PuTTY\Sessions` and `HKCU\Software\Martin Prikryl\WinSCP 2\Sessions` via `reg query` (Windows only), `ImportSessionsDialog.vue` lets the user pick which to import, deduped against already-saved sites. **Deliberately does not import passwords** (PuTTY never stores one; WinSCP's is only reversibly obfuscated, not real encryption, and decoding it wrong with no real WinSCP install to validate against would silently import a bad credential) and does not recurse into WinSCP folder-group subkeys (one level of `Sessions` only). The `reg query`-output PARSING is unit-tested against hand-authored fixtures (`regQuery.test.ts`); the actual `reg.exe` invocation has NOT been verified against a real machine with real WinSCP/PuTTY sessions saved, since neither is installed in this environment.
6. Remaining polish already in the backlog: command palette, light/dark toggle, bandwidth throttling, archive creation, auto-update/code signing, persist open tabs across restart — **not started**.

## Verification

- The Phase 3 Docker SFTP target is up (`ferry-test-sftp`) and backend code (RemoteShell/SessionManager/TransferQueue/KnownHostsStore) is covered by real-server integration tests (`npm test`, 76 passing) — this validates recursive transfer, mkdir/rename/readdir, queue cancellation, host-key TOFU/mismatch/override, and jump-host tunneling against actual sshd/sftp-server behavior, not just typecheck/build. `vitest.config.ts` (new) disables file parallelism deliberately — these suites share real disk-backed state (`known_hosts.json`) and the same test server/port, and running files concurrently produced a genuine flaky cross-file race until that was added.
- **Still outstanding: manual smoke test of the Electron GUI itself** against that same container — folder upload/download via drag, sort clicks, multi-select (shift/ctrl), context-menu actions (including the new Permissions… entry), rename, chmod dialog, the keyboard-interactive/host-key-mismatch warning dialogs, and OS drag-and-drop. No tool in this environment can drive the actual app window; this needs a human. Site to use: `127.0.0.1:2299`, user `ferrytest`, password `ferrytest123`, SFTP.
- **Also outstanding: SSH-agent auth against a real ssh-agent/Pageant/Windows-OpenSSH-Agent + loaded key.** No agent was available in this environment; the connect-config wiring is correct per ssh2's documented API but has never been exercised end-to-end. Jump-host, by contrast, WAS verified end-to-end (self-jump trick — see Phase 2).
- Add vitest coverage for the pure-logic modules touched so far as a regression safety net — done for `shellEscape`/`archive`/`fileSort`/`fileSelection`/`KnownHostsStore`'s `evaluateHostKey`/`keyboardInteractive`'s `partitionPrompts`/`mergeAnswers`/`permissions`'s `parseMode`/`formatMode`/`retry`'s `withRetry` (fake timers)/`fileTypes`'s `iconForFile`/`regQuery`'s parsing helpers/`SiteStore`'s `pickSecret` — 104 tests total, all passing.
- **A dedicated security + performance review of Phase 1/2 turned up and fixed one HIGH-severity credential-leak** (a site's stale password could keep getting replayed into keyboard-interactive prompts after switching the site away from password auth — fixed in `SiteStore.ts`/`SessionManager.ts`), **one MEDIUM shell-injection surface** (`tail:start`'s `historyLines` was interpolated unvalidated into a remote command — fixed in `TailManager.ts`), and **one HIGH performance issue** (recursive tree transfers moved one file at a time even though job-level concurrency already existed — fixed in `TransferQueue.ts`, now `TREE_ITEM_CONCURRENCY = 4` within a tree job). Two lower-severity security findings and two further performance findings (serial remote directory walk, no `FileList.vue` virtualization despite `@tanstack/vue-virtual` already being an installed, unused dependency) were left as documented follow-ups — see `handoff.md` for full detail on all of these.

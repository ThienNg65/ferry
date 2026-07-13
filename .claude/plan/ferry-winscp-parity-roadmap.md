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

### Phase 2 — Security & auth parity (close the trust gap before wider rollout)
1. **Host-key verification** — pin/verify on first connect, warn on change (`SessionManager.ts` connect config).
2. **Real keyboard-interactive/2FA flow** — prompt the user per-challenge instead of replying with the stored password.
3. **SSH-agent auth + jump-host/proxy support** — extend `AuthMethod` in `contract.ts` and `SessionManager.ts`.
4. **chmod/setstat** — make the permissions column editable (`RemoteShell.ts`, `FileRow.vue`).
5. **Transfer retry** on failure, not just cancel (`TransferQueue.ts`).

### Phase 3 — Validate against reality
1. Stand up a real SFTP/SSH test target (e.g. a local `atmoz/sftp` or `linuxserver/openssh-server` Docker container) and manually walk every feature end-to-end — this has never been done per the project's own handoff notes.
2. Add the first automated tests (vitest is installed, unused) for pure-logic modules most at risk from Phase 1/2 changes: `shellEscape.ts`, `archive.ts` helpers, `retry.ts` backoff, the new recursive-transfer walker.

### Phase 4 — Round out parity + lean into differentiation
1. Site folders/groups, duplicate, search in `SessionManagerView.vue`/`SiteStore.ts`.
2. Per-file-type icons in `fileTypes.ts`/`FileRow.vue`.
3. Sync/mirror local↔remote directories (new feature, no current analog).
4. Edit-in-place (open in local editor, watch, auto-reupload).
5. **Import existing WinSCP/PuTTY sessions** — highest-leverage adoption unlock, since it removes the switching cost that keeps WinSCP users on WinSCP.
6. Remaining polish already in the backlog: command palette, light/dark toggle, bandwidth throttling, archive creation, auto-update/code signing, persist open tabs across restart.

## Verification

- After Phase 1: manual smoke test against a real SFTP server covering folder upload/download, sort, multi-select (shift/ctrl), context-menu actions, rename, and OS drag-and-drop — none of this is exercised by `typecheck`/`build` alone.
- After Phase 2: verify host-key change detection triggers a warning, and that a server configured for OTP/keyboard-interactive actually prompts the user.
- Stand up the Phase 3 Docker SFTP target early (even before finishing Phase 1) so every subsequent phase is checked against a real server, not just `npm run typecheck`/`build`.
- Add vitest coverage for the pure-logic modules touched in Phase 1/2 as a regression safety net.

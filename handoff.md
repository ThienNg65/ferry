# Handoff — WinSCP-parity Phase 1 (2026-07-13)

## Goal

The user (a daily WinSCP user) asked for an honest comparison of Ferry against WinSCP and a plan to close the gap. Three research passes (main-process capabilities, renderer UI/UX, project docs/history) produced `.claude/plan/ferry-winscp-parity-roadmap.md` — a phased roadmap. **Phase 1 ("daily-driver blockers")** is what this session implemented: the table-stakes file-manager basics a WinSCP user hits in the first five minutes that Ferry was missing entirely. Phases 2–4 (security/auth hardening, real-server validation, sync/edit-in-place/WinSCP-import) are future work, not started.

This session also inherited — and is now committing alongside Phase 1 — **Round 5**, a separate, already-complete-but-uncommitted body of work from before this conversation started (startup-perf fixes, broader text/archive-preview support, the generic busy indicator, pane-collapse animation fix, spinning refresh icon, extract-into-subfolder-with-conflict-prompt). Round 5's own detailed history lived in the previous version of this file; it's summarized here for continuity but the exhaustive blow-by-blow (including two real bugs caught via live browser-console inspection) is preserved in that prior revision if needed — `git log -p` on this file's previous commit, or ask to have it reconstructed.

## Status: Phase 1 implemented, typechecked, and built clean — not yet verified against a real SFTP/SSH server

`npm run typecheck` and `npm run build` are clean after every change in this session. As with every prior round, **no tool available here can drive the actual Electron window against a real server or type into its UI** — this remains the standing verification gap (see roadmap Phase 3) and is the single most important next step before trusting any of this in daily use.

## Files actively edited this session (Phase 1)

**Main process:**
- `src/main/fs/LocalFsService.ts` — added `listRecursive()` (depth-first local directory walk) and `mkdirRecursive()`.
- `src/main/ssh/RemoteShell.ts` — added `readdirRecursive()` (same shape, over SFTP) and `mkdirRecursive()` (`mkdir -p` via `shellEscape`).
- `src/main/transfer/TransferQueue.ts` — added directory-tree transfer support (see below); this was the biggest single change.
- `src/main/ipc/transfer.ipc.ts` — `transfer:enqueue` now takes an `isDir` flag and dispatches to `enqueueTree()` vs `enqueue()`.
- `src/main/ipc/envelope.ts` — added `handleWithEvent()`, a variant of `handle()` that also hands the handler the raw `IpcMainInvokeEvent` (needed for `event.sender.startDrag`).
- `src/main/ipc/system.ipc.ts` — added the `system:startDrag` handler.
- `src/shared/contract.ts` — added the `systemStartDrag` channel.

**Renderer:**
- `src/renderer/src/utils/fileSort.ts` (new) — pure `compareEntries(column, direction)`.
- `src/renderer/src/utils/fileSelection.ts` (new) — pure `selectOnly`/`toggleSelect`/`selectRange`/`selectAll`.
- `src/renderer/src/stores/localFs.store.ts`, `remoteFs.store.ts` — sort state, selection-anchor state, `rename()`, and the new selection actions; both now import the two new util modules instead of each having their own inline logic.
- `src/renderer/src/stores/transferQueue.store.ts` — `enqueue()` takes an `isDir` param.
- `src/renderer/src/components/files/FileRow.vue` — inline rename input, right-click `ContextMenu` (rename/copy-path/transfer/tail/extract/delete), native-OS-drag handoff for local rows, transfer button/drag no longer gated on `!entry.isDir`.
- `src/renderer/src/components/files/FileList.vue` — sortable column-header row, threads rename/context-menu/sort events through to `FilePane.vue`.
- `src/renderer/src/components/files/FilePane.vue` — F2/Ctrl+A keybindings, rename handlers, `onSelect` (click/ctrl/shift dispatch), OS-file-drop handling (`isOsFileDrag`/`onOsDrop`) on the remote pane, bulk-transfer-selected handler.
- `src/renderer/src/components/files/FileToolbar.vue` — "Upload/Download N selected" button.

**Docs:**
- `.claude/plan/ferry-winscp-parity-roadmap.md` (new) — the full gap analysis + phased plan.
- `.claude/PROJECT_MAP.md` — updated for all of the above (new conventions for the tree-transfer job model, the shared sort/selection utils, the two drag-and-drop mechanisms, the `@nuxt/ui` deep-import pattern for not-yet-scanned components); replaced the now-false "no recursive transfer" gotcha with a forward-looking note about `File.path` being an Electron-version-dependent API.
- `CHANGELOG.md`, `package.json`, `VERSION` — bumped to 0.5.0, covering both Round 5 and Phase 1.

## Changes made (by feature)

1. **Recursive directory transfer.** `TransferQueue`'s `TransferJob` gained an `isTree` flag; tree jobs share the exact same `pending`/`active` queue and cancel path as single-file jobs (so `MAX_CONCURRENT` and cancellation needed zero changes), but `runTree()` walks the source tree, recreates the destination directory structure, and transfers files **sequentially** (not fanned out), aggregating byte progress across the whole tree into one throttled `progress` event under the job's single `transferId` — the renderer never learns a tree job contains more than one file. The single-file streaming core was extracted into `runFile()`, shared by both job types.
2. **Rename.** The backend IPC already existed (`fs:local:rename`/`fs:remote:rename`) but nothing in the UI called it. Added F2 + a context-menu entry, both driving an inline `<UInput>` that replaces the row's name label.
3. **Column sorting** and **4. real multi-select** (Explorer-style click/Ctrl/Shift/Ctrl+A) were implemented together since both stores needed the same shape of change — extracted into shared pure-function modules (`fileSort.ts`, `fileSelection.ts`) rather than duplicating logic across `localFs.store.ts` and `remoteFs.store.ts`.
5. **Right-click context menu** using `@nuxt/ui`'s `ContextMenu` component — imported via its public `./components/*` deep-import path rather than relying on global `<UContextMenu>` registration, since that component had never been used anywhere in the app yet and the auto-generated `components.d.ts`/ambient types only cover components a previous Vite pass has already scanned (confirmed this actually type-checks before assuming it would).
6. **OS drag-and-drop.** Two distinct mechanisms, chosen deliberately: dropping files from Explorer (or dragging a local row via the new native-drag path) onto the remote pane triggers an upload; local rows hand off to `WebContents.startDrag` via a new `system:startDrag` IPC call instead of the old in-app-only payload, so they can *also* land on Explorer/another app. Remote-row drag-out to the OS was explicitly **not** attempted — it would require downloading a temp copy synchronously within the drag gesture, which doesn't fit the browser drag-and-drop lifecycle without much more engineering; documented as a known gap rather than silently skipped.
7. **Bulk transfer.** A toolbar button appears whenever the pane has ≥1 selected row, enqueueing every selected entry (files and folders) through the same per-entry path bulk single-item transfers already used — this fell out almost for free once (1) and the selection rework were in place.

## Everything tried that failed

Nothing shipped-then-reverted this session (unlike Round 5, which had two real bugs caught via live testing — see that history if reconstructing it). Two design decisions worth flagging as "almost went a different way":
- **Considered giving directory-tree transfers their own concurrency pool** (so files within one tree could transfer in parallel). Rejected in favor of sequential-within-a-tree to avoid a tree job silently exceeding `MAX_CONCURRENT` real SFTP streams when combined with other active jobs — a deliberate simplicity-over-throughput tradeoff, not an oversight, and called out in `PROJECT_MAP.md` as a legitimate future follow-up if it turns out to matter.
- **Considered calling `event.preventDefault()` unconditionally on every row's `dragstart`** to route all drags through `startDrag`. Reasoned through (not empirically tested, since that requires a live GUI) that this is safe only because Chromium's HTML5 DnD is already OS-native on Windows underneath, and scoped it to local rows only — remote rows keep the pre-existing in-app-only payload mechanism entirely untouched, since they have no real file to hand the OS.

Also worth a note for the next session: two of the three research agents disagreed at first on whether rename existed at all (backend agent found the IPC, frontend agent found no UI caller) — reconciled correctly as "backend capability, no UI wiring" rather than treating it as a contradiction, which is exactly what turned out to be true.

## Next step

1. **Manual verification against a real SFTP/SSH server** — unchanged standing gap, now even more important given how much of Phase 1 (drag-and-drop, recursive transfer, rename) touches actual file-transfer correctness. A local Docker `atmoz/sftp` or `linuxserver/openssh-server` target (per the roadmap's Phase 3) would let a human actually exercise: folder upload/download, sort, shift/ctrl multi-select, right-click actions, rename, and both drag-and-drop paths.
2. **Roadmap Phase 2** (security/auth parity): host-key verification (currently absent — a real MITM exposure, not just a UX gap), real keyboard-interactive/2FA instead of the current password-replay fake, SSH-agent + jump-host/proxy support, editable chmod, transfer retry.
3. **Roadmap Phase 4**: site folders/groups, per-file-type icons, sync/mirror, edit-in-place, and — flagged in the roadmap as the highest-leverage adoption unlock — importing existing WinSCP/PuTTY sessions.
4. Still no test suite. `fileSort.ts`/`fileSelection.ts` (pure, easy to unit test, now load-bearing for a core UX flow) would be good first targets, alongside `shellEscape.ts`/`archive.ts` called out in previous rounds.
5. Consider whether remote-row drag-out to the OS is worth the added complexity (temp-download-then-drag) given how it fits the roadmap's stated user — revisit after real-server testing shows whether users actually reach for it.

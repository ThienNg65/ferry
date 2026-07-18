# Handoff — File-op performance pass: exec-first delete, optimistic UI, parallel local stat (2026-07-17)

## Goal

User feedback: Ferry feels much slower than WinSCP (and than a plain terminal)
for delete/rename/chmod/"move to any folder" (navigating a local folder).
Concretely: `rm -rf a/` in a real shell is instant; deleting the same folder
`a/` from Ferry's file pane visibly waits. Goal was to find and fix the
actual causes, not just "make it feel faster" cosmetically — see
`.claude/plan/ferry-perf-fileops-plan.md` for the plan this session executed
against (also saved to `C:\Users\nvtthien\.claude\plans\read-the-hanoff-md-the-zippy-glacier.md`
by the harness).

## Status: all 4 planned fixes implemented and verified against a real SFTP/SSH test container; typecheck/build/tests all clean

`npm run typecheck`, `npm run build`, and `npm test` are all clean. Beyond
the usual mocked/pure-logic unit tests, this round's core claim — that
`deleteRecursive` now does ONE exec instead of N SFTP round-trips, and
correctly falls back when exec isn't available — was verified against a real
`linuxserver/openssh-server` Docker container (spun up, tested, torn down
this session; see "Everything tried that failed" for a real Windows/Git-Bash
gotcha hit while doing this). The full integration suite (`RemoteShell`,
`TransferQueue`, `SessionManager`) passed against that container; the
pre-existing `SessionManager.jumphost.integration.test.ts` failed, but this
looks like an environment-setup gap in the single ad-hoc container used this
session (jump-host testing needs a "self-jump" trick per an earlier session's
notes in this same file's history — not investigated further, unrelated to
this session's changes).

**As always, the Electron GUI itself was not visually driven this round** —
nothing in this environment can click into the actual app window. The
verification above is real (a live SSH server, live exec/SFTP calls,
assertions on actual before/after filesystem state) but it did not click a
"Delete" button in the running app.

## What was done

### 1. Remote recursive delete: one `rm -rf` exec instead of a per-entry SFTP walk

This is the direct fix for the user's own comparison. [`RemoteShell.ts`](src/main/ssh/RemoteShell.ts)'s
`deleteRecursive` used to `stat` → `readdir` → recurse → `unlink`/`rmdir`
one entry at a time — deleting a folder with hundreds of files was hundreds
of sequential SFTP round-trips. It now tries a single
`rm -rf -- ${shellEscape(path)}` exec first (same SSH connection already
kept open for Tail/Terminal/Unzip/Compress) and only falls back to the
renamed-private `deleteRecursiveSftp` walk if the exec throws (no shell
access at all — e.g. a restricted sftp-only chroot account) or exits
non-zero. `removeRemote` in `RemoteFsService.ts` needed no changes — it
already just calls `shell.deleteRecursive(path)`.

### 2. Stores patch the file list in place instead of reloading after every mutation

`remove`/`rename`/`chmod` in both [`localFs.store.ts`](src/renderer/src/stores/localFs.store.ts)
and [`remoteFs.store.ts`](src/renderer/src/stores/remoteFs.store.ts) used to
end with `await this.load()` — a full extra directory reload (an SFTP
`readdir` round-trip remotely, or a full local re-list) after an operation
that already told the store exactly what changed. They now patch `entries`
directly: `remove` filters the deleted path out, `rename` finds-and-updates
the entry then re-sorts (a new name can change alphabetical position),
`chmod` (remote only) just overwrites `entry.permissions` in place (padded to
the existing 4-digit octal format if the dialog handed back a 3-digit one).

### 3. Multi-select delete: parallel, with one patch, instead of N sequential (delete+reload) round-trips

Added `removeMany(entries)` to both stores: fires every delete concurrently
via `Promise.allSettled`, then patches `entries`/`selected` once at the end.
Entries whose delete failed stay in the listing; if any failed, `removeMany`
throws an `Error` naming them so the caller can show one toast instead of
silently losing the failure. [`FilePane.vue`](src/renderer/src/components/files/FilePane.vue)'s
`onKeydown` (Delete/Backspace on a multi-selection) now calls
`await store.removeMany(targets)` wrapped in try/catch → `notify.error(...)`,
instead of the old `for (const entry of targets) { await store.remove(entry) }`
loop — which, combined with fix #2 above, used to mean N sequential
(delete + full directory reload) round-trips for an N-file multi-delete.

### 4. Local directory listing stats entries in parallel

[`LocalFsService.ts`](src/main/fs/LocalFsService.ts)'s `list()` used to
`for (const dirent of dirents) { await fs.stat(...) }` one at a time. Changed
to `Promise.all(dirents.map(...))`, keeping the same "vanished/inaccessible
entry gets silently skipped" behavior (now via returning `null` and filtering
it out, instead of `continue`). This is the fix for "move to any folder"
(interpreted as: opening/navigating a local folder with many entries) —
remote listing didn't have this problem since SFTP's `readdir` already
returns full attrs per entry in one round-trip, no follow-up stat needed.

## Files actively edited this session

- `src/main/ssh/RemoteShell.ts` — `deleteRecursive` (exec-first) + new private `deleteRecursiveSftp` (renamed from the old body)
- `src/main/ssh/RemoteShell.integration.test.ts` — two new real-server tests: one asserting exactly one `exec()` call deletes a nested tree, one forcing `exec()` to reject (`vi.spyOn`) and asserting the SFTP fallback still deletes correctly
- `src/main/fs/LocalFsService.ts` — `list()`'s stat loop parallelized
- `src/renderer/src/stores/localFs.store.ts` — `remove`/`rename` optimistic patch, new `removeMany`
- `src/renderer/src/stores/remoteFs.store.ts` — `remove`/`rename`/`chmod` optimistic patch (per-session bucket), new `removeMany`
- `src/renderer/src/components/files/FilePane.vue` — multi-select delete (`onKeydown`) calls `removeMany` + notifies on failure, instead of looping singular `remove`
- `.claude/PROJECT_MAP.md` — two new Conventions bullets (exec-first delete + optimistic store patching) and three new "Where to go for X" rows
- `.claude/plan/ferry-perf-fileops-plan.md` (new) — copy of the approved plan, per standing preference to keep plans in-repo

No `shared/contract.ts` changes — every fix reuses existing IPC channels; batching is client-side (`Promise.allSettled` over the existing single-path delete channel), not a new bulk IPC call.

## Everything tried that failed (or needed a second pass)

- **Verifying against a real test container hit a genuine Windows/Git-Bash gotcha, not a code bug.** Spun up `linuxserver/openssh-server` (per this repo's existing `RemoteShell.integration.test.ts` docker command) and ran `docker exec ferry-test-sftp mkdir -p /config/ferry-test` + `chown` to set up the test directory. Every single test in the suite then failed with `Failed to create ".../<uuid>": No such file` — looked at first like a real regression. It wasn't: this Bash tool runs Git Bash (MSYS), which auto-rewrites any argument that looks like an absolute POSIX path (`/config/ferry-test`, `/etc/passwd`, etc.) into a Windows path *before* invoking `docker.exe` — so `docker exec ferry-test-sftp mkdir -p /config/ferry-test` was silently creating some other mangled path inside the container, not the real `/config/ferry-test`, and every subsequent `ls`/`cat` "confirming" it worked was checking that same mangled path, not reality. Fixed by exporting `MSYS_NO_PATHCONV=1` before any `docker exec ... <container-absolute-path>` command, then redoing the `mkdir`/`chown` for real — after which all 17 `RemoteShell.integration.test.ts` tests (including the two new ones) passed. **Worth remembering for any future session that shells out to `docker exec`/`docker run` with container-side absolute paths from this Bash tool on this machine.**
- **`SessionManager.jumphost.integration.test.ts` failed** (`Jump host tunnel to 127.0.0.1:2222 failed: Channel open failure`) against the single ad-hoc container this session stood up — everything else (17 `RemoteShell` + 5 `TransferQueue` + 4 `SessionManager` tests) passed against the same container. Didn't dig further since it's orthogonal to this session's file-op-perf work; a prior session's `PROJECT_MAP.md` notes jump-host was previously verified via a "self-jump trick" against the test container, which may need setup this session's single-container spin-up didn't replicate (e.g. `AllowTcpForwarding` or a second target container). Flag this if a future session needs jump-host specifically verified again.
- **Nothing else failed** — the actual code changes (exec-first delete, optimistic store patches, `removeMany`, parallel local stat) all landed cleanly on the first pass, typecheck/build clean, no test regressions.

## Next step

1. **Manual GUI verification, as always** — the Electron window itself hasn't been clicked through in this environment. Specifically worth confirming by hand: deleting a remote folder with 50+ files now feels instant rather than stepping through each file; multi-selecting 5-10 remote files and deleting doesn't visibly stutter; rename/chmod update the row without a full-list "flash"; opening a local folder with many files (e.g. Downloads) feels faster than before. Site to use per prior sessions: `127.0.0.1:2299` / `ferrytest` / `ferrytest123`, SFTP (spin up the same `linuxserver/openssh-server` container — see `RemoteShell.integration.test.ts`'s file header for the exact command — **remember `MSYS_NO_PATHCONV=1` for any `docker exec` with container-absolute-path arguments if driving it from this same Git-Bash tool**).
2. **`mkdir`'s optimistic-insert was deliberately left out this round** (the plan flagged it as optional/lower-priority since it wasn't part of the user's complaint) — `mkdir` in both fs stores still calls `await this.load()`. If a future session wants full consistency with the new patch-in-place convention, add it there too, following the same pattern as `rename`'s re-sort.
3. **Everything already flagged in prior rounds and still untouched**: sync/mirror local↔remote directories and edit-in-place (Phase 4 items 3/4, still not started — see `.claude/plan/ferry-winscp-parity-roadmap.md`), auto-update needing a real GitHub repo + release + signing cert, the two accepted-risk security findings (host-key-mismatch override has no nonce; `known_hosts.json`/`sites.json` have no integrity protection), and WinSCP folder-group (nested registry subkey) import recursion.
4. **Jump-host integration test failure (see above)** — worth a dedicated look if jump-host functionality itself is ever in question; not believed to be caused by this session's changes (none of this session's edits touch `SessionManager.ts` or jump-host code at all).

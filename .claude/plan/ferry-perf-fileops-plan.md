# Make file operations (delete/rename/chmod/move-into-folder) feel instant

## Context

The user compared Ferry unfavorably to WinSCP and to a plain `rm -rf a/` in a
terminal: deleting a folder over SFTP in Ferry visibly waits, where a raw
`rm -rf` "just happens." Reading the actual code confirms this isn't a vague
perception — there are two concrete, compounding causes, both in code paths
the user's own examples point straight at (delete, rename, "modified"/chmod,
navigating into a folder). Neither is inherent to SFTP; both are self-inflicted
by this app's current implementation.

**Cause 1 — recursive remote delete is O(N) network round-trips, not O(1).**
[`RemoteShell.deleteRecursive`](src/main/ssh/RemoteShell.ts:467) has no native
recursive delete over SFTP, so it walks the tree itself: `stat` → `readdir` →
recurse into every child → `unlink`/`rmdir` each one, one at a time, awaited
sequentially. Deleting a folder with 500 files is ~1000+ sequential SFTP
round-trips. A real `rm -rf a/` run over the *same* SSH connection (which this
app already has open, and already uses for Tail/Terminal/Unzip/Compress) is
one exec call, regardless of tree size.

**Cause 2 — every mutation reloads the whole directory afterward, and
multi-select delete does this once *per selected file*.** `remove`/`rename`/
`chmod` in both [`localFs.store.ts`](src/renderer/src/stores/localFs.store.ts)
and [`remoteFs.store.ts`](src/renderer/src/stores/remoteFs.store.ts) all end
with `await this.load()` — a full re-list of the current directory — even
though the caller already knows exactly what changed and could just patch its
own in-memory `entries` array. Worse,
[`FilePane.vue`'s multi-select delete handler](src/renderer/src/components/files/FilePane.vue:354)
(`Delete`/`Backspace` key) loops `for (const entry of targets) { await
store.remove(entry) }` — so selecting 10 files and deleting them today issues
10 sequential (delete + full-reload) round-trips, one entirely blocking the
next.

**A secondary contributor — local directory listing stats every entry
serially.** [`LocalFsService.list()`](src/main/fs/LocalFsService.ts:11) does
`for (const dirent of dirents) { await fs.stat(...) }` one at a time. This is
what makes "move to any folder" (i.e. opening/navigating into a folder in the
Local pane) slower than it needs to be on directories with many entries.

None of this touches transfer (upload/download) performance, archive
extraction/creation's actual exec commands (already single-round-trip and
fine), or anything the user didn't flag.

## Plan

### 1. Remote recursive delete: one `rm -rf`, not a tree walk

In [`RemoteShell.ts`](src/main/ssh/RemoteShell.ts:467), rename the current
`deleteRecursive` body to a private `deleteRecursiveSftp` fallback, and make
the public `deleteRecursive` try a single exec first:

```ts
async deleteRecursive(remotePath: string): Promise<void> {
  const escaped = shellEscape(remotePath)
  try {
    const result = await this.exec(`rm -rf -- ${escaped}`, { timeoutMs: 5 * 60 * 1000 })
    if (result.code === 0) return
    // Non-zero from a reachable shell (e.g. permission edge case) — fall through
    // to the SFTP-only path below rather than guessing at stderr.
  } catch {
    // No exec capability at all (rare: sftp-only chroot/jail accounts) — fall back.
  }
  await this.deleteRecursiveSftp(remotePath)
}
```

Reuse the existing `shellEscape` helper (already imported in this file) —
same pattern as `UnzipService`/`CompressService`/`TerminalManager`. This is
the direct fix for the user's own `rm -rf` comparison: a whole tree becomes
one SSH exec channel instead of N SFTP round-trips. `removeRemote` in
[`RemoteFsService.ts`](src/main/fs/RemoteFsService.ts:61) needs no change —
it already just calls `shell.deleteRecursive(targetPath)`.

No test currently exercises the walk-vs-exec choice; add a case to
`RemoteShell.integration.test.ts` (real test container) confirming a
multi-file nested directory is gone after one call, and — if easy to simulate
— that a failing/absent `rm` still falls back to correctly deleting via SFTP.

### 2. Stop reloading the whole directory after every mutation — patch in place

In both `localFs.store.ts` and `remoteFs.store.ts`, replace the trailing
`await this.load()` with an in-memory patch of `entries` (and `selected`),
using each store's existing `compareEntries`/sort machinery where order can
change:

- **`remove(entry)`**: after the IPC call succeeds, filter `entry.path` out of
  `entries` and out of `selected`. No re-sort needed (removing an item can't
  change relative order of the rest).
- **`rename(entry, newName)`**: after the IPC call succeeds, find the entry by
  old `path`, update its `name`/`path` in place, then re-run
  `entries = [...entries].sort(compareEntries(sortColumn, sortDirection))`
  (renaming can change alphabetical position when sorted by name).
- **`chmod(entry, mode)`** (remote only): patch `entry.permissions` in place.
  No re-sort needed.
- **`mkdir(name)`**: optionally patch-insert a synthetic entry (`isDir: true`,
  `size: 0`, `modifiedAt: new Date().toISOString()`, `permissions` omitted/
  `'0755'` for remote) then re-sort, instead of reloading — same pattern,
  lower priority since mkdir wasn't part of the complaint, but keeps the
  stores consistent (do this one only if it's not extra friction).

This removes an entire SFTP `readdir` round-trip (remote) or a full
serially-stated directory re-list (local) from every delete/rename/chmod —
on top of fix #1, not instead of it.

`FilePane.vue`'s Ctrl+R "refresh" (`store.load()`) and the mkdir dialog's own
explicit refresh (if kept) are unaffected — this only removes the *implicit*
reload baked into remove/rename/chmod.

### 3. Multi-select delete: parallel, not sequential-with-a-reload-each

Add a `removeMany(entries: FileEntry[])` action to both stores: fire all the
IPC delete calls concurrently (`Promise.all`), then patch `entries`/`selected`
once at the end (removing every successfully-deleted path). Update
[`FilePane.vue`'s `onKeydown`](src/renderer/src/components/files/FilePane.vue:354)
to call `await store.removeMany(targets)` instead of the current
`for (const entry of targets) { await store.remove(entry) }` loop.

Since fix #1 already makes each remote delete O(1) instead of O(tree size),
concurrent top-level deletes over one SSH connection (separate exec channels)
is safe without needing a bounded-concurrency pool — multi-select delete
counts are user-driven (tens, not thousands). If that assumption ever proves
wrong in practice, bound it the same way `TransferQueue`'s private
`runConcurrent`/`TREE_ITEM_CONCURRENCY` already does for tree transfers — no
need to build that now.

Keep the existing single-row delete path (`@remove="(entry) =>
store.remove(entry)"` in `FilePane.vue`) calling singular `remove()` — only
the multi-select key handler changes.

### 4. Parallelize local directory listing's per-entry stat

In [`LocalFsService.ts`](src/main/fs/LocalFsService.ts:11), change `list()`'s
sequential `for (const dirent of dirents) { await fs.stat(...) }` loop to
`Promise.all(dirents.map(async (dirent) => { ... }))`, keeping the existing
try/catch-and-skip behavior for vanished/inaccessible entries (a per-entry
`.catch(() => null)` filtered out of the final array, same semantics as
today's `continue`). This speeds up opening any local folder with many
entries — directly addresses "move to any folder" if that's Local-pane
browsing, and costs nothing on small directories.

## Files to change

- [`src/main/ssh/RemoteShell.ts`](src/main/ssh/RemoteShell.ts) — `deleteRecursive` becomes exec-first with SFTP fallback (renamed to `deleteRecursiveSftp`)
- [`src/main/fs/LocalFsService.ts`](src/main/fs/LocalFsService.ts) — parallelize `list()`'s stat loop
- [`src/renderer/src/stores/localFs.store.ts`](src/renderer/src/stores/localFs.store.ts) — optimistic `remove`/`rename`, new `removeMany`
- [`src/renderer/src/stores/remoteFs.store.ts`](src/renderer/src/stores/remoteFs.store.ts) — optimistic `remove`/`rename`/`chmod`, new `removeMany`
- [`src/renderer/src/components/files/FilePane.vue`](src/renderer/src/components/files/FilePane.vue) — multi-select delete calls `removeMany` instead of looping `remove`
- `src/main/ssh/RemoteShell.integration.test.ts` — new coverage for the exec-first delete path

No `shared/contract.ts` changes needed — every fix reuses existing IPC channels (`fs:remote:delete`, `fs:local:delete`, `fs:remote:rename`, `fs:remote:chmod`); batching happens client-side via `Promise.all` over the existing single-path channel, not a new bulk channel.

## Verification

1. `npm run typecheck && npm run build && npm test` — must stay clean (114+ tests).
2. Manual GUI check against the existing test container (`127.0.0.1:2299` / `ferrytest` / `ferrytest123`, per `handoff.md`):
   - Create a remote folder with ~50+ files (e.g. `for i in $(seq 1 50); do touch f$i; done` via the Terminal dock tab), then delete it from the file pane — should feel instant (one exec round-trip) instead of visibly stepping through each file.
   - Multi-select 5-10 remote files and delete — should complete without a visible per-file stutter, and the list should update without a full re-fetch flash.
   - Rename a remote file and chmod one — same instant-feeling update, no reload flash.
   - Open a local folder with many files (Downloads or similar) and compare perceived navigation speed before/after.
3. Confirm the SFTP-fallback path still works for correctness (even if not perf-critical) — e.g. by temporarily forcing `exec()` to reject in a debugger/test, or trusting the added integration test.

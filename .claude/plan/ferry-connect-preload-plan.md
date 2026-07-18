# Fix: fold the first remote directory listing into the "connecting" phase

## Context

`handoff.md` documents a prior perf pass on file *operations* (delete/rename/chmod,
local listing) — unrelated to this issue. The user separately noticed that in
WinSCP, the connect dialog ("Searching for host…" → "Authenticating…" →
"Reading remote directory…" → "Session started.") stays open until the initial
directory listing is already in hand, so the file browser paints instantly the
moment it closes. In Ferry, connecting *feels* like it has an extra loading
step after the connect spinner goes away — this plan traces why and fixes it.

Root cause (confirmed by direct code reading, then independently re-verified by
two background investigations):

1. `src/main/ssh/SessionManager.ts`'s `connect()` (~line 323) only performs the
   SSH handshake/auth/host-key verification. It resolves as soon as the client
   is `ready` — it never lists the remote directory.
2. `src/renderer/src/stores/sessions.store.ts`'s `openSession()` (~line 206)
   awaits that connect, then immediately sets `tab.sessionId` and
   `tab.status = 'connected'` — nothing here fetches a listing.
3. `src/renderer/src/App.vue`'s `isConnected` (line 24,
   `sessions.status === 'connected'`) gates the swap from the picker
   (`SessionManagerView`) to the file browser (`FilePane` × 2 + `BottomDock`)
   — and flips the instant SSH auth succeeds, not when data is ready.
4. Only *after* that swap does `src/renderer/src/components/files/FilePane.vue`'s
   remote-side watcher (~line 65) fire, calling `remoteFs.store.ts`'s `load()`
   (~line 98) — the actual first `fs:remote:list` (SFTP `readdir`) round-trip.

So today's sequence is: connect spinner closes → an *empty* file-browser shell
mounts → a second, separate network round-trip fetches the listing (its own
loading indicator: `FileToolbar`'s spinner, title-bar "Loading directory…").
WinSCP instead keeps its own connecting UI up through that step, so nothing
empty is ever shown.

## Fix

Extend the renderer's `connecting` phase to also cover the first directory
listing, so the view only swaps once the listing is already cached — matching
WinSCP's single continuous dialog.

**Important design detail (a real race, not hypothetical):** Ferry supports
multiple concurrent site tabs, each independently `connecting` in the
background. If the preload were done via the existing `load()` (which resolves
its target session from `useSessionsStore().activeSessionId` — i.e. "whichever
tab is active *right now*"), and the user switches tabs while a connect is
still in flight, the preload would either clobber a *different*, already-open
tab's listing, or throw "No active session" and falsely mark the connecting
tab as `error` even though its SSH connect fully succeeded. The fix is a new
method that takes the session id explicitly, decoupled from "current active
tab" entirely.

### 1. `src/renderer/src/stores/remoteFs.store.ts`

Split today's `load()` (~lines 98-114) into two:

- `load(dirPath?)` — unchanged public contract: still resolves
  `this.activeSessionId()` itself (throws if no active tab) and delegates to
  the new method. Every existing call site (`FilePane.vue`'s watcher/Ctrl+R,
  `openDir`/`goUp`/`mkdir`, the refresh button) keeps identical behavior.
- `loadForSession(sessionId: string, dirPath?: string)` — the actual
  fetch-and-patch logic (`ensureBucket`, `entry.loading`/`error`, the
  `fsRemoteList` invoke, sort/select reset), parameterized by an explicit
  `sessionId` instead of reading "current active session."

```ts
async load(dirPath?: string): Promise<void> {
  await this.loadForSession(this.activeSessionId(), dirPath)
},

async loadForSession(sessionId: string, dirPath?: string): Promise<void> {
  const entry = this.ensureBucket(sessionId)
  entry.loading = true
  entry.error = null
  try {
    const result = await invoke<FileListResult>(INVOKE_CHANNELS.fsRemoteList, sessionId, dirPath)
    entry.currentPath = result.path
    entry.entries = result.entries.sort(compareEntries(entry.sortColumn, entry.sortDirection))
    entry.selected = new Set()
    entry.selectAnchor = null
  } catch (e) {
    entry.error = e instanceof Error ? e.message : String(e)
  } finally {
    entry.loading = false
  }
},
```

### 2. `src/renderer/src/stores/sessions.store.ts`

In `openSession()` (~lines 224-234), preload before flipping `tab.status`:

```ts
const result = await invoke<SessionOpenResult>(INVOKE_CHANNELS.sessionOpen, {
  ...request,
  trustHostKeyChange
})
tab.sessionId = result.sessionId
// Preload the initial listing before flipping `status` — App.vue's
// picker→file-browser swap is gated on `status`, so this keeps the
// connecting/spinner UI up through the SFTP readdir too, instead of
// swapping to an empty file-browser shell first. Uses the explicit-sessionId
// variant, not `load()`, since this tab may no longer be `activeTab` by the
// time this resolves if the user switched tabs mid-connect.
await useRemoteFsStore().loadForSession(result.sessionId)
tab.status = result.status
notify.success(`Connected to ${label}`)
void useTerminalStreamsStore().ensureTerminal(result.sessionId)
```

`useRemoteFsStore` is already imported in this file (used by `closeTab()`) —
no new import needed. `loadForSession`/`load()` never rethrow (failures are
caught internally into `entry.error`), so this `await` cannot turn a
successful SSH connect into a `catch`-block "Connection failed" — a listing
failure (e.g. permission denied on the configured start path) surfaces later
via the existing `UAlert v-if="store.error"` in `FilePane.vue`, same as any
other failed `load()` today.

### Explicitly out of scope (checked, confirmed safe to leave alone)

- **Local pane's first load** (`FilePane.vue`'s `onMounted(() => void
  store.load())` for `side === 'local'`) — local disk, no network round-trip,
  already parallelized per `handoff.md`'s July-17 pass. Not the WinSCP-parity
  problem being solved here.
- **`remoteFs.store.ts`'s other actions** (`rename`/`chmod`/`remove`/
  `removeMany`/selection actions) — all resolve `activeSessionId()`
  synchronously as their first line, before any `await`, so they're safe by
  construction (session captured at click-time, same principle as
  `openSession()`'s existing `const tab = this.activeTab` capture).
- **`mkdir()`'s trailing `await this.load()`** (line ~142) — this one *does*
  re-resolve `activeSessionId()` after an `await`, a narrower instance of the
  same class of bug (could refresh the wrong tab if the user switches tabs
  mid-mkdir). Pre-existing, unrelated to this fix, not made worse or better by
  it — leave untouched, flag if it ever surfaces as a real complaint.
- Every other reader of `sessions.status`/`isConnected` (`FilePane.vue`'s
  `transferIcon`/`showTail`/drag-target checks, `SessionManagerView.vue`'s
  error alert) only matters *after* `FilePane` has already mounted, i.e. after
  the (now slightly later) `isConnected` flip — unaffected.

## Verification

- `npm run typecheck` and `npm run build` (no server/network needed).
- No existing unit/integration test covers `sessions.store.ts`/
  `remoteFs.store.ts` (Pinia stores aren't in the current test list — see
  `.claude/PROJECT_MAP.md`'s Build/run/test section), so this is a behavioral
  change without a regression test to update.
- **Manual GUI verification is required** (as `handoff.md` notes for every
  prior round — this environment cannot click into the actual Electron
  window): connect to a real site (e.g. the `linuxserver/openssh-server` test
  container / `127.0.0.1:2299` per `handoff.md`'s "Next step" section, or a
  real SFTP server) and confirm the file browser now appears already
  populated — no visible empty-shell flash or second spinner — while the
  per-tab/button "connecting" spinner correctly stays up slightly longer to
  cover it. Also verify: opening a second tab and switching away from a
  still-connecting first tab doesn't corrupt either tab's listing (the race
  this design specifically guards against) — connect two sites, switch tabs
  mid-connect on one of them, confirm both end up showing their own correct
  directory once ready.

## Status (2026-07-17)

Implemented: `remoteFs.store.ts`'s `load()`/`loadForSession()` split and
`sessions.store.ts`'s `openSession()` preload, exactly as designed above.
`npm run typecheck` and `npm run build` both clean. `npm run dev` boots
cleanly (main+preload+renderer all build, Electron window starts, no new
console errors — only pre-existing devtools/GPU-shutdown noise unrelated to
this change). Electron GUI itself was not visually clicked through in this
environment (same limitation as every prior round, per `handoff.md`) — a
`linuxserver/openssh-server` test container was spun up at `127.0.0.1:2299`
(`ferrytest`/`ferrytest123`, `/config/ferry-test` populated with 30 files) for
whoever does the manual click-through described in "Verification" above.

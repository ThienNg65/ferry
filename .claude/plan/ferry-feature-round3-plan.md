# Ferry round-3: named sessions, browser-like site tabs, collapsible Local rail, SSH Terminal

## Context

Round-2 (see `handoff.md`, commit `b372122`) shipped saved sites, file preview, downloads/toasts, hide-Local toggle, and a custom titlebar — but the app is still strictly single-session: one `activeSessionId` at a time, connecting to a new site replaces whatever was open. The backend (`SessionManager`) already pools multiple concurrent SSH connections keyed by UUID; the renderer just never uses that. Real usage feedback now asks for four things:

1. The header should show the site's name, not a raw session UUID.
2. Real browser-like tabs — open several sites at once, switch between them instantly.
3. The hide-Local toggle button should live in the Local panel's own row, not the app's global top bar.
4. A "Terminal" dock tab (next to "Activity") giving an interactive SSH shell into whichever site tab is currently active.

(2) is the architecturally significant one — it turns the renderer's session model from a single slot into a collection, which (1) piggybacks on for free, and which (4) must integrate with structurally (a terminal follows "the current site", so it needs the same multi-session awareness).

Two decisions were confirmed with the user up front:
- **Hide-Local UX**: collapse to a slim always-visible rail (not full unmount) — the toggle must stay reachable.
- **Tab connections**: all open site tabs stay connected simultaneously (true browser feel, instant switching) — backend already supports this, no backend pooling changes needed.

A design-validation pass (independent review against the real `ssh2` API and a repo grep for unsafe direct-state-assignment call sites) informed several of the details below — most importantly the `ssh2.Client.shell()` call shape, the one call site that breaks a naive Pinia getter refactor, and the fact that keeping xterm.js instances alive (not the DOM) is what actually preserves terminal scrollback across tab switches.

**Deliberately out of scope for this round** (call out during implementation, don't build): per-tab filtering of the Transfers queue / Log Tail streams / Activity log (all three stay global lists shared across every open site tab, as they are today); persisting open tabs across app restarts; multiple terminals per site (one terminal per connected session, not a multi-terminal sub-tab strip like Log Tail's).

---

## 1. Session name instead of UUID

Falls out of the tabs refactor below: each `SessionTab` carries a `label` (site name, or `input.name || input.host` for quick-connect — reusing the exact fallback `sessions.store.ts` already computes today). The tab chip in the new `SiteTabBar.vue` displays `label`, and the raw `Session {{ sessions.activeSessionId }}` line in `App.vue:23` is deleted outright (the tab bar already shows the name; no need to repeat it in a second bar).

---

## 2. Browser-like site tabs

### `src/renderer/src/stores/sessions.store.ts` — collection instead of a single slot

```ts
interface SessionTab {
  tabId: string                  // crypto.randomUUID(), stable for the tab's life
  sessionId: string | null       // null while the tab is in "picker" state (not connected yet)
  label: string | null
  status: SessionStatus | null   // null = picker
  statusMessage: string | null
  connecting: boolean
}
interface SessionsState {
  tabs: SessionTab[]
  activeTabId: string
  unsubscribeStatus: (() => void) | null
}
```

- Init state with exactly one picker tab (`tabId: crypto.randomUUID()`), set as `activeTabId` — there is always ≥1 tab.
- **Back-compat getters**: `activeTab`, `activeSessionId`, `status`, `statusMessage`, `connecting` all resolve from `tabs.find(t => t.tabId === activeTabId)`. This lets `App.vue`, `FilePane.vue`, `SessionManagerView.vue` keep reading `sessions.activeSessionId`/`.status`/`.connecting` completely unchanged — **verified via grep that nothing external ever assigns to these fields directly** (only `===` comparisons exist today), so shadowing them with getters is safe. Internally, actions must mutate the specific tab object (`tab.status = ...`), never `this.status`.
- `openSession(request, label)` and therefore `connect()`/`connectToSite()` keep their exact current signatures and operate on `this.activeTab` implicitly — **`SessionManagerView.vue` needs zero changes**, since it's only ever rendered while the active tab is in picker state.
- New actions: `openNewTab()` (push a fresh picker tab, activate it), `setActiveTab(tabId)`, `closeTab(tabId)`, `disconnectActiveTab()` (replaces today's `disconnect()` — closes the session but resets the tab to picker state in place rather than removing the tab).
- `closeTab(tabId)`: if the tab has a `sessionId`, `invoke(sessionClose, sessionId)` then clean up its footprint in the other two per-session stores (`useRemoteFsStore().clearSession(sessionId)`, `useTerminalStreamsStore().disposeForSession(sessionId)`) before splicing the tab out. If that empties `tabs`, immediately `openNewTab()` — never allow zero tabs. If the closed tab was active, activate a neighbor.
- `disconnectActiveTab()`: same session-close + cross-store cleanup, but resets the active tab's `sessionId`/`label`/`status` to null in place instead of removing it.
- `ensureStatusSubscription()`'s event handler changes from "drop if `evt.sessionId !== activeSessionId`" to: find the tab by `evt.sessionId` (`tabs.find(t => t.sessionId === evt.sessionId)`), no-op if not found (already closed), otherwise update that tab's status regardless of whether it's active, and toast "Connection lost" mentioning that tab's label. No special "expected close" guard is needed: confirmed `SessionManager.close()` broadcasts status `'disconnected'`, not `'error'`, so an intentional close/disconnect never trips the existing `wasConnected && status === 'error'` toast condition.

### `src/renderer/src/stores/remoteFs.store.ts` — keyed by session, same external surface

```ts
interface PerSessionFs { currentPath: string; entries: FileEntry[]; loading: boolean; error: string | null; selected: Set<string> }
interface RemoteFsState { bySession: Record<string, PerSessionFs> }
```

- Getters `currentPath`/`entries`/`loading`/`error`/`selected` each return `this.bySession[activeSessionId] ?? EMPTY_DEFAULT` (a single frozen module-level constant — never mutated, only read as a fallback for "no session yet"). **Do not lazily create the `bySession` entry inside a getter** (Pinia/Vue anti-pattern — side effects in computed getters). Instead, ensure the entry exists at the top of `load()` (`this.bySession[id] ??= { ...defaults }`) — the one and only actions-side mutation point, since every other action (`mkdir`, `remove`, `toggleSelect`) always runs after at least one `load()`.
- New action `clearSession(sessionId)` — `delete this.bySession[sessionId]` (called from `sessions.store.ts` on tab close/disconnect).
- **One call site needs a real fix, not just a getter**: `FilePane.vue`'s `onExtract` does `remoteFs.error = message` — a direct state assignment that breaks once `error` becomes a getter. Add a `setError(message: string | null)` action and change that one line to `remoteFs.setError(message)`. Grep confirmed this is the *only* direct external assignment to any of `currentPath`/`entries`/`error`/`selected`/`loading` in the whole codebase.

### `src/renderer/src/components/files/FilePane.vue`

- Remote side: replace `onMounted(() => void store.load())` with `watch(() => sessions.activeSessionId, (id) => { if (id && remoteFs.needsLoad(id)) void remoteFs.load() }, { immediate: true })`, where `needsLoad(sessionId)` is a new `remoteFs` getter (`!this.bySession[sessionId]`). This fires on initial mount (immediate) and every time the active tab switches to a session that's never been listed yet; switching back to an already-loaded session is instant (cached `bySession` entry, no re-fetch — this is the actual "browser tab" payoff). Local side keeps its existing `onMounted(() => void store.load())` unchanged.
- No other changes needed here for the tabs feature — see §3 below for the separate Local-collapse changes to this same file.

### New `src/renderer/src/components/shell/SiteTabBar.vue`

One chip per `sessions.tabs`: label (or "New Tab"), a small spinner icon while `connecting`, an error-dot icon when `status === 'error'`, a hover-revealed close (×) calling `sessions.closeTab(tabId)` (stop propagation), click-to-activate via `sessions.setActiveTab(tabId)`. Trailing `+` button calling `sessions.openNewTab()`. Follows existing tab-chip visual conventions already used for Log Tail's sub-tabs in `BottomDock.vue` (`bg-accented text-highlighted` active / `text-muted hover:bg-muted` inactive).

### `src/renderer/src/App.vue`

- Render `<SiteTabBar />` under `<TitleBar />`, always.
- Delete the `Session {{ sessions.activeSessionId }}` span entirely (name now lives in the tab chip).
- Keep a slim bar with just the `Disconnect` button (→ `sessions.disconnectActiveTab()`), shown only when the active tab is connected. The hide-Local button is removed from here — it moves into `FilePane.vue` itself (§3).
- `isConnected` computed stays `sessions.status === 'connected'` (now getter-backed, same read pattern).
- Both `<FilePane side="local">` and `<FilePane side="remote">` become **unconditionally mounted** (drop the `v-if="ui.showLocalPane"` — see §3 for why).

---

## 3. Hide-Local: collapse to a slim rail, in the Local panel's own row

In `src/renderer/src/components/files/FilePane.vue`:

- The pane's own header row (currently just `<span>{{ side }}</span>` in a `border-b` div at the top) gains a trailing toggle button, rendered only for `side === 'local'`:
  ```html
  <UButton v-if="side === 'local'" size="xs" variant="ghost" color="neutral"
    :icon="ui.showLocalPane ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'"
    @click="ui.toggleLocalPane()" />
  ```
- The rest of the pane's body (breadcrumb, toolbar, new-folder row, error alert, file list, preview dialog) wraps in `<template v-if="side !== 'local' || ui.showLocalPane">`.
- The pane's root div's width class becomes conditional: `side === 'local' && !ui.showLocalPane` → a fixed slim rail (e.g. `w-10 shrink-0`); otherwise the existing `min-w-0 flex-1`. Move this class logic into `FilePane.vue` itself (it already imports what it needs) rather than passed in from `App.vue`.
- Since the pane no longer fully unmounts, restore the safety property the original v-if gave for free: add `watch(() => ui.showLocalPane, (visible) => { if (!visible && props.side === 'local') previewOpen.value = false })` so collapsing the rail closes any open preview dialog instead of leaving it stranded.
- Minor accepted behavior change: local directory listing no longer force-refreshes every time you re-show the pane (previously a side-effect of the remount-via-v-if); not worth extra logic to preserve.

`ui.store.ts` needs no changes — `showLocalPane`/`toggleLocalPane()` are reused as-is.

---

## 4. Terminal — interactive SSH shell, next to "Activity"

### Backend

**`src/shared/contract.ts`** — add under a new `// terminal` section:
```ts
// INVOKE_CHANNELS
terminalOpen: 'terminal:open',     // (sessionId, cols, rows) -> TerminalOpenResult
terminalWrite: 'terminal:write',   // (terminalId, data: string)
terminalResize: 'terminal:resize', // (terminalId, cols, rows)
terminalClose: 'terminal:close',   // (terminalId)
// EVENT_CHANNELS
terminalData: 'terminal:data',     // TerminalDataEvent
terminalExit: 'terminal:exit',     // TerminalExitEvent

export interface TerminalOpenResult { terminalId: string }
export interface TerminalDataEvent { terminalId: string; data: Uint8Array }
export interface TerminalExitEvent { terminalId: string; exitCode: number | null }
```
`data` is `Uint8Array`, not `string` — forwarding raw bytes avoids splitting a multi-byte UTF-8 sequence across two chunk boundaries (a real risk with naive `chunk.toString()`); xterm.js's `Terminal.write()` accepts `Uint8Array` directly, so no decode step is needed in the renderer either. `Uint8Array` is a plain JS type, so this doesn't violate contract.ts's "no Electron/Node runtime dependency" rule.

**`src/main/ssh/RemoteShell.ts`** — add:
```ts
openShell(opts: { cols: number; rows: number }): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    this.client.shell({ term: 'xterm-256color', cols: opts.cols, rows: opts.rows }, (err, stream) => {
      if (err) { reject(new SshError('SSH_EXEC', err.message)); return }
      resolve(stream)
    })
  })
}
```
Confirmed `ssh2` v1.x shape: `shell(window, callback)` where `window` (`{term, cols, rows, height, width}`) is the pty-request object — matches the call above. Returned `ClientChannel` is a duplex stream (`.write()`, `.end()`, `data`/`close`/`exit` events) and supports `.setWindow(rows, cols, height, width)` for live resize — same primitives `execLines` already relies on.

**New `src/main/terminal/TerminalManager.ts`** — singleton mirroring `TailManager`'s shape:
- `Map<terminalId, { sessionId: string; stream: ClientChannel; exitCode: number | null }>`.
- `open(terminalId, sessionId, cols, rows)`: `SessionManager.getInstance().shell(sessionId).openShell({cols, rows})`, store the entry, wire:
  - `stream.on('data', chunk => broadcastData(terminalId, new Uint8Array(chunk)))`
  - `stream.on('exit', (code) => { entry.exitCode = code })` (capture — `'close'` alone doesn't carry the exit code)
  - `stream.on('close', () => { broadcastExit(terminalId, entry.exitCode); this.terminals.delete(terminalId) })`
- `write(terminalId, data: string)` → `entry.stream.write(data)` (plain string write for keystrokes is fine — the multi-byte-split risk only applies to incoming decoded output, not outgoing input).
- `resize(terminalId, cols, rows)` → `entry.stream.setWindow(rows, cols, 0, 0)`.
- `close(terminalId)` → `entry.stream.end()`, delete.
- `closeAllForSession(sessionId)` — mirrors `TailManager.stopAllForSession`.
- Private `broadcastData`/`broadcastExit` follow the exact `BrowserWindow.getAllWindows()...webContents.send(...)` pattern already used in `TailManager.ts`.

**`src/main/ssh/SessionManager.ts`** — in `close(sessionId)`, add `TerminalManager.getInstance().closeAllForSession(sessionId)` right next to the existing `TailManager.getInstance().stopAllForSession(sessionId)` call, before `entry.client.end()`.

**New `src/main/ipc/terminal.ipc.ts`** — `registerTerminalHandlers()` following the same `handle()` envelope pattern as `tail.ipc.ts`; register it in `main/index.ts`'s `registerAllHandlers()` alongside the others.

### Frontend

**New dependencies**: `@xterm/xterm`, `@xterm/addon-fit`.

**Key design point (from validation pass): keep the xterm `Terminal` instances alive in the store, not in the component.** A naive `v-if`/`v-else-if` dock-tab swap (like the existing Transfers/Tail/Activity branches) would destroy the DOM node xterm is attached to every time the user switches dock tabs and back, losing scrollback even though the remote shell process is untouched. Fix:

**New `src/renderer/src/stores/terminalStreams.store.ts`**:
- Holds a plain non-reactive cache: `const instances = new Map<string, { terminalId: string; term: Terminal; fit: FitAddon }>()` (module-scoped or stored via `markRaw` inside Pinia state — either way, never made reactive, since xterm manages its own internal state).
- `ensureTerminal(sessionId): Promise<string>` — returns the cached `terminalId` if present; otherwise `invoke(terminalOpen, sessionId, cols, rows)`, constructs a `new Terminal()` + `FitAddon`, caches it.
- **One subscription for the whole app**, set up once (e.g. lazily on first `ensureTerminal` call): `onEvent(terminalData, evt => { const inst = findByTerminalId(evt.terminalId); inst?.term.write(evt.data) })`. Not per-component — this is what lets background sessions keep filling their buffers while a different site tab or dock tab is showing.
- `write(terminalId, data)`, `resize(terminalId, cols, rows)`, `disposeForSession(sessionId)` (invoke `terminalClose`, `term.dispose()`, remove from cache — called from `sessions.store.ts`'s `closeTab`/`disconnectActiveTab`).

**New `src/renderer/src/components/terminal/TerminalView.vue`** — thin, always-mounted-once host:
- Renders one container `<div>` per session that has ever had a terminal opened (`v-for` over the store's known session ids), each `v-show="sessionId === sessions.activeSessionId"` (never `v-if` — that would destroy the attached DOM). A ref callback on first render of each container calls `terminalStreams.getInstance(sessionId)?.term.open(el)` exactly once per container (guard against xterm's `open()` being called twice on the same element).
- When the active session has no cached terminal yet (first time this session's Terminal tab is viewed) and the session is connected, call `terminalStreams.ensureTerminal(activeSessionId)`, which adds it to the known-session list, causing a new container to render.
- `term.onData(data => invoke(terminalWrite, terminalId, data))` wires keystrokes back.
- On the active session becoming visible (v-show flips to visible), `nextTick()` then `fit()` + `invoke(terminalResize, ...)` — a hidden (`display:none`) xterm reports zero dimensions, so fit/resize must happen on becoming visible, not just via a generic `ResizeObserver` on mount.

**`src/renderer/src/components/shell/BottomDock.vue`**:
- Extend `type DockTab = 'transfers' | 'tail' | 'terminal' | 'activity'`, add a "Terminal" button between "Log Tail" and "Activity", gated/disabled when the active session isn't connected (mirrors the existing `showTail` gating pattern in `FilePane.vue`).
- Pull `TerminalView` **out of** the mutually-exclusive `v-if`/`v-else-if` chain the other three tabs use. Instead, track a local `terminalEverShown` ref (set `true` the first time `tab === 'terminal'`), and render it as a sibling controlled by `v-show`:
  ```html
  <TransferQueue v-if="tab === 'transfers'" />
  <template v-else-if="tab === 'tail'"> ... </template>
  <ActivityLog v-else-if="tab === 'activity'" />
  <TerminalView v-if="terminalEverShown" v-show="tab === 'terminal'" />
  ```
  This is what makes the dock's own tab-switching (not just site-tab switching) preserve the terminal instead of destroying it — `BottomDock` itself already persists across site-tab switches as long as the active tab stays connected (it's outside the per-tab picker/connected branch in `App.vue`), so this one change covers both switching axes.

---

## Verification

Same hard limitation as round-2: no tool in this environment can drive the Electron desktop window (browser-automation tools only reach web pages) and there's no real SFTP/SSH server available here — this round cannot be hands-on UI-verified from this session either. What can and should be done:

1. `npm run typecheck` and `npm run build` clean, as before.
2. One `npm run dev` boot smoke test (watch main-process console for errors on startup).
3. Manual verification checklist for the next person with a real server, in priority order:
   - Connect a saved site with a name → header/tab shows the name, not a UUID; quick-connect with no name → tab shows the host.
   - Open 2+ site tabs to different (or the same) server, confirm both stay connected, switching is instant with no reconnect flicker, each keeps its own remote directory/selection state.
   - Close a tab that has an in-flight transfer/tail/terminal — confirm the underlying session actually disconnects (check Activity log) and no orphaned entries remain (re-opening a new tab to the same site shouldn't inherit stale state).
   - Disconnect (not close) the active tab → tab returns to the site picker in place, tab is not removed.
   - Toggle the Local rail closed/open from its own header row; confirm the remote pane reflows to fill the space, and any open file-preview dialog on the Local side closes when the rail collapses.
   - Open the Terminal tab, run a long-lived command (`top`, `vim`), switch to another dock tab and back — output should still be live/intact. Switch site tabs and back — same terminal, same scrollback. Resize the window — remote `stty size`/`tput cols` reflects the new size.
   - Disconnect/close a tab with an open terminal — confirm the remote shell process actually exits (no orphaned `ssh2` channel).
4. No test suite exists yet — if adding tests, `TerminalManager`'s exit-code capture and `remoteFs.store.ts`'s per-session keyed getters are the most correctness-sensitive new units.

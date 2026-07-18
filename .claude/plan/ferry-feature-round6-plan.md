# Ferry Feature Round 6 — UX & Visibility Pass

> First implementation step: copy this plan to `.claude/plan/ferry-feature-round6-plan.md` in the repo (user convention — plans live in the repo too).

## Context

Customer feedback on v0.9.0 identifies four gaps:

1. **Visual hierarchy** — the UI is "modern, minimal, but hard to distinguish the content." Root causes (confirmed by code audit): every region sits on the same `bg-default` with only hairline `border-muted` separators; selected (`bg-accented`) vs hovered (`bg-muted`) rows are adjacent zinc steps and nearly indistinguishable; all metadata is `text-muted`; file icons are all gray; the accent color barely appears anywhere.
2. **Progress visibility** — only transfers report progress. Remote extract/compress, local compress, and recursive deletes run as opaque execs (up to 5 min) behind a 6px title-bar dot. Requirement: every slow action shows a progress bar, surfaced in the BottomDock so clicking it shows what's running.
3. **Terminal keyboard** — Ctrl+C/Ctrl+V don't work; "can just type and enter." Confirmed causes: `term.focus()` is never called (user must click the canvas first — keys go elsewhere until then), no `attachCustomKeyEventHandler`, no paste path at all, and `Menu.setApplicationMenu(null)` removed Electron's clipboard accelerators.
4. **Remote resource monitor** — no way to see the server's total memory, memory usage, or CPU usage.

Four workstreams, ordered: **D** terminal fix (bug) → **Prereq** dock-state composable → **A** Activity/operations dock → **B** resource monitor → **C** visual hierarchy pass. Each is a commit point. All follow the repo's contract-first IPC convention (`src/shared/contract.ts` first, then `ipc/*.ipc.ts` + `registerAllHandlers()`, then Pinia store).

---

## D. Terminal keyboard fix (do first)

### D1. Clipboard-read IPC
- `src/shared/contract.ts`: add `systemClipboardReadText: 'system:clipboardReadText'` to `INVOKE_CHANNELS` + `export interface ClipboardTextResult { text: string }`. (Preload whitelist derives automatically.)
- `src/main/ipc/system.ipc.ts`: `handle<ClipboardTextResult>(..., () => ({ text: clipboard.readText() }))` using Electron's `clipboard` module. Main-side read is unconditional/synchronous — avoids sandboxed `navigator.clipboard.readText()` permission quirks. Copy stays renderer-side via `navigator.clipboard.writeText()` (already proven in `FileRow.vue:63`).

### D2. Pure key-decision logic + tests
- New `src/renderer/src/utils/terminalKeys.ts` (mirrors `fileSort.ts` pure-util precedent):
  `terminalKeyAction(ev, hasSelection): 'copy' | 'paste' | 'default'`
  - only `keydown` events act; everything else `'default'`
  - Ctrl/Cmd+C **with** selection → `'copy'`; **without** → `'default'` (xterm sends `\x03` SIGINT)
  - Ctrl+Shift+C → `'copy'`; Ctrl/Cmd+V, Ctrl+Shift+V, Shift+Insert → `'paste'`
  - Ctrl+A/K/R etc. → `'default'` (pass to shell, never select-all)
- New `src/renderer/src/utils/terminalKeys.test.ts` covering the full table.

### D3. Wire into the terminal (`src/renderer/src/stores/terminalStreams.store.ts`)
In `ensureTerminal()` after the `term.onData` wiring (~line 96), add `term.attachCustomKeyEventHandler`: on `'copy'` → `preventDefault()`, `navigator.clipboard.writeText(term.getSelection())`, `term.clearSelection()`, return false; on `'paste'` → `preventDefault()`, invoke clipboard-read IPC then `term.paste(text)` (NOT `term.write` — respects bracketed paste in vim/zsh; flows through existing `onData` → `terminal:write`, no new write path), return false; else return true.
Add store actions `focus(sessionId)` and `copyOrPaste(sessionId)` (right-click convention: copy if selection, else paste) so components never touch `Terminal` objects directly.

### D4. Focus + right-click (`src/renderer/src/components/terminal/TerminalView.vue`)
- `syncActiveTerminal()` (line 43): after `ensureTerminal`, add `await nextTick()` (fixes a latent bug — on first open, `fitAndResize` currently runs before the `v-for` container renders and `term.open()` fires), then `fitAndResize`, then `terminalStreams.focus(sessionId)` if still `props.active`. The existing watcher on `[props.active, sessions.activeSessionId]` already fires on dock-tab click, dock expand, site-tab switch, and first open — one call site covers all "became visible" paths. No BottomDock change needed.
- `attachContainer()`: after `term.open(el)`, add a `contextmenu` listener → `preventDefault()` + `terminalStreams.copyOrPaste(sessionId)`.

### D5. CommandPalette guard (`src/renderer/src/components/shell/CommandPalette.vue`)
In its global keydown handler, bail early if `event.target` is inside `.xterm` — otherwise Ctrl+K both opens the palette AND sends `\x0b` to the shell. Terminal-first is the standard convention.

### D6. Minimal macOS menu (`src/main/index.ts:122`)
`process.platform === 'darwin'` → `Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'}]))`, else keep `null` (Windows Chromium dispatches native edit commands without a menu). Cheap future-proofing; the terminal path above doesn't depend on it.

---

## Prereq. Dock-state composable (before A & B)

New `src/renderer/src/composables/useDockState.ts` — module-scoped refs (the `useSettingsDialog.ts` singleton precedent; NOT `ui.store.ts`, which persists to localStorage — dock open/tab is ephemeral):
```ts
export type DockTab = 'transfers' | 'tail' | 'terminal' | 'activity' | 'monitor'
// refs: collapsed, tab, terminalEverShown; openDock(target) expands + switches (sets terminalEverShown for 'terminal')
```
Refactor `BottomDock.vue` to consume it (delete local `DockTab`/`collapsed`/`tab`/`terminalEverShown` refs, lines 9–23). Behavior-neutral; needed so TitleBar's busy dot can open the dock (A) and the Monitor panel's lifecycle is dock-driven (B).

---

## A. Unified operation progress ("Activity" dock tab)

**Decision: new Activity tab, do NOT merge with Transfers** — transferQueue store/components are mature (retry, ETA, byte formatting); unifying would churn the most battle-tested feature for no user benefit.

### A1. Contract (`src/shared/contract.ts`)
```ts
export type OperationKind = 'extract-remote' | 'compress-remote' | 'compress-local' | 'delete-remote' | 'delete-remote-batch'
export type OperationState = 'started' | 'progress' | 'done' | 'error' | 'cancelled'
export interface OperationEvent {
  operationId: string; kind: OperationKind; state: OperationState
  label: string                 // "Extracting report.zip" — sent on every event (merge-safe)
  sessionId?: string            // absent for compress-local
  startedAt: number             // epoch ms — renderer derives elapsed time, no per-second events
  cancellable: boolean
  progressCurrent?: number; progressTotal?: number; progressUnit?: 'bytes' | 'items'  // absent = indeterminate
  error?: string
}
export interface DeleteManyResult { deletedPaths: string[]; failures: { path: string; error: string }[] }
```
Channels: invoke `operationCancel: 'operation:cancel'`, `fsRemoteDeleteMany: 'fs:remote:deleteMany'`; event `operationEvent: 'operation:event'`. Flat optional progress fields mirror `TransferEvent` so the renderer's merge-preserving pattern copies over unchanged.

### A2. Main: `src/main/operations/OperationRegistry.ts`
Singleton (TailManager shape, no reaper — every op has a bounded exec timeout so entries always reach a terminal state):
- `run<T>(meta, fn: ({signal, reportProgress}) => Promise<T>): Promise<T>` — broadcasts `started`, runs fn, broadcasts `done`/`error`/`cancelled` (maps `SshError('CANCELLED')`), deletes entry, returns/rethrows so IPC envelopes are unchanged. `reportProgress` throttled at 200ms (copy `PROGRESS_THROTTLE_MS` + final-emit escape from `TransferQueue.ts`). Broadcast = the standard `BrowserWindow.getAllWindows()` loop.
- `cancel(operationId)`, `cancelAllForSession(sessionId)`.
- Unit tests with `vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))`.

### A3. Instrumentation — at the **IPC-handler level** (services stay registry-free and unit-testable)
- Extract `runConcurrent` from `TransferQueue.ts` → new `src/main/util/concurrency.ts` (pure refactor; TransferQueue re-imports).
- `src/main/ipc/unzip.ipc.ts`: wrap `extractRemote` in `registry.run({kind:'extract-remote', label:\`Extracting ${basename}\`, sessionId, cancellable:true}, ...)`.
- `src/main/ipc/archive.ipc.ts`: same for `compressRemote`; `compressLocal` also passes `reportProgress` (unit `'bytes'`).
- `src/main/unzip/UnzipService.ts` / `src/main/archive/CompressService.ts`: thread `signal?: AbortSignal` into `shell.exec(...)`; `compressLocal` gains `onProgress` wired to archiver's `'progress'` event (`progress.fs.processedBytes/totalBytes`); on abort: `archive.abort()` + destroy stream + unlink partial zip + reject CANCELLED.
- `src/main/ipc/fs.ipc.ts`: wrap `fsRemoteDelete` unconditionally (`'delete-remote'`, not cancellable); add `fsRemoteDeleteMany` handler — ONE `registry.run({kind:'delete-remote-batch', label:\`Deleting ${paths.length} items\`})` deleting paths via `runConcurrent(…, 4)`, `reportProgress(done, total, 'items')` per settle; per-path failures don't fail the op (returns `DeleteManyResult`).
- `src/renderer/src/stores/remoteFs.store.ts`: `removeMany` becomes one `fsRemoteDeleteMany` invoke; patch `entries` once from `deletedPaths`; same summary-error throw from `failures` (caller toast unchanged). `localFs` removeMany stays as-is.
- **Cancellable**: compress-local (true cancel), extract/compress-remote (aborts the channel; remote process may finish server-side — document in JSDoc). **Not cancellable**: deletes (aborting mid-`rm -rf` misleads users about what survived).
- **Deliberately NOT instrumented**: connect (tab spinner already covers it), transfer tree-scan (would double-row one user action), dir listings (would spam every navigation).
- New `src/main/ipc/operations.ipc.ts` (`operationCancel` handler) wired into `registerAllHandlers()`. `SessionManager.close()` (~line 417): add `OperationRegistry.getInstance().cancelAllForSession(sessionId)` beside the TailManager/TerminalManager calls.

### A4. Renderer
- New `src/renderer/src/stores/operations.store.ts` — copy `transferQueue.store.ts` shape (Map by id, idempotent `ensureSubscription()` with `?? existing` merges, getters `list`/`runningCount`, actions `cancel`/`clearFinished`). **No toasts here** — FilePane call sites already toast with richer context. Auto-drop `done` rows after ~10s; error/cancelled stay until cleared. Subscribe from `App.vue` `onMounted` (ops start main-side; subscription must predate the first event).
- New `src/renderer/src/components/activity/ActivityPanel.vue` (list + empty state + "Clear finished") and `ActivityItem.vue`: per-kind lucide icon, label, determinate `UProgress` + "3 / 14 items"/bytes when `progressTotal` present else indeterminate `UProgress` + elapsed time (ONE module-level 1s ticker ref, never per-row intervals), cancel button (UTooltip-wrapped) when `cancellable` and running, error text on terminal states.
- `BottomDock.vue`: Activity tab button + `v-else-if` content branch (stateless → normal `v-if` chain, only Terminal needs `v-show`). Badges: wrap Transfers + Activity buttons in `UChip` (`:show="count>0"`) — active-transfer count / `runningCount`. Verify `UChip` wraps `UButton` cleanly (both in components.d.ts?); fallback is a small styled span. **No auto-expand** when an op starts — the badge on the always-visible `h-9` header row + busy dot is the signal; clicking shows the list (the literal requirement).
- `useGlobalActivity.ts`: label branch — if `operations.runningCount > 0`, use the first running op's label (beats generic "Working…").
- `TitleBar.vue`: busy dot becomes a clickable button (`UTooltip` "Show activity") calling `useDockState().openDock('activity')` — only when a session view is active (dock only exists post-connect).

---

## B. Remote resource monitor ("Monitor" dock tab)

**Decision: periodic buffered `RemoteShell.exec` on a self-rescheduling `setTimeout` chain** (not a long-lived `execLines` loop — that would need PID-kill/reconnect/frame-reassembly to save a few ms per tick; buffered ticks are self-contained and self-healing). CPU% computed main-side from consecutive `/proc/stat` deltas.

Tick command (static string, nothing interpolated):
```
cat /proc/stat 2>/dev/null; echo @@@; cat /proc/meminfo 2>/dev/null; echo @@@; cat /proc/loadavg 2>/dev/null; echo @@@; cat /proc/uptime 2>/dev/null
```
Core count derives from `cpuN` lines (no `nproc` needed). Empty stat section on first tick (BSD/macOS, no `/proc`) → broadcast `{state:'unsupported'}` once and stop — no error spam. 3 consecutive failures on a working loop → `{state:'error'}` + stop.

### B1. Contract
```ts
export interface MonitorSample {
  sessionId: string; timestamp: number
  cpu: { aggregatePct: number; perCorePct: number[]; coreCount: number } | null   // null on first tick (delta warm-up)
  memory: { totalBytes: number; usedBytes: number /* total−available */; availableBytes: number; buffersBytes: number; cachedBytes: number }
  swap: { totalBytes: number; usedBytes: number }
  loadAvg: [number, number, number]; uptimeSec: number
}
export type MonitorStatus = 'started' | 'stopped' | 'unsupported' | 'error'
export interface MonitorStatusEvent { sessionId: string; state: MonitorStatus; message?: string }
```
Channels: invoke `monitorStart: 'monitor:start'` (`{sessionId, intervalMs?}`), `monitorStop: 'monitor:stop'`; events `monitorSample: 'monitor:sample'`, `monitorStatus: 'monitor:status'`. No `QUIET_CHANNELS` change — polling is main-side, start/stop are rare one-shot invokes; the busy dot never flickers on ticks.

### B2. Main
- New `src/main/monitor/procParse.ts` — pure, zero Electron/Node imports (the `regQuery.ts` precedent): `splitSections`, `parseProcStat` (→ `CpuTimes[]`, `[0]`=aggregate; idle = idle+iowait), `cpuPercentages(prev, curr)` (null on core-count mismatch / zero delta), `parseMeminfo` (kB→bytes; `MemAvailable` fallback = MemFree+Buffers+Cached for pre-3.14 kernels), `parseLoadAvg`, `parseUptime`.
- New `src/main/monitor/MonitorManager.ts` — singleton keyed **by sessionId** (one monitor per session; nothing to multiplex): entries `{controller, intervalMs (sanitized clamp [1000,30000] default 2000 — the sanitizeHistoryLines pattern), prevStat, consecutiveFailures, timer}`; `start` (idempotent-replace), `stop` (abort + clear timer + broadcast stopped), `stopAllForSession` (alias), private `tick` (`exec` with `timeoutMs: 10_000` + signal → parse → broadcast sample → reschedule). Dead-session `shell()` throw stops the loop naturally.
- New `src/main/ipc/monitor.ipc.ts` + wiring; `SessionManager.close()`: add `MonitorManager.getInstance().stopAllForSession(sessionId)`.

### B3. Renderer
- New `src/renderer/src/stores/monitor.store.ts` — keyed per sessionId like `remoteFs.store.ts` (`bySession` buckets, `current` getter off the active tab, lazy bucket creation inside actions only): `{latest, history (ring, 90 samples ≈ 3 min), status, statusMessage}`; `ensureSubscription()` for both events; `start`/`stop` actions. History survives stop/start (dock collapse/reopen resumes the sparkline with a gap).
- New `src/renderer/src/components/monitor/MonitorPanel.vue` — mounted only while the Monitor tab is active + dock expanded (normal `v-if` chain; store holds history so remount is fine). On mount + `activeSessionId` watcher: `start(activeSessionId)` / `stop(previous)`; on unmount: stop. Layout inside ~200px (3-column grid):
  - **Memory**: caption, `UProgress used/total` + formatted "used / total" (reuse the transfer byte formatter — extract to a shared util if currently inline), thinner swap bar, muted "buffers X · cached Y" line.
  - **CPU**: big aggregate % + plain inline SVG `<polyline>` sparkline over history (~40px tall, `stroke="currentColor"` on a primary span — no chart library); per-core strip of tiny plain-div bars (`h-6 w-1.5` track + %-height fill; cap ~32 cores with "+N more").
  - **Facts** (right, `text-xs text-muted`): load "0.42 / 0.38 / 0.30", humanized uptime, core count.
  - States: `unsupported` → centered `i-lucide-monitor-off` notice; `error` → message + Retry button; `cpu === null` → "—".
- `BottomDock.vue`: Monitor tab button after Terminal, `:disabled="sessions.status !== 'connected'"` (same gating as Terminal's).

---

## C. Visual hierarchy pass

Design principles: two-layer model — **chrome on `bg-muted`, content on `bg-default`**; selection moves off the zinc ramp onto a **primary tint**; three-tier text ramp. **No shadows** (flat fill-difference is the Apple-HIG move and survives dark mode), **no zebra striping** (compact 13px rows; icon color + strong selection carry scanning).

### C1. Wire the orphaned brand palette
`electron.vite.config.ts:27`: `primary: 'blue'` → `primary: 'brand'` (the `@theme static --color-brand-*` Apple-blue ramp in `main.css:9-21` is currently unused; this is @nuxt/ui v4's documented custom-color mechanism). Existing `--ui-primary` 600/400 overrides keep working. Smoke-test immediately; fallback = revert this line and delete the orphaned block instead.

### C2. Chrome zones
- `TitleBar.vue:41`: `bg-default/80` → `bg-muted/80` (keep blur).
- `SiteTabBar.vue:15`: `bg-default/80` → `bg-muted`; bottom border → `border-default` (major boundary).
- `FilePane.vue:411` pane header row (`h-8` LOCAL/REMOTE strip): add `bg-muted`.
- `BottomDock.vue`: header row (line 35) gets `bg-muted`; outer `border-t border-muted` (line 32) → `border-default`.

### C3. Selection/active states (one language: primary tint)
- `FileRow.vue:158-159`: static class gains `border-l-2 border-transparent` (no layout shift); selected → `bg-primary/10 text-highlighted border-primary`; unselected/hover unchanged (`hover:bg-muted`) — gray hover vs blue selection is now unmistakable in both themes.
- `SiteTabBar.vue:20`: active → `bg-primary/10 text-primary font-medium`; inactive → `text-muted hover:bg-elevated hover:text-default` (sits on the now-muted bar, so hover needs the next step up).
- `BottomDock.vue:79` tail sub-tabs: active → `bg-primary/10 text-primary font-medium` (matches the dock UButtons' existing soft-primary active state — no change needed there).

### C4. File-type icon colors
- `fileTypes.ts`: add `colorForFile(name, isDir): string` reusing `iconForFile`'s buckets. Full literal class strings (Tailwind v4 source-scanning; never build dynamically): dir → `text-primary`; archive → `text-amber-600 dark:text-amber-400`; image → violet; video → rose; audio → pink; spreadsheet → emerald; json/code → teal; document → `text-muted` (restraint — the .txt/.log long tail stays quiet); unknown → `text-dimmed`. 600/400 pairing mirrors the `--ui-primary` convention. Comment the deliberate exception to semantic-colors-only.
- `FileRow.vue:167-169`: `text-muted` → `:class` with `colorForFile(...)`.
- Extend `fileTypes.test.ts` with a `colorForFile` block.

### C5. Metadata contrast (three tiers)
- `FileList.vue:37` column headers: `text-muted` → `text-default`.
- `FileRow.vue:184-188` size/date/permissions-mono: `text-muted` → `text-dimmed` (widens the name-vs-metadata gap without brightening).
- `PathBreadcrumb.vue:34`: split into parent (`text-muted`) + last segment (`font-medium text-default`) via two computeds; edit mode unchanged.
- `TitleBar.vue:72`: title `text-muted` → `text-toned`; busy dot `size-1.5` → `size-2`.
- Do NOT raise: toolbar ghosts, badges, tooltips, empty states.

### C6. Extras
- `FilePane.vue:403` drop-target: add `bg-primary/5` to the existing ring (whole pane reads as target).
- Empty states (`FileList.vue:98`, `TransferQueue.vue`, tail placeholder): prepend a `text-dimmed` lucide icon, demote text to `text-dimmed`.

---

## Files summary

**New**: `main/operations/OperationRegistry.ts` (+test), `main/util/concurrency.ts`, `main/ipc/operations.ipc.ts`, `main/monitor/procParse.ts` (+test), `main/monitor/MonitorManager.ts`, `main/ipc/monitor.ipc.ts`, `renderer/.../composables/useDockState.ts`, `renderer/.../stores/operations.store.ts`, `renderer/.../stores/monitor.store.ts`, `renderer/.../components/activity/ActivityPanel.vue` + `ActivityItem.vue`, `renderer/.../components/monitor/MonitorPanel.vue`, `renderer/.../utils/terminalKeys.ts` (+test), repo copy of this plan.

**Modified**: `shared/contract.ts`, `main/index.ts`, `main/ipc/{system,unzip,archive,fs}.ipc.ts`, `main/ssh/SessionManager.ts` (close hook ×2), `main/unzip/UnzipService.ts`, `main/archive/CompressService.ts`, `main/transfer/TransferQueue.ts` (runConcurrent import), `renderer` — `stores/{terminalStreams,remoteFs,operations… }`, `components/shell/{BottomDock,TitleBar,SiteTabBar,CommandPalette}.vue`, `components/terminal/TerminalView.vue`, `components/files/{FilePane,FileList,FileRow,PathBreadcrumb}.vue`, `composables/useGlobalActivity.ts`, `utils/fileTypes.ts` (+test), `App.vue`, `electron.vite.config.ts`, `assets/main.css` (if any token tweaks), `.claude/PROJECT_MAP.md` (new singletons, close-hook list, dock-state convention, no-toasts-in-operations-store convention).

## Verification

- **Unit** (`npm test`): `terminalKeys.test.ts` (full decision table), `procParse.test.ts` (multi-core /proc/stat fixture, iowait-as-idle, zero-delta→null, MemAvailable fallback, swapless host, garbage→null, empty-sections→unsupported path), `OperationRegistry.test.ts` (started→done/error/cancelled, throttle with fake timers, cancelAllForSession), `CompressService.test.ts` extension (onProgress fires with growing bytes; abort leaves no partial file), `fileTypes.test.ts` (`colorForFile`).
- **Typecheck**: `npm run typecheck` after each workstream.
- **Manual** (`npm run dev` + the Docker SSH container from `RemoteShell.integration.test.ts`'s header):
  - *Terminal*: click Terminal tab → typing works immediately (no click-in needed); `sleep 30` + Ctrl+C interrupts; select text + Ctrl+C copies (no SIGINT); Ctrl+V / Shift+Insert paste; multi-line paste in vim has no staircase (bracketed paste); right-click copy/paste; Ctrl+K in terminal kills line, doesn't open palette; palette still opens from panes; Ctrl+C/V still work in rename inputs.
  - *Activity*: compress a big local folder → determinate bytes bar, cancel works (no partial zip); remote extract/compress → indeterminate bar + elapsed; multi-delete 50 files → one "Deleting 50 items" row with item counts, listing patched once; badge on collapsed dock header; busy-dot click opens dock on Activity; no double toasts.
  - *Monitor*: connect → samples within ~4s (first CPU "—"); `yes > /dev/null` in Terminal → a core pins near 100%, sparkline climbs; collapse dock → polling stops; two tabs to the same container → independent samples; close tab while open → no error spam; non-Linux/`/proc`-less host → quiet "unsupported" notice.
  - *UI*: both themes — chrome bands read as one muted family vs white/near-black content; selected row (blue tint + accent bar) unmistakable vs gray hover, no layout shift; active site tab blue; icon colors distinct but muted, .txt/.log gray; headers darker than sizes/dates; breadcrumb last segment emphasized; drop-target fills faint blue; everything renders in brand blue.

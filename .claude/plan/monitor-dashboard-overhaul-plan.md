# Monitor dock overhaul: storage, RAM, CPU, top-processes table

## Context

Round 6 shipped a Monitor dock tab (`da940af`) showing aggregate/per-core CPU%,
memory/swap bars, load averages and uptime for the connected server. Per
`handoff.md`, this was never validated against a real running app — and now
that it has been, customer feedback is that it's "useless": they expect a
real resource dashboard with **total storage** (e.g. `98GB/100GB`), **total
RAM usage**, **CPU usage**, and a **table of top processes** (Name, PID, RAM,
CPU%, ranked top to bottom, virtualized/lazy-rendered on scroll).

Decisions already confirmed with the user (not open questions):
- Storage: root filesystem (`/`) only, one number — not a list of every mount.
- Process table: view-only (no kill/signal actions).
- The dock becomes **drag-to-resize** (persisted height) so the process table
  has real room — this benefits every dock tab, not just Monitor.

This plan extends the existing tick-based `/proc` polling architecture
(`MonitorManager` + `procParse.ts`) rather than introducing a new streaming
or `ps`-shelling mechanism, consistent with how CPU/mem/load/uptime already
work.

## A. Remote data collection (`src/main/monitor/`)

**`MonitorManager.ts`** — extend `TICK_COMMAND` with two more `@@@`-delimited
sections (6 total, up from 4):

```
... (existing 4 sections: stat, meminfo, loadavg, uptime) ...
echo @@@; df -Pk / 2>/dev/null
echo @@@; for d in /proc/[0-9]*; do
  p=${d#/proc/}
  if IFS= read -r s < "$d/stat" 2>/dev/null; then printf '@P@%s\n%s\n' "$p" "$s"; fi
done
```

- `df -Pk /`: POSIX format, 1024-byte blocks — portable across GNU/BusyBox.
- Per-process: shell-builtin `read -r < file` (no `cat` fork, no `ps` dialect
  assumption) over every `/proc/[pid]/stat` — cheap even at a few hundred
  pids per 2s tick (this is what `htop`/`top` do). A pid that vanishes
  mid-iteration just fails the redirect and is skipped — already-established
  tolerance pattern, no special-casing.

**`procParse.ts`** — add (same file, same "pure, no Electron/Node imports,
fully unit-tested" convention as everything else there):

- `splitSections(output, count, marker = SECTION_MARKER)` — generalize the
  hardcoded `4` to a `count` parameter. Update the two existing call sites in
  `procParse.test.ts` to pass `4` explicitly; `MonitorManager` calls it with `6`.
- `parseDiskUsage(text): { totalBytes, usedBytes, availableBytes } | null` —
  strips the header, joins remaining lines (handles POSIX `df`'s line-wrap on
  long device names), and walks backward from the known-fixed last token (`/`)
  to pull capacity/available/used/total columns regardless of device-name
  width. Null on garbage/missing `df`.
- `ProcessSnapshot { pid, comm, utime, stime, rssPages }` and
  `parseProcessSnapshot(text, marker = '@P@'): ProcessSnapshot[]` — splits on
  the `@P@` marker; parses each `/proc/pid/stat` line by finding the **first**
  `(` and **last** `)` to isolate `comm` safely (names can contain spaces/
  parens), then indexes the remaining whitespace-split fields for `utime`
  (idx 11), `stime` (idx 12), `rss` (idx 21). Skips malformed/too-short
  records rather than throwing.
- `PAGE_SIZE_BYTES = 4096` — hardcoded page size to convert `rssPages` →
  bytes (documented limitation: wrong only on non-4KB-page architectures,
  which this app's target servers essentially never are — avoids a second
  per-pid file read of `/proc/pid/status` just for `VmRSS`).
- `ProcessSample { pid, name, rssBytes, cpuPct: number | null }` and
  `processCpuPercentages(prev: Map<number, ProcessSnapshot> | null, curr: ProcessSnapshot[], aggregateTotalDelta: number | null): ProcessSample[]` —
  `cpuPct = ((utimeDelta + stimeDelta) / aggregateTotalDelta) * 100`, reusing
  the **same** aggregate `/proc/stat` total-delta that `cpuPercentages()`
  already computes as the denominator. This needs no `CLK_TCK`/HZ constant
  and no wall-clock elapsed time — utime/stime and the aggregate row are the
  same units on the same machine — and keeps per-process % directly
  comparable to the aggregate % already shown. `null` when there's no prior
  sample for that pid yet or `aggregateTotalDelta` is `null` (first tick).
- `MAX_PROCESSES = 200` and
  `capProcesses(samples, memTotalBytes, max = MAX_PROCESSES): { processes: ProcessSample[]; totalCount: number }` —
  sorts by a combined 0–100-scale score (`(cpuPct ?? 0) + (rssBytes / memTotalBytes) * 100`)
  so neither CPU-heavy nor memory-heavy processes are systematically dropped,
  then slices. Collection always walks every pid; only the *transmitted* list
  is capped (bounds IPC payload against pathological process counts).

**`MonitorManager.tick()`**: parse the two new sections; keep
`entry.prevProcesses: Map<number, ProcessSnapshot> | null`, **rebuilt fully
from `curr` every tick** (not merged) — natural, correct handling of pid
churn. Compute `aggregateTotalDelta` from `entry.prevStat`/`currStat` (already
available), call `processCpuPercentages` then `capProcesses`, and populate the
new `MonitorSample` fields. A `df` failure sets `disk: null` but is **not**
fatal (doesn't trigger `unsupported`/`error` — only a missing `/proc/stat`
does that, matching existing severity convention).

## B. Contract (`src/shared/contract.ts`)

Add to `MonitorSample` (no new IPC channels — `monitor:sample` already
carries the whole object):

```ts
export interface MonitorProcessSample {
  pid: number
  name: string
  cpuPct: number | null
  rssBytes: number
}

// on MonitorSample:
disk: { totalBytes: number; usedBytes: number; availableBytes: number } | null
processes: MonitorProcessSample[]
processTotalCount: number
```

`monitor.store.ts` needs **no code change** — `bucket.latest = sample` already
stores the whole payload wholesale; new fields are read the same way existing
ones are (`monitor.latest.disk`, `monitor.latest.processes`).

## C. Renderer UI

**`MonitorPanel.vue`** — replace the current spacious
`grid-cols-[1fr_1fr_auto]` layout with a `flex flex-col h-full`:
1. A fixed-height (~64–72px) summary strip: **Storage** bar (`formatBytes`
   used/total, e.g. "98 GB / 100 GB"), **Memory** bar (condensed — swap folded
   into one line, only shown when `swap.totalBytes > 0`), **CPU** (aggregate
   % + existing sparkline; per-core mini-bars either drop to a tighter strip
   or move behind a hover tooltip — implementer's call, keep it compact).
   Loadavg/uptime/coreCount become small inline text near the CPU block.
2. `<ProcessTable class="min-h-0 flex-1" />` below it, taking all remaining
   dock height.
Keep the existing `unsupported`/`error`/loading gate states as-is.

**New `src/renderer/src/components/monitor/ProcessTable.vue`** — reads
`useMonitorStore()` directly (matches `MonitorPanel.vue`'s own pattern, no
prop drilling). Uses the **already-installed, currently-unused**
`@tanstack/vue-virtual` dependency:
- `sortedProcesses = computed(() => [...(monitor.latest?.processes ?? [])].sort(...))`,
  default sort **CPU% descending**; clicking Name/RAM/CPU% column headers
  toggles sort (cheap, low-risk addition — drop if trimming scope).
- `useVirtualizer({ count, getScrollElement, estimateSize: () => 28, overscan: 8, getItemKey: i => sortedProcesses.value[i].pid })` —
  fixed 28px rows (all columns are single-line, non-wrapping — no need for
  dynamic `measureElement`). **Key by `pid`**, not array index: this is what
  prevents scroll-position jank when `monitor.latest` is replaced wholesale
  every 2s and rows re-sort — Vue patches existing row DOM nodes in place by
  key instead of tearing them down. No extra "diff arrays" merge layer needed
  beyond this.
- Note as expected behavior, not a bug: because ranking reshuffles every
  tick, the process at a given scroll offset can change identity between
  ticks (same as `top`) — no "pin by pid" feature is being built for this.
- Columns: Name (`flex-1 truncate`, `:title` for full text), PID (~56px),
  RAM (~80px, `formatBytes`), CPU% (~56px, `—` when `null`), numeric columns
  right-aligned.
- Show a small `"showing top N of M"` caption (same visual convention as
  `MonitorPanel.vue`'s existing `hiddenCoreCount` "+N more" label) only when
  `processTotalCount > processes.length`.

## D. Dock resize (`BottomDock.vue` + `ui.store.ts`)

No existing drag-resize pattern in the codebase (`FileRow.vue`'s drag is
native HTML5 `DragEvent` for OS file-drag — unrelated). Implement with the
Pointer Events API:

- A thin `h-1 cursor-row-resize` handle as the first child of the dock
  container, `v-if="!collapsed"`.
- `pointerdown`: record start Y + start height, `setPointerCapture` (routes
  subsequent move/up to the handle with no `window`-level listener cleanup
  needed).
- `pointermove` (while dragging): compute `newHeight` from
  `dragStartHeight + (dragStartY - clientY)` (drag up = taller), clamp, write
  to a local `liveHeight` ref bound via inline style — **not** committed to
  the store/localStorage until drag ends (avoid hammering `localStorage` per
  pixel of movement).
- `pointerup`: commit `uiStore.setDockHeight(liveHeight.value)` once, release
  capture.
- Replace the container's fixed `h-9`/`h-56` Tailwind classes with an inline
  `:style="{ height: (collapsed ? 36 : liveHeight) + 'px' }"`; suppress the
  existing `transition-[height] duration-200` while actively dragging (it
  should only ease the collapse/expand toggle, not fight a live drag).

**`ui.store.ts`** (not `useDockState.ts` — that file's own comment already
draws the line: ephemeral per-launch state there, persisted *preferences*
here, and a user-resized height is a preference):

```ts
const DOCK_HEIGHT_KEY = 'ferry:ui:dockHeight'
export const MIN_DOCK_HEIGHT = 224   // == today's h-56 default, zero regression
export const MAX_DOCK_HEIGHT_RATIO = 0.7

export function clampDockHeight(value: number, windowInnerHeight: number): number {
  const max = Math.max(MIN_DOCK_HEIGHT, Math.min(windowInnerHeight * MAX_DOCK_HEIGHT_RATIO, windowInnerHeight - 260))
  return Math.min(Math.max(value, MIN_DOCK_HEIGHT), max)
}
```

`dockHeight` state initialized from `localStorage` (fallback `224`) run
through `clampDockHeight`; `setDockHeight(px)` action clamps + persists. The
`-260` term in the max reserves room for title bar + site tab bar + toolbar/
path bar + status bar; at the app's own `minHeight: 600` (`main/index.ts`)
this yields `min(420, 340) = 340px` — real headroom above the 224px floor
even at the smallest supported window. Re-clamp on the window's `resize`
event (call `setDockHeight(dockHeight)` again to reapply bounds against the
new `innerHeight`).

Collapsed state (`useDockState.ts`) is untouched: collapsed height stays a
hardcoded `36px` regardless of the persisted expanded height, so collapsing
never loses the custom size and re-expanding restores it automatically.

## E. Testing

Extend `procParse.test.ts` (pure, no Electron/Node imports — matches the
file's existing style) with cases for: `parseDiskUsage` (single-line,
2-line-wrapped long device name, garbage → null), `parseProcessSnapshot`
(normal record, spaces/parens in `comm`, multiple `@P@` records, malformed
record skipped, empty input), `processCpuPercentages` (formula correctness,
new-pid → null, first-tick-overall → null), `capProcesses` (truncation +
`totalCount`, combined score doesn't favor only CPU or only RAM), and updated
`splitSections` calls (explicit `count`, plus a `count=6` case). Add a small
test for `clampDockHeight` in `ui.store.ts` (or an extracted helper) — floor,
both max terms, small-window edge case.

Not testable in this environment (no way to visually drive the real Electron
app here — see `handoff.md`): the redesigned `MonitorPanel.vue`/`ProcessTable.vue`
layout and virtualization/scroll behavior, and `BottomDock.vue`'s pointer-drag
mechanics. Flag these for manual smoke-testing against a live session: drag
the handle across its range, collapse/expand and confirm the custom height
survives a restart, and watch the process table through several ticks to
confirm no scroll jump.

## Files to create/modify

- `src/main/monitor/procParse.ts` — new parsers/types (disk, process
  snapshot/sample, cap), generalized `splitSections`.
- `src/main/monitor/procParse.test.ts` — new + updated test cases.
- `src/main/monitor/MonitorManager.ts` — extended `TICK_COMMAND`, `prevProcesses`
  tracking, populate new sample fields.
- `src/shared/contract.ts` — `MonitorProcessSample`, extended `MonitorSample`.
- `src/renderer/src/components/monitor/MonitorPanel.vue` — condensed summary
  strip + mount `ProcessTable`.
- `src/renderer/src/components/monitor/ProcessTable.vue` — new, virtualized
  process table.
- `src/renderer/src/components/shell/BottomDock.vue` — drag handle, pointer
  handlers, inline height binding.
- `src/renderer/src/stores/ui.store.ts` — `dockHeight` state,
  `clampDockHeight`, `setDockHeight`.
- `.claude/PROJECT_MAP.md` — update Monitor tab / dock-resize entries once
  implemented (per this repo's own convention of keeping that file current).

## Verification

1. `npm run typecheck` and `npm test` (extended `procParse.test.ts` +
   `ui.store` test) must pass clean.
2. Manual smoke test against the Docker SFTP/SSH test container (or any real
   SSH box): connect, open Monitor tab, confirm storage/RAM/CPU numbers look
   sane, confirm the process table populates and sorts by CPU% descending,
   scroll through it and watch several 2s refresh ticks for scroll stability,
   drag the dock resize handle through its range, collapse/expand, and
   restart the app to confirm the custom dock height persisted.

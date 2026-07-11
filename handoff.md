# Handoff — Ferry round-3 UX features (2026-07-11)

## Goal

Adapt Ferry to a second round of real user feedback (after round-2, commit `b372122`). Four requested changes, all delivered this session:

1. Entering a site that has a saved name shows `Session {name}` instead of a raw session UUID.
2. Browser-like site tabs — open multiple sites at once, add new ones, switch between them like browser tabs.
3. The hide-Local toggle button moves into the Local panel's own row (was in the app's global top bar).
4. A new "Terminal" dock tab (next to "Activity") — an interactive SSH shell into whichever site tab is currently active.

Plus two small follow-ups requested after the initial pass landed:
- Removed the "Disconnect" button/bar entirely — with tabs, closing a tab already disconnects its session (and re-picker's the tab if it was the last one open), so a separate Disconnect action was redundant.
- Fixed a header-row height mismatch between the LOCAL and REMOTE panes introduced by the collapse-to-rail toggle button.

Full design rationale and exact decisions live in `.claude/plan/ferry-feature-round3-plan.md` (written and approved via plan mode before implementation, with two explicit decisions confirmed up front: hide-Local collapses to a slim rail rather than fully unmounting, and every open site tab stays connected simultaneously rather than lazily reconnecting on selection).

## Status: all 4 features implemented + both follow-ups, verified, NOT yet committed

`npm run typecheck` and `npm run build` are both clean (re-verified after the follow-up changes too). One `npm run dev` boot smoke test showed a clean boot with only the same benign Windows Chromium cache-permission and DevTools-protocol warnings seen in round-2 — no app-level errors — and no Electron process was left running afterward (confirmed via PowerShell `Get-Process`, not a Git-Bash PID).

**I did not — and could not — do full interactive UI verification.** Same limitation as round-2: no tool here can drive the actual Electron desktop window, and there's no real SFTP/SSH server to connect to. This is the single biggest thing left for you to do — see "Next step."

**Nothing from this round has been committed yet** — the working tree currently has all of round-3's changes uncommitted on `main` (round-2's `b372122` is still the tip). Left for you to decide when to commit.

## Current state of the code

See `.claude/PROJECT_MAP.md` (updated this session — new Conventions bullets on the site-tabs model, per-session `remoteFs` keying, the xterm.js instance-caching pattern, and the `v-show`-to-survive-dock-switching pattern; two new Gotchas on `term.open()` and the `Uint8Array` terminal-data channel; new Directory-structure and "Where to go for X" entries). Short version of what's new since round-2:

- The renderer is no longer single-session-at-a-time. `sessions.store.ts` holds `tabs: SessionTab[]` + `activeTabId`; every open tab keeps its own live SSH connection (the main-process `SessionManager` already pooled multiple sessions — this was purely a renderer-side change). Back-compat getters (`activeSessionId`, `status`, `statusMessage`, `connecting`) mean `App.vue`, `FilePane.vue`, and `SessionManagerView.vue` needed no changes to keep reading those same flat names.
- `remoteFs.store.ts` is now keyed by `sessionId` (`bySession: Record<string, PerSessionFs>`) so each open tab keeps its own independent remote directory/selection, while still exposing the exact same flat `currentPath`/`entries`/`loading`/`error`/`selected` surface — again, zero template changes needed in `FilePane.vue` for this part.
- A new `SiteTabBar.vue` renders under the titlebar: one chip per open tab (label, connecting spinner, error dot, close ×), plus a "+" to open a new picker tab. The old `Session {uuid}` line and the standalone Disconnect bar in `App.vue` are both gone.
- The Local pane's hide toggle now lives in `FilePane.vue`'s own header row (next to the "LOCAL" label) instead of `App.vue`'s global bar. Hiding it collapses to a slim `w-10` rail rather than fully unmounting, so the toggle stays reachable; a watcher closes any open preview dialog on collapse to preserve the safety property the old full-unmount gave for free. Both panes' header rows now share a fixed `h-8` height so LOCAL/REMOTE stay pixel-aligned regardless of whether the toggle button is present.
- A full interactive Terminal feature: `RemoteShell.openShell()` wraps `ssh2`'s `client.shell()` for a real PTY; a new `TerminalManager` (main process, mirrors `TailManager`) owns one shell per `terminalId`; new `terminal:open`/`write`/`resize`/`close` invoke channels and `terminal:data`/`terminal:exit` events in `contract.ts`. On the renderer, `@xterm/xterm` + `@xterm/addon-fit` render it; `terminalStreams.store.ts` caches live `Terminal` instances **outside** Pinia's reactive state, keyed by session, with a single shared `terminal:data` subscription — this is what lets a background site tab's shell keep filling its scrollback buffer while you're looking at a different tab or a different dock tab. `TerminalView.vue` is a thin attach/show layer that never constructs or destroys a `Terminal` itself. `BottomDock.vue` gained a "Terminal" tab (disabled when not connected) that lives in its own always-mounted `v-show` sibling rather than the existing `v-if`/`v-else-if` chain, specifically so switching dock tabs (or collapsing the dock) never tears down the live terminal.

## Files actively edited this session

New files:
- `src/main/terminal/TerminalManager.ts`
- `src/main/ipc/terminal.ipc.ts`
- `src/renderer/src/stores/terminalStreams.store.ts`
- `src/renderer/src/components/shell/SiteTabBar.vue`
- `src/renderer/src/components/terminal/TerminalView.vue`
- `.claude/plan/ferry-feature-round3-plan.md`

Modified files (most likely to need follow-up first):
- `src/renderer/src/stores/sessions.store.ts` — full rewrite: `activeSessionId: string | null` → `tabs: SessionTab[]` + `activeTabId`, with back-compat getters. New actions `openNewTab`/`setActiveTab`/`closeTab`; `openSession`/`connect`/`connectToSite` unchanged in signature (now operate on `this.activeTab` implicitly). The status-event subscription now routes by `evt.sessionId` to whichever tab owns it (not just the active one), so a background tab's unexpected disconnect still surfaces a toast and an error dot on its chip. (`disconnectActiveTab()` was added then removed again — see below.)
- `src/renderer/src/stores/remoteFs.store.ts` — full rewrite: flat state → `bySession: Record<string, PerSessionFs>`, with a `current`/`currentPath`/`entries`/`loading`/`error`/`selected` getter chain resolving the active session's bucket (falling back to a frozen `EMPTY_DEFAULT`). New `setError()` action (replaces a direct `remoteFs.error = ...` assignment that would have broken once `error` became a getter) and `clearSession()`/`needsLoad()`.
- `src/renderer/src/components/files/FilePane.vue` — remote side now `watch()`es `sessions.activeSessionId` (immediate) instead of a one-shot `onMounted` load, calling `remoteFs.load()` only when that session's bucket doesn't exist yet. Local side gained the collapse-to-rail toggle button in its header row, a `collapsedRail`/`showBody` computed pair gating width and body content, a watcher closing the preview dialog on collapse, the `remoteFs.setError()` fix in `onExtract`, and a fixed `h-8` header row (was content-driven `py-1`, which mismatched between LOCAL and REMOTE once LOCAL's header could contain an extra button).
- `src/renderer/src/App.vue` — added `<SiteTabBar>`; removed the `Session {uuid}` span and the entire Disconnect bar (redundant with tab-close); both `FilePane`s are now unconditionally mounted (no more `v-if="ui.showLocalPane"` — `FilePane.vue` owns that itself now).
- `src/renderer/src/components/shell/BottomDock.vue` — `DockTab` union gained `'terminal'`; new "Terminal" button (disabled unless connected); `TerminalView` moved out of the `v-if`/`v-else-if` chain into its own `v-show` sibling gated by a `terminalEverShown` flag, so it survives both dock-tab switching and the dock's own collapse toggle.
- `src/shared/contract.ts` — added `terminalOpen`/`terminalWrite`/`terminalResize`/`terminalClose` invoke channels, `terminalData`/`terminalExit` events, and `TerminalOpenResult`/`TerminalDataEvent`/`TerminalExitEvent` types (`data` is `Uint8Array`, not `string` — see Gotcha #10 in the project map).
- `src/main/ssh/RemoteShell.ts` — added `openShell(opts)` wrapping `client.shell({term, cols, rows}, cb)`.
- `src/main/ssh/SessionManager.ts` — `close()` now also calls `TerminalManager.getInstance().closeAllForSession(sessionId)`, right next to the existing `TailManager` call.
- `src/main/index.ts` — registers `registerTerminalHandlers()`.
- `package.json` / `package-lock.json` — added `@xterm/xterm` and `@xterm/addon-fit`.
- `src/renderer/components.d.ts` — auto-regenerated by `unplugin-vue-components` to include `SiteTabBar`/`TerminalView`; no manual edits.
- `.claude/PROJECT_MAP.md` — updated this session (see "Current state of the code" above for what changed).

## Changes made (chronological, by feature)

1. **Upfront research before writing any code** — read every file that would be touched directly (not just via subagent summaries) for the two riskiest pieces: the multi-session refactor (`sessions.store.ts`, `remoteFs.store.ts`, `FilePane.vue`) and the terminal PTY plumbing (`RemoteShell.ts`, `SessionManager.ts`, `TailManager.ts` as the pattern to mirror). A dedicated Plan-agent validation pass then cross-checked the design against the actual `ssh2` TypeScript defs and grepped the repo for any direct-state-assignment call sites that would break turning store fields into getters — this caught the `FilePane.vue` `remoteFs.error = message` assignment, the correct `client.shell()`/`ClientChannel.setWindow` API shape, the `stream.on('exit', ...)` vs `'close'` exit-code distinction, the multi-byte UTF-8 chunk-boundary risk, and the fact that Pinia getters must not lazily mutate state — all *before* any code was written, which is why the whole feature typechecked and built clean on the first full pass.
2. **Contract-first, per the project's own convention** — `contract.ts` terminal channels/types, then `RemoteShell.openShell()`, then `TerminalManager`, then `terminal.ipc.ts` + `main/index.ts` registration + the `SessionManager.close()` hook, verified against the real `@types/ssh2` definitions in `node_modules` (not assumed from memory).
3. **`sessions.store.ts` → multi-tab model**, with `remoteFs.store.ts`'s per-session keying done immediately after (the two are interdependent — `remoteFs` needs `sessions.activeSessionId`, and `sessions.closeTab`/prior `disconnectActiveTab` need `remoteFs.clearSession`). This is an intentional, safe circular import between the two store modules (and `terminalStreams.store.ts`) — each only calls the other's `useXStore()` inside action bodies, never at module-eval time.
4. **`terminalStreams.store.ts`, `SiteTabBar.vue`, `TerminalView.vue`, `App.vue`, `FilePane.vue`'s collapse-to-rail, `BottomDock.vue`'s Terminal tab** — built in that order, each verified against the plan's design notes as I went.
5. **Verification**: `npm run typecheck`, `npm run build`, one `npm run dev` boot smoke test, `Get-Process` check for orphaned Electron processes.
6. **Post-implementation feedback round 1**: user pointed out the "Disconnect" button was now redundant — closing a tab already disconnects it (and re-opens a picker tab in its place if it was the last one). Removed the bar from `App.vue` and the now-dead `disconnectActiveTab()` action from `sessions.store.ts`. Re-ran typecheck + build.
7. **Post-implementation feedback round 2**: user noticed the LOCAL and REMOTE panes weren't the same height. Root cause: both header rows used content-driven `py-1` sizing, but only LOCAL's row could contain an extra `UButton` (the collapse toggle) alongside its label — REMOTE's row, with only a bare `<span>`, rendered slightly shorter, throwing off alignment between the two panes' internal rows even though their outer containers were always equal height. Fixed by giving the shared header-row markup a fixed `h-8` instead of padding-based sizing, so both sides render identically regardless of content. Re-ran typecheck + build.

## Everything tried that failed

- **Tried to call `ExitPlanMode` before persisting the plan into the repo.** The user rejected it and asked for the plan to be saved into `.claude/plan/` first — plan mode only allows editing the harness's own designated plan file, not arbitrary repo files, so I couldn't do this *during* plan mode. Resolved by explaining the constraint, exiting plan mode on approval, and immediately writing `.claude/plan/ferry-feature-round3-plan.md` as the very first post-approval action (matching how rounds 1 and 2 archived their plans) — now saved as a durable feedback-memory note for future sessions in this repo.
- No reverted code this round — the header-row height mismatch and the redundant Disconnect bar were both real oversights, but both were caught by the user after the initial implementation rather than during it, and both were one-shot fixes (no back-and-forth). Unlike round-2, there were no `useToast()` type-check failures, invalid `v-model` bindings, or stray script blocks to work around this time — the upfront `ssh2`-defs/grep-based validation pass (see "Changes made" #1) meant the multi-session and terminal refactors typechecked and built clean on the first full attempt.

## Next step

Nothing is broken or blocking, but as with round-2, nothing has been hands-on verified against a real server or a real window. In priority order:

1. **Manual verification against a real SFTP/SSH server** (I could not do this — see Status). Specifically: connect a saved site with a name and confirm the tab shows the name (not a UUID); open 2+ tabs to different (or the same) sites and confirm both stay connected with instant, no-reconnect switching and independent remote directory state; close a tab with an in-flight transfer/tail/terminal and confirm the session actually disconnects (check the Activity log) with no orphaned state if you reopen a new tab to the same site; toggle the Local rail open/closed and confirm the remote pane reflows and any open preview dialog closes; open the Terminal tab, run a long-lived command (`top`, `vim`), switch dock tabs and site tabs and back and confirm the output/scrollback is still there; resize the window and confirm the remote `stty size`/`tput cols` reflects it; close/disconnect a tab with an open terminal and confirm the remote shell process actually exits.
2. **Recursive directory transfer** — still the biggest functional gap, unchanged from prior handoffs; unrelated to this session's work. Transfer/tail/extract/drag/preview are all still gated to files only (`!entry.isDir`).
3. Deferred polish (unchanged from before, still independent, pick any): command palette (Ctrl+K), drag-in from Windows Explorer, light/dark mode toggle, custom app icon, code signing, auto-update wiring. Possible new one from this round: persisting open site tabs across app restarts, or per-tab filtering of Transfers/Log Tail/Activity (both were deliberately scoped out this round — see the round-3 plan's "Deliberately out of scope" note).
4. No test suite exists yet — still true. If adding tests, `TerminalManager`'s exit-code capture (`stream.on('exit', ...)` vs `'close'`) and `remoteFs.store.ts`'s per-session keyed getters would be reasonable first targets alongside the previously-suggested `RemoteShell`/`TailManager`/`UnzipService`.
5. Not done: committing or pushing any of round-3's changes — the working tree is uncommitted on `main`, left for you to decide.

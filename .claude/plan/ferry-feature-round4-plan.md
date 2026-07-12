# Ferry — Round-4 UX Feedback Implementation Plan

## Context

This is the 4th round of iterative feedback on Ferry (an Electron+Vue3 SFTP client), following rounds 1-3 (commits `5aa908b`, `b372122`, `5b67425`, all documented in `.claude/PROJECT_MAP.md` and `handoff.md`). The customer reviewed the live app and returned 10 concrete UX/polish requests spanning layout, a dead feature to remove, a UX regression to re-fix (moving the hide-Local toggle to a *different* location than round-3 chose), two new interactive behaviors (tab dedup, auto-terminal), a new data column, visual polish (scrollbar, tooltips), a keyboard shortcut, and shipping assets (icons) plus process (CHANGELOG/VERSION) that were previously deferred/missing. None of this changes the app's core architecture — it's surface-level UI work plus one small backend-removal (Activity) applied consistently with the codebase's existing conventions (contract-first IPC, per-tab Pinia getters, `useNotify`/`UTooltip` patterns already in use).

Two decisions were confirmed with the user up front:
- **Activity tab removal is a FULL subsystem removal** (not just hiding the UI tab) — confirmed safe: grepped every `ActivityKind`/`ActivityLevel`/`ActivityEntry` usage and every `ActivityLog.getInstance().emit(...)` call site; all 11 touched files are self-contained to the activity feature, nothing else depends on it (toasts use the separate `useNotify()` composable, not this).
- **Permissions column is remote-pane-only**, defaulting to **friendly-tags** display (user-toggleable to technical), since local (Windows) `fs.stat().mode` isn't meaningful POSIX data.

A Plan-agent validation pass caught several real issues folded into the design below (not left as open risks): a grid-centering detail in the title bar, a genuine race condition in `terminalStreams.store.ts`'s `ensureTerminal()` that item 5 newly exposes, a misleading-data risk in the permissions "friendly" design, a stale comment in `electron-builder.yml`, a favicon path bug that would 404 in packaged builds, and two tooltip-worthy buttons missed in the first pass.

---

## 1. Center "Ferry" in the title bar

**File:** `src/renderer/src/components/shell/TitleBar.vue`

Change the outer `flex justify-between` row to a 3-column grid: `grid grid-cols-[1fr_auto_1fr] items-center` (keep `h-9`, border, `-webkit-app-region: drag`). Add an empty first `<div>`, keep the "Ferry" `<span>` as the middle (auto) column, and give the existing button-group wrapper `justify-self-end` so it hugs the right edge of its `1fr` track instead of stretching across it (a grid item fills its track by default). This centers the title relative to the *full* bar width since both outer tracks are equal `1fr`, not just the leftover space beside the buttons.

## 2. Remove the Activity feature entirely

**Delete:**
- `src/main/activity/ActivityLog.ts`
- `src/main/ipc/activity.ipc.ts`
- `src/renderer/src/stores/activityLog.store.ts`
- `src/renderer/src/components/logs/ActivityLog.vue`

**Edit:**
- `src/main/index.ts` — remove `registerActivityHandlers` import and its call in `registerAllHandlers()`.
- `src/shared/contract.ts` — remove `ActivityKind`, `ActivityLevel`, `ActivityEntry` types and the `activityHistory`/`activityEvent` channel constants. (`src/preload/index.ts` builds its whitelist from `Object.values(INVOKE_CHANNELS/EVENT_CHANNELS)`, so it shrinks automatically — no edit needed there.)
- `src/main/ssh/SessionManager.ts` (4 call sites), `src/main/transfer/TransferQueue.ts` (3), `src/main/ipc/unzip.ipc.ts` (3) — delete just the `ActivityLog.getInstance().emit(...)` statements and each file's now-unused `import { ActivityLog } from ...` line. Confirmed: every surrounding `catch`/`try` block has other real logic, so no dead code results.
- `src/renderer/src/components/shell/BottomDock.vue` — remove `'activity'` from the `DockTab` union, the Activity tab button, the `<ActivityLog v-else-if="tab === 'activity'">` branch, and the now-unused import.

`src/renderer/components.d.ts` regenerates automatically on next `dev`/`build` (unplugin-vue-components) — no manual edit.

## 3. Move the hide-Local toggle into SiteTabBar (right-aligned)

**Files:** `src/renderer/src/components/shell/SiteTabBar.vue`, `src/renderer/src/components/files/FilePane.vue`

Remove the `UButton` (icon `panel-left-close`/`panel-left-open`, calling `ui.toggleLocalPane()`) from `FilePane.vue`'s local-side header row entirely — keep the `collapsedRail`/`showBody` computed properties and the preview-dialog-close watcher untouched, since collapse/expand logic is unchanged, only the trigger's location moves. (Net effect: the collapsed rail's header becomes an empty `h-8` strip, which is fine — the control now lives permanently in the tab bar regardless of collapse state.)

Add the same button to `SiteTabBar.vue`: import `useUiStore`, place it after the tab chips + "+" button, separated by a `<div class="flex-1" />` spacer so it's pinned to the bar's right edge.

## 4. Tab-dedup: connecting to an already-open site switches to it

**File:** `src/renderer/src/stores/sessions.store.ts`

- Add `siteId: string | null` to `SessionTab`, defaulted `null` in `freshTab()`.
- Change `openSession(request, label, hostLabel, siteId)` (see item 5 for `hostLabel`) to set `tab.siteId = siteId` up front, passed explicitly by callers (not inferred from the request union).
- `connectToSite(site: Site)`: before calling `openSession`, look for `this.tabs.find(t => t.siteId === site.id && t.tabId !== this.activeTabId && (t.status === 'connected' || t.connecting))`. If found:
  - Capture whether the *current* active tab is an unused empty picker (`sessionId === null && status === null && !connecting`).
  - `this.setActiveTab(existing.tabId)`.
  - If the captured tab was an unused empty picker (and isn't `existing` itself), remove it from `this.tabs` (cleans up the never-connected "+" tab instead of leaving clutter).
  - Return early — do not call `openSession`.
- `connect()` (quick-connect/ad-hoc) is untouched — no stable id to dedup on.

Validated: `App.vue` only renders `SessionManagerView` (where this click originates) for a not-yet-connected active tab, so `t.tabId !== this.activeTabId` is safe-but-redundant. Switching before filtering means `activeTabId`/`tabs.length` never go invalid. `remoteFs`/`terminalStreams` are untouched since a `sessionId === null` picker tab never had a per-session bucket in either store.

**Deliberate behavior, not a gap:** a previously **errored** tab for site X is *not* matched by the dedup check (only `connected`/`connecting` are). Clicking "Connect" on site X again opens a fresh tab rather than reusing the dead one — this preserves the errored tab so the user can still see what failed, matching the existing "no silent auto-reconnect" convention. Accepted as-is.

## 5. Auto-start SSH terminal on connect, named `username@host`

**Files:** `src/renderer/src/stores/sessions.store.ts`, `src/renderer/src/stores/terminalStreams.store.ts`, `src/renderer/src/components/terminal/TerminalView.vue`

- Add `hostLabel: string | null` to `SessionTab`. `openSession(...)` sets it up front; on success (after `tab.sessionId`/`tab.status` are set), fire `void useTerminalStreamsStore().ensureTerminal(tab.sessionId)` **without awaiting** (background PTY open — reuses the same "call the other store inside an action body" pattern `closeTab()` already uses for `terminalStreams.disposeForSession`, so no new circular-import risk).
- `connect(input)` passes `hostLabel: \`${input.username}@${input.host}\`` and `siteId: null`; `connectToSite(site)` passes `hostLabel: \`${site.username}@${site.host}\`` and `siteId: site.id`.
- `TerminalView.vue`: add a slim header line above the xterm container showing `sessions.activeTab.hostLabel`.

**Fix required in `terminalStreams.store.ts` as part of this item** (found during validation, not present before because there was previously only one lazy call site): `ensureTerminal()`'s check-then-act (`if (instances.get(sessionId)) return; ... await invoke(...); instances.set(...)`) is not safe against two overlapping calls for the same session — item 5 adds exactly that scenario (auto-fire on connect + the user immediately clicking the Terminal dock tab, which calls it again before the first `await` resolves). Fix: track in-flight opens in a second `Map<string, Promise<string>>`; `ensureTerminal` first checks `instances`, then checks this pending map and returns the existing promise if present, otherwise creates-and-stores a new promise (clearing it from the pending map once resolved). This prevents duplicate PTYs and the resulting duplicate `v-for` key in `TerminalView.vue`.

## 6. Remote-only permissions column (friendly default, technical toggle)

**Files:** `src/renderer/src/stores/ui.store.ts`, new `src/renderer/src/utils/permissions.ts`, `src/renderer/src/components/files/FileRow.vue`, `FileToolbar.vue`, `FilePane.vue`

- `ui.store.ts`: add `permissionsDisplay: 'technical' | 'friendly'` (localStorage key `ferry:ui:permissionsDisplay`, default `'friendly'`), action `togglePermissionsDisplay()`.
- `utils/permissions.ts`: parse the existing 4-digit octal `FileEntry.permissions` string (already populated remote-side only, `RemoteShell.ts` — no main-process changes needed) into owner/group/other rwx bits.
  - `toTechnical(octal)` → classic 9-char `rwxr-xr-x` string (monospace).
  - `toFriendlyLabel(octal)` → **one** compact phrase derived from the **owner** triplet ("Read, Write & Execute" / "Read & Write" / "Read only" / etc.), explicitly framed as the owner's rights (not the connected user's effective access — those can differ on a shared server) — expose the full technical string via the badge's tooltip so the distinction is one hover away, not hidden. Deliberately a single badge, not three, to avoid widening every remote row.
  - Known v1 simplification, not a bug: the leading (setuid/setgid/sticky) octal digit is not surfaced in either mode.
- `FileRow.vue`: new cell after the modified-date column, `v-if="side === 'remote' && entry.permissions"`, rendering the technical string or the friendly `UBadge` per `ui.permissionsDisplay`.
- `FileToolbar.vue` currently has no `side` prop — add one so a new permissions-toggle icon button can be gated `v-if="side === 'remote'"`. `FilePane.vue` passes `:side="side"` and wires `@toggle-permissions="ui.togglePermissionsDisplay()"`.

## 7. Custom scrollbar styling

**File:** `src/renderer/src/assets/main.css`

Add global WebKit scrollbar rules (Electron renders Chromium, so `::-webkit-scrollbar*` is what actually applies; add `scrollbar-width`/`scrollbar-color` too for completeness). Reuse `@nuxt/ui`'s own runtime CSS vars (confirmed present, already flip with `.dark` the same way the file's existing `--ui-primary` override does) instead of new hardcoded colors:
- thumb: `var(--ui-border-accented)`
- thumb hover: `var(--ui-color-neutral-400)` (light) / `var(--ui-color-neutral-500)` (dark, inside the existing `.dark` block)
- track: `transparent`
- thin width (~8-10px), fully rounded thumb (`border-radius: 9999px`)

(No dark-mode toggle exists yet in the app — same as the pre-existing `.dark { --ui-primary: ... }` block, the `.dark`-scoped rules are forward-looking/dormant for now, not a regression.)

## 8. Tooltips on every icon-only button

Wrap icon-only buttons with `@nuxt/ui`'s `<UTooltip text="...">` (confirmed `as-child` trigger rendering adds no extra DOM node, so it's safe around `group-hover:opacity-100` hover-reveal buttons). Files, reusing existing `aria-label` text where present:
- `TitleBar.vue` — Minimize / Maximize-or-Restore (dynamic text) / Close
- `SiteTabBar.vue` — tab-close ×, "+" new tab, and the relocated hide-Local toggle (item 3)
- `FileToolbar.vue` — Up, Refresh ("Refresh (Ctrl+R)" — ties to item 9), New folder, and the new permissions toggle (item 6)
- `FileRow.vue` — tail, extract, transfer (upload/download, dynamic text), delete
- `BottomDock.vue` — the collapse/expand chevron, and the Log-Tail tab-strip's per-tail close ×
- `SessionManagerView.vue` — the per-site edit (pencil) and delete (trash) icon buttons (missed in first pass, no existing aria-label)
- `TransferItem.vue` — the cancel × button (missed in first pass, no existing aria-label)

(Buttons with visible text labels — BottomDock's Transfers/Log Tail/Terminal tab buttons, `FilePreviewDialog.vue`'s and `LogTailViewer.vue`'s labeled buttons — are out of scope; tooltips are for icon-only affordances.)

## 9. Ctrl+R refreshes the current directory

**File:** `src/renderer/src/components/files/FilePane.vue`

Extend the existing per-pane `onKeydown` (already scoped to whichever pane's `tabindex="0"` div has DOM focus, already handling Delete/Backspace against `store`) with: `if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') { event.preventDefault(); void store.load(); return }`. Confirmed `Menu.setApplicationMenu(null)` (already set) removes the *only* thing that would otherwise bind Ctrl+R (the default Menu's `role: 'reload'` accelerator) — no `globalShortcut`/`accelerator` exists anywhere else — so `preventDefault()` here is defensive, not load-bearing. Per-pane scoping (not a single "active pane" concept) is confirmed consistent with the existing Delete/Backspace precedent.

Update the Refresh button's new tooltip text (item 8) to "Refresh (Ctrl+R)".

## 10. Ship the app icon/favicon

**Files:** `electron-builder.yml`, `src/main/index.ts`, `src/renderer/index.html`, new `src/renderer/public/favicon.ico`

- `electron-builder.yml`: under the `win:` block, replace the stale comment (references a nonexistent `build/icon.ico`) and add `icon: resources/1024x1024.png`. Confirmed electron-builder's real icon pipeline (`app-builder` tool) auto-generates the full multi-resolution Windows `.ico` from one square PNG ≥256×256 — no pre-made `.ico` needed for this.
- `src/main/index.ts`: pass `icon: IS_DEV ? path.join(__dirname, '../../resources/favicon.ico') : undefined` into the `BrowserWindow` constructor. Using `favicon.ico` (confirmed 3 embedded resolutions: 16/32/48) rather than the single-resolution `32x32.ico`, so Windows can pick the right frame for title bar vs. taskbar vs. Alt-Tab without upscaling blur. Packaged builds don't need this — they inherit the icon embedded in the exe by electron-builder's `win.icon` above (`resources/` isn't otherwise shipped into `files`, hence `undefined` when packaged).
- Create `src/renderer/public/favicon.ico` (copy of `resources/favicon.ico` — Vite's `public/` dir relative to `electron.vite.config.ts`'s renderer root is auto-copied to `out/renderer/` on build). Add `<link rel="icon" type="image/x-icon" href="./favicon.ico" />` to `index.html`'s `<head>` — **must be a relative path** (`./favicon.ico`, not `/favicon.ico`): confirmed the packaged build's `win.loadFile(...)` uses `file://`, where a root-absolute href resolves against the filesystem root and would 404; the project's own build output already rewrites every other asset reference to relative paths for exactly this reason. (Since the window uses fully custom `titleBarStyle: 'hidden'` chrome, this favicon has no visible on-screen effect — added for correctness/convention; the actually-visible icon comes from the `BrowserWindow`/exe icon handled above.)
- Update `.claude/PROJECT_MAP.md` Gotcha #6 ("No app icon set") to reflect the fix, matching the project's own convention of updating the map each round.

## CHANGELOG.md + VERSION

Create `CHANGELOG.md` (Keep a Changelog style) at the repo root with retroactive entries reconstructed from git history, then this round's entry:
- `0.1.0` — Initial scaffold (commit `5aa908b`)
- `0.2.0` — Round-2 UX features: saved sites, file preview/tail, hide-local toggle, custom titlebar, download/toast polish (commit `b372122`)
- `0.3.0` — Round-3: site tabs, SSH terminal, named sessions, collapsible Local rail (commit `5b67425`)
- `0.4.0` — This round: the 10 items above

Bump `package.json`'s `"version"` to `"0.4.0"` and add a plain-text `VERSION` file containing `0.4.0`, with a one-line note at the top of `CHANGELOG.md` that the two must be bumped together.

---

## Verification

1. `npm run typecheck` and `npm run build` — must stay clean, same bar as every prior round.
2. `npm run dev` boot smoke test, then `Get-Process` (PowerShell, not Git-Bash) to confirm no orphaned Electron process afterward — same discipline as rounds 2/3.
3. Manual/visual pass in the dev window (no real SFTP/SSH server or automated Electron-window driver is available in this environment, same limitation noted in every prior round's handoff — flagged explicitly rather than silently skipped):
   - Title bar: confirm "Ferry" is visually centered against the full window width at both the 900px min-width and a maximized width.
   - Confirm the Activity tab/button is gone from the dock and nothing throws on app boot (would surface as a console error from a dangling import).
   - Confirm the hide-Local toggle now lives at the right end of the tab-strip bar and still collapses/expands the rail correctly.
   - Connect to a saved site, open a new "+" tab, click the same saved site again — confirm it switches to the existing tab (no duplicate connection) and the empty "+" tab is cleaned up.
   - Connect to a site and confirm the Terminal dock tab shows a live, already-connected shell (not "Opening terminal…") the first time it's clicked, labeled `username@host`.
   - Toggle the new permissions column between friendly/technical on the remote pane; confirm the local pane shows no permissions cell.
   - Visually confirm the custom scrollbar appearance in a long file listing.
   - Hover every icon-only button confirmed above and check its tooltip text.
   - Focus a pane and press Ctrl+R — confirm it refreshes that pane's listing.
   - After `npm run package`, confirm the installer/exe/taskbar all show the new Ferry icon (this step requires actually running `npm run package`, which the user should do since it produces a real installer artifact on disk).

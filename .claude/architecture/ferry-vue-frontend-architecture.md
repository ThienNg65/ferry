# Ferry — Vue Frontend / UX Architecture

Scope: the Vue renderer only. The Electron main process is treated as a black box exposing a typed `window.api.*` surface (see the backend architecture doc for the actual IPC plumbing).

## Investigation Notes

- `C:\toys\ui` (local `@nuxt/ui` v4.9.0 clone) is **source only** — no `dist/`, so its `exports` map (`./vue-plugin`, `./vite`, etc.) can't resolve without a local build step. **Install `@nuxt/ui` from npm** instead; keep the clone purely as reference/skill material, not a dependency.
- Confirmed via `C:\toys\ui\playgrounds\vue` and the bundled `nuxt-ui` skill: the plain-Vite integration path is `@nuxt/ui/vite` Vite plugin + `@nuxt/ui/vue-plugin` Vue plugin (`app.use(ui)`) + `<UApp>` root wrapper + `@import "tailwindcss"; @import "@nuxt/ui";` in one CSS file. No Nuxt required.
- The component set covers exactly what this app needs: `UDashboardGroup/Panel/Sidebar/Navbar/Toolbar/ResizeHandle` (resizable multi-pane layout), `UTree`, `UTable`, `UContextMenu`, `UProgress`, `UFileUpload`, `UCommandPalette`, `UColorModeButton/Switch`. `@tanstack/vue-virtual` is already a transitive dependency — safe to depend on directly for log virtualization.
- Node v22.14.0 satisfies `@nuxt/ui`'s `engines` requirement (`^20.19.0 || >=22.12.0`).

## 1. Tech Choices

**Build tool: `electron-vite`**, not Vue CLI (maintenance mode, not Electron-aware). Scaffold via `npm create @quick-start/electron@latest`, template `vue-ts` — coordinated main/preload/renderer Vite configs with proper HMR.

**Vue 3 + `<script setup>` + Composition API** throughout — no Options API, no mixins.

**TypeScript — non-negotiable.** The value of a clean `window.api` surface is a typed contract between preload and renderer. One `src/shared/ipc-types.ts` (interfaces: `RemoteFileEntry`, `TransferProgressEvent`, `LogLine`, `SessionConfig`) imported by both preload's `.d.ts` and the renderer's Pinia stores.

**Pinia**, one store per domain, `src/renderer/src/stores/`:
- `sessions.store.ts` — saved connection profiles (CRUD via `window.api.sessions.*`), active-session pointer.
- `localFs.store.ts` — local pane: current path, entries, selection set, sort/view prefs.
- `remoteFs.store.ts` — remote pane: same shape, plus connection status (connecting/connected/error).
- `transferQueue.store.ts` — queued/active/completed items, aggregate progress, pause/cancel actions.
- `logs.store.ts` — two independent ring buffers: app activity log (session-scoped) and open remote log-tail stream(s), each capped (~5,000 lines) to bound memory.
- `ui.store.ts` — theme, panel sizes/collapsed state (persisted to `localStorage`), active dock tab, command-palette open state.

**Adopt `@nuxt/ui`'s Vue plugin + Tailwind (npm package, not the local clone).** Reasoning: matches existing familiarity + the `nuxt-ui` skill; 125+ accessible components remove the need to hand-roll focus-trapping modals/context menus/comboboxes/tooltips/resizable panels; `UDashboardGroup/Panel/ResizeHandle` is a near-exact fit for the resizable dual-pane + dockable bottom panel; Tailwind v4 + Nuxt UI's semantic tokens (`text-muted`, `bg-elevated`, `--ui-radius`) are exactly the restrained/systematic tokens the Apple-HIG brief calls for. Cost (Tailwind + Reka UI + component runtime) is a non-issue for a desktop app with no page-weight/SEO concerns. **Verdict: build on `@nuxt/ui`; reserve custom components only for genuinely app-specific pieces** (file-tree row renderer, virtualized log-tail viewer, custom title bar).

Install:
```bash
npm install vue pinia @nuxt/ui@4.9.0 tailwindcss @tailwindcss/vite @iconify-json/lucide
npm install -D @vitejs/plugin-vue vue-tsc typescript
```
`@iconify-json/lucide` installed **locally** (not relying on Iconify's runtime API) — packaged desktop app must work offline.

`electron.vite.config.ts` (renderer block):
```ts
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
renderer: {
  plugins: [vue(), ui({ ui: { colors: { primary: 'blue', neutral: 'zinc' } } })]
}
```

`src/renderer/src/main.ts`:
```ts
import './assets/main.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
createApp(App).use(createPinia()).use(ui).mount('#app')
```
Root template: `<UApp><AppShell /></UApp>` — `UApp` is mandatory for toasts/tooltips/`useOverlay`.

**No `vue-router`** — single-window state-driven shell (Session Manager vs. connected dual-pane is plain reactive state, not routed pages).

## 2. Visual Design System (Apple HIG → Nuxt UI tokens)

**Color**:
- `neutral: 'zinc'` — cool, modern gray scale for all chrome, closer to macOS system grays than default `slate`.
- `primary`: custom `brand` palette pinned to a macOS-blue-esque accent (`#0A84FF` light / `#409CFF` dark), 11-shade ramp via `@theme static`, `colors.primary = 'brand'`. Used **sparingly**: selected-row highlight, primary CTAs, active tab indicator, focus rings. Nothing else colored — "one accent, everything else monochrome."
- `success/warning/error/info` left as Nuxt UI defaults — transfer/connection status badges and destructive-action confirmations only.
- Dark mode via Nuxt UI's auto-registered color-mode + `UColorModeButton` in the title bar; override `--ui-primary` per mode.

**Typography** — system-native stack so Windows renders its own SF-like font:
```css
@theme {
  --font-sans: '-apple-system', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'Cascadia Code', 'SF Mono', Consolas, monospace;
}
```
Compact scale: 11px (badges/timestamps) / 12px (secondary/meta) / 13px (body — file rows, default) / 15px (panel/dialog titles) / 20px (empty-state/section headers). Avoid anything above `text-xl` anywhere.

**Spacing** — 4px base grid: 1(4px)/2(8px)/3(12px)/4(16px)/6(24px)/8(32px). File rows use `py-1.5 px-3` (~28px row height, Finder/WinSCP-style density), not Nuxt UI's comfortable card padding.

**Corner radius** — `--ui-radius: 0.5rem` (8px) globally for panels/dialogs/dropdowns; buttons/inputs `rounded-md` (6px); avatars/status dots `rounded-full`. No sharp corners.

**Elevation** — minimize drop shadows (Apple's language is hairline separation + translucency, not heavy shadow). Panels/dialogs: `bg-elevated` + 1px `border-muted`, no shadow. Only genuinely floating layers get shadow (popover/dropdown/context-menu/command-palette — Nuxt UI defaults already correct). Title bar: `backdrop-blur` + semi-transparent `bg-default/80`, assuming main process sets `transparent: true` / Win11 Mica (`backgroundMaterial: 'mica'`) — cross-cutting requirement flagged to the backend.

**Iconography** — Lucide (`i-lucide-*`, Nuxt UI's bundled default). Thin 1.5px stroke matches Apple's SF Symbols far better than filled icon sets. 16px in dense rows/toolbar, 20px in dialogs/empty states. Never mix filled + outline styles.

**Toolbar decluttering vs. WinSCP** — single icon-only row (`UButton` `variant="ghost"` `square`, `UTooltip` per icon), grouped by `USeparator`/`UFieldGroup`, overflow rare actions into a trailing "More" `UDropdownMenu`. No second toolbar row, no File/Edit/Options menu bar — replaced by `UCommandPalette` on `Ctrl+K` for all actions/navigation, plus a single app-menu `UPopover` (gear/kebab icon, top-right) for preferences/about. No permanent status bar — the collapsed transfer-queue dock header doubles as the status line ("3 of 7 · 42%").

## 3. Screen/Layout Structure

**Title bar**: custom frameless chrome (`titleBarStyle: 'hidden'`, main-process concern), `TitleBar.vue`. Targets **Windows primarily** — draw minimal Windows 11–style caption buttons (thin monochrome minimize/maximize/close, hover-highlight only, right-aligned), not macOS traffic lights. Center: connection name / local↔remote breadcrumb. Full bar `-webkit-app-region: drag`; interactive controls inside get `-webkit-app-region: no-drag`.

**App shell** (`AppShell.vue`):
```
<UApp>
  <div class="flex flex-col h-screen">
    <TitleBar />
    <UDashboardGroup class="flex-1" storage="localStorage" storage-key="ferry-layout">
      <div class="flex flex-1 min-h-0">
        <UDashboardPanel id="local-pane" resizable :default-size="50">
          <FilePane side="local" />
        </UDashboardPanel>
        <UDashboardResizeHandle />
        <UDashboardPanel id="remote-pane">
          <FilePane side="remote" />
        </UDashboardPanel>
      </div>
      <BottomDock />
    </UDashboardGroup>
  </div>
</UApp>
```
`UDashboardGroup/Panel/ResizeHandle` used purely as a generic resizable-multi-pane primitive (no left-nav page switching — single-view utility). Persist pane widths via its built-in `storage="localStorage"`.

**Bottom dock** (Transfer Queue / Activity Log / Log Tail): Nuxt UI's resize handle is documented for the horizontal sidebar case; for a **vertically** resizable dock that can fully collapse to a thin status strip, use a small custom `useResizablePanel` composable (drag-to-resize height, `localStorage`-persisted, min/collapsed/max heights) — same drag-handle styling (`bg-muted`, hover `bg-accented`) for consistency. Inside, `UTabs` switches between `TransferQueue.vue`, `ActivityLog.vue`, and open `LogTailViewer.vue` instances (one tab per tailed file, closeable).

**Site/session manager** — three complementary surfaces (Modal = focused task, Slideover = list/management, per Nuxt UI's guidance):
1. **Connect screen** (`SessionManagerView.vue`) — full-pane when there's no active connection (replaces both panes): searchable saved-sites list (host/last-connected + connect/edit/duplicate/delete) + prominent "New Connection" button. The WinSCP-login-screen-familiar entry point.
2. **Manage Sites** `USlideover` — reachable any time via a toolbar/site-switcher popover, for bulk edit/import/export/reorder without leaving the current session.
3. **Connection Dialog** (`ConnectionDialog.vue`) — `UModal` with `UForm`: Name, Host, Port (default 22), Username, Auth method (`UTabs`: Password/Private Key/Agent), Password or Key file (path + "Browse…" → `window.api.dialog.pickFile()`) + optional passphrase, "Remember" `USwitch` (labeled clearly as OS-credential-store delegation, not plaintext), footer `Test Connection` (loading state, inline `UAlert` on failure) + `Save & Connect`.

**Dual-pane file browser**: each `FilePane.vue` = `UDashboardPanel` with `#header` (breadcrumb + inline path input + refresh/up/new-folder buttons) → toolbar (search filter) → `#body` = virtualized file list, empty/error states via `UEmpty`/`UError`.

## 4. Component Breakdown

`src/renderer/src/components/`:

**`shell/`** — `AppShell.vue`, `TitleBar.vue`, `BottomDock.vue`, `CommandPalette.vue`

**`sessions/`** — `SessionManagerView.vue`, `SessionListItem.vue`, `ConnectionDialog.vue`, `SiteManagerSlideover.vue`, `useSessions.ts` (wraps `window.api.sessions.*` + store)

**`files/`** — `FilePane.vue`, `PathBreadcrumb.vue`, `FileToolbar.vue`, `FileList.vue` (virtualized, owns keyboard nav + selection), `FileRow.vue`, `FileContextMenu.vue`, `NewFolderPrompt.vue`, `useFileSelection.ts`, `useDragAndDrop.ts`, `useFileIcons.ts`

**`transfers/`** — `TransferQueue.vue`, `TransferItem.vue`, `useTransferQueue.ts`

**`logs/`** — `ActivityLog.vue`, `LogTailViewer.vue`, `RemoteFilePicker.vue`, `useLogTail.ts`

**`archive/`** — `ExtractHereAction.ts` (thin composable wrapping the "unzip" context-menu action → `window.api.archive.extractRemote(path)` + toast/progress feedback — single server-side op, no dedicated panel)

**`common/`** — `ConfirmModal.vue`, `EmptyState.vue`, `ErrorState.vue`

## 5. Key Interactions

**Drag-and-drop upload**:
- Local ↔ remote: `FileRow` is `draggable`; `dragstart` stores selected-set + source side in an in-memory drag payload (not `dataTransfer` JSON — avoids serialization limits); target `FilePane` highlights (`ring-2 ring-primary`) on `dragover`; `drop` calls `useDragAndDrop`'s `handleInternalDrop()`, dispatching upload/download intents based on source/target side.
- Explorer → app: `drop` with `event.dataTransfer.files`; extract absolute paths via `webUtils.getPathForFile(file)` (Electron's `File.path` is removed in modern Chromium — preload/main concern, exposed as `window.api.getDroppedFilePath(file)`), then `window.api.transfers.upload(paths, remoteTargetDir)`.
- Full-pane dashed-border overlay ("Drop to upload to /remote/path") on `dragenter` from outside the window, dismissed on `dragleave`/`drop`.

**Multi-select + context menu**: Explorer/Finder-standard (click/Ctrl+click/Shift+click/drag-lasso). Right-click on a row not already selected collapses selection to that row first, then opens `UContextMenu` with a grouped items array (auto-separator before destructive items). Archive files (`.zip .tar .gz .7z ...`) get an extra "Extract Here" entry, remote pane only.

**Keyboard navigation**: Arrow Up/Down (Shift+Arrow extends), Enter opens/downloads+opens, F2 renames in place, Delete opens `ConfirmModal`, Ctrl/Cmd+A selects all in focused pane, Tab/Ctrl+Tab switches pane focus, Ctrl+L focuses path input. Wired via Nuxt UI's `defineShortcuts`/`extractShortcuts` (also feeds command-palette kbd hints for free).

**Transfer progress**: `window.api.transfers.onProgress((e) => …)` updates `transferQueue.store` (throttled ~10Hz on the backend, or `useThrottleFn` in the composable if not). Each item: `UProgress`, byte/percentage text, rate, ETA, status badge (queued/active/paused/done/error/canceled, semantic color). Dock header shows aggregate even when collapsed.

**Live log tail — the jank-risk interaction**:
- Ring buffer capped ~5,000 lines (`shallowRef<string[]>`, drop oldest) — never unbounded.
- Render via `@tanstack/vue-virtual` (transitive dep of `@nuxt/ui`, safe direct use) — only visible rows mount regardless of buffer size.
- **Batch incoming lines**: buffer arriving lines in a plain array, flush into the reactive ring buffer once per `requestAnimationFrame` tick (or ~50–100ms) instead of one Vue reactivity trigger per line — the single highest-leverage change against jank at high line rates.
- Auto-scroll-to-bottom by default; manual scroll-up disables autoscroll and shows a floating "Jump to latest ↓" pill (classic `tail -f` UX) — directly answers "WinSCP's log doesn't tail live."
- Each row: minimal, non-reactive-per-cell (plain text node, pre-computed level-coloring classes), no per-line `computed`s.

## 6. Project Scaffold

No `vue-router`. View switching (Session Manager vs. connected dual-pane) is plain reactive state (`sessionsStore.activeSession == null`), avoiding route-transition complexity for zero benefit in a single-window app.

```
src/renderer/
  index.html
  src/
    main.ts
    App.vue                       # <UApp><AppShell /></UApp>
    assets/main.css                # @import "tailwindcss"; @import "@nuxt/ui"; @theme overrides
    components/
      shell/ sessions/ files/ transfers/ logs/ archive/ common/  (see §4)
    composables/
      useFileSelection.ts, useDragAndDrop.ts, useFileIcons.ts,
      useTransferQueue.ts, useLogTail.ts, useSessions.ts, useResizablePanel.ts
    stores/
      sessions.store.ts, localFs.store.ts, remoteFs.store.ts,
      transferQueue.store.ts, logs.store.ts, ui.store.ts
    types/                        (re-exports from src/shared/ipc-types.ts)
```

Proposed `window.api` surface consumed by stores/composables (alignment reference for the backend, not this doc's deliverable):
```ts
window.api.sessions.{ list, create, update, remove, connect, disconnect }
window.api.fs.local.{ list, mkdir, rename, remove, stat }
window.api.fs.remote.{ list, mkdir, rename, remove, stat }
window.api.transfers.{ upload, download, pause, resume, cancel, onProgress }
window.api.logs.{ tailStart(remotePath), tailStop(handle), onLine }
window.api.archive.extractRemote(path)
window.api.dialog.pickFile()
```

## Critical Reference Files

- `C:\toys\ui\skills\nuxt-ui\SKILL.md` — installation pattern (`UApp`/vue-plugin/vite-plugin wiring)
- `C:\toys\ui\skills\nuxt-ui\references\layouts\dashboard.md` — resizable multi-panel primitives, basis for dual-pane + dock layout
- `C:\toys\ui\skills\nuxt-ui\references\guidelines\design-system.md` — semantic color/spacing/radius tokens for the Apple-HIG visual system
- `C:\toys\ui\skills\nuxt-ui\references\guidelines\conventions.md` — `defineShortcuts`, items-array/context-menu conventions, `UApp` requirements
- `C:\toys\ui\package.json` — confirms `./vue-plugin`/`./vite` export shape, version to pin (`4.9.0`)

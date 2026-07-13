# Ferry Round-5: Customer Feedback Implementation Plan

## Context

After round-4 (commit `2a7a155`), the customer gave a fifth round of feedback covering eight distinct UX/perf complaints: slow startup, too few previewable file extensions, cramped dialogs, no sense of "something is happening," no animation anywhere, no visible app version, a hard-to-read Local/Remote pane label, and a Terminal that always lands in the SSH default directory instead of the site's configured remote start path. These are independent, mostly low-risk changes — the goal is to land all eight cleanly in one pass, following the repo's existing conventions (IPC contract-first, singleton `getInstance()` managers, per-domain Pinia stores, `UModal`/`UTooltip` patterns).

Two decisions were confirmed with the user via `AskUserQuestion`: "more file extensions" means broadening the text/code preview allowlist **and** archive/extract support (not image preview); "dialog should be bigger" means the **file preview dialog only** (not the site-form or delete-confirm dialogs).

Research (3 parallel Explore agents) and design (1 Plan agent) both ran against the actual current code; every file/line cited below was independently spot-checked by reading the file directly.

## Build order

Shared prerequisite first, then independent items, grouped where they touch the same file:
1. Extract `shellEscape()` into `src/main/ssh/shellEscape.ts` (currently a private helper duplicated conceptually — used by both item 2 and item 8)
2. Item 2 (extensions/archives) → Item 8 (terminal cwd) — both touch `main/` SSH-adjacent code
3. Item 1 (startup) — isolated, renderer bootstrap only
4. Item 3 (preview dialog size) — isolated, one file
5. Item 4 + Item 5 (busy indicator + animation) — combined since the dot needs a fade
6. Item 6 (version) — isolated
7. Item 7 (label prominence) — same file as item 5's `FilePane.vue` transition, different region, do together

## Item 1 — Startup under 1 second

**Important framing**: literal sub-1s cold start for any Electron app includes Chromium/V8 engine boot overhead outside app-code control (typically several hundred ms). This fixes the renderer-side blocking work Ferry's own code controls — the dominant one being a 554KB icon-set parse — not a guaranteed wall-clock number.

- **`src/renderer/src/main.ts`**: the current `import lucideIcons from '@iconify-json/lucide/icons.json'` is a *static* import — hoisted and evaluated before any other top-level code runs, blocking first paint on parsing ~554KB/6135 icons. Convert to a **dynamic** `import()` deferred via `requestIdleCallback` (with a `setTimeout` fallback), called *after* `createApp(App).use(...).mount('#app')`. Icons requested before the collection resolves pop in a frame later — Iconify's runtime handles this natively; still the full offline set (never a network fetch, since CSP blocks that) — just off the critical path. Update the existing top-of-file comment so a future reader understands why it's deferred, not just removed.
- **`src/renderer/src/stores/terminalStreams.store.ts`**: change the top-level `@xterm/xterm`/`@xterm/addon-fit` imports to type-only, and dynamically `import()` the real `Terminal`/`FitAddon` classes inside `ensureTerminal()` right before constructing them. Defers parsing a nontrivial library until a terminal is actually opened (already happens post-connect, async, so this is a transparent change to all callers).
- **`src/renderer/src/App.vue`**: `FilePane`/`BottomDock` are statically imported but only ever rendered in the `v-else` (connected) branch — convert both to `defineAsyncComponent(() => import(...))`. Do **not** lazy-load `TitleBar`/`SiteTabBar`/`SessionManagerView` — those render at first paint.
- **`package.json`**: remove `vue-router` from dependencies — confirmed unused repo-wide (only appears in the auto-generated `components.d.ts`, which regenerates clean on next dev/build). Re-run `npm install --registry=https://registry.npmjs.org` after removing.

## Item 2 — Broaden text/code preview + archive/extract support

- **New `src/main/ssh/shellEscape.ts`**: extract the existing private `shellEscape()` out of `UnzipService.ts` into its own module (matches the `main/ssh/`'s existing small-focused-module pattern alongside `errors.ts`/`retry.ts`). Shared by this item and item 8.
- **New `src/shared/archive.ts`**: pure helper, no Electron/Node deps —
  ```ts
  export type ArchiveKind = 'zip' | 'tar' | 'targz' | 'tarbz2'
  export function archiveKind(name: string): ArchiveKind | null { ... }  // .tar.gz/.tgz before bare .tar, then .tar.bz2/.tbz2, then .zip
  export function isArchive(name: string): boolean { ... }
  ```
  Deliberately excludes `.7z`/`.rar` (those tools aren't reliably present on remote Linux hosts and would need new error-handling design) — document as an intentional scope-out, not an oversight.
- **`src/renderer/src/utils/fileTypes.ts`**: broaden `TEXT_EXTENSIONS` (currently just `txt, log, conf, cfg, json, yml, yaml, ini, md`) with a curated, grouped set — structured data (`xml, csv, tsv, env, properties, toml, gitignore, editorconfig, htaccess, service`), shell/scripting (`sh, bash, zsh, py, rb, php, pl`), web (`html, htm, css, scss, less, vue, svelte`), JS/TS (`js, jsx, ts, tsx, mjs, cjs`), systems languages (`c, h, cpp, cc, hpp, java, go, rs`), misc (`sql, gradle, dockerfile`). The existing `ext(name)` helper already resolves extension-less dotfiles/filenames correctly (`.gitignore` → `gitignore`, `Dockerfile` → `dockerfile`), so no change needed there. Leave `LOG_EXTENSIONS` untouched. Re-export the new `isArchive`/`archiveKind` from this file so callers keep using one familiar module.
- **`src/renderer/src/components/files/FileRow.vue`**: replace the hardcoded `const isZip = computed(() => /\.zip$/i.test(props.entry.name))` with `isArchive(props.entry.name)` from `fileTypes.ts`; update the template's `v-if` accordingly. Icon/tooltip text stay as-is (already generic).
- **`src/main/unzip/UnzipService.ts`**: keep all external names (`unzip:run`, `extractRemote`) — "extract an archive" is the existing generic meaning. Internally: import the extracted `shellEscape`, derive `archiveKind` server-side from `archivePath` (never trust a renderer-supplied kind), and build the right command per kind (`unzip -qo` for zip, `tar -xf`/`-xzf`/`-xjf` for tar variants), still guarded by a `command -v <tool>` pre-check. Rename the sentinel/error code from unzip-specific to generic (`UNZIP_NOT_FOUND` → `ARCHIVE_TOOL_NOT_FOUND`) and name the actual missing tool in the error message.
- **`src/shared/contract.ts`**: rename the `IpcErrorCode` member `'UNZIP_NOT_FOUND'` → `'ARCHIVE_TOOL_NOT_FOUND'` (confirmed only 2 references repo-wide — the type and the one throw site — zero-risk rename).
- **`src/main/ipc/unzip.ipc.ts`**: no changes — request shape unchanged, kind detection happens inside `UnzipService.ts`.

## Item 3 — File preview dialog bigger

- **`src/renderer/src/components/files/FilePreviewDialog.vue`**: widen `:ui="{ content: 'max-w-2xl' }"` → `max-w-4xl`; bump the `<pre>`'s `max-h-[60vh]` → `max-h-[70vh]`. `overflow-auto` already provides scroll; no other structural change needed.

## Item 4 — Global "something is processing" indicator

- **New `src/renderer/src/composables/useGlobalActivity.ts`** (matches `useLogTail`/`useDragAndDrop`/`useNotify` naming convention): aggregates `sessions.store.ts`'s per-tab `connecting`, `transferQueue.store.ts`'s active-transfer count, and `remoteFs.store.ts`/`localFs.store.ts`'s previously-dead `loading` booleans (their first real consumer) into `isBusy`/`label` computeds.
- **`src/renderer/src/components/shell/TitleBar.vue`**: restructure the center grid column (currently a bare `<span class="justify-self-center ...">Ferry</span>`) into a small flex row with a `UTooltip`-wrapped pulsing dot (`size-1.5 rounded-full bg-primary animate-pulse`, shown only when `activity.isBusy`) beside the title. Keep `justify-self-center` on the new wrapper so round-4's centering fix isn't disturbed.

## Item 5 — Slight animation

- **`src/renderer/src/App.vue`**: wrap the connected/picker (`SessionManagerView` vs. `FilePane`+`BottomDock`) swap in `<Transition name="fade" mode="out-in">`. This is the only genuine discrete state boundary at the top level — **do not** key/re-mount `FilePane`/`BottomDock`/`TerminalView` per active site tab to manufacture a transition there; that would tear down the live xterm/fs-listing state the architecture deliberately preserves across tab switches (see `PROJECT_MAP.md` Conventions).
- **`src/renderer/src/assets/main.css`**: add the small `.fade-enter-active/.fade-leave-active` (opacity transition, ~150ms) classes, reused by both the App.vue swap and the busy-dot fade-in below.
- **`src/renderer/src/components/files/FilePane.vue`**: add `transition-[width] duration-200 ease-in-out` to the root div (already has a conditional `w-10 shrink-0` vs. `min-w-0 flex-1` class binding for the collapse-to-rail toggle) — animates the existing Local-pane collapse smoothly.
- **`src/renderer/src/components/shell/BottomDock.vue`**: add a height transition (`transition-[height] duration-200 ease-in-out`, explicit `h-9`/`h-56` for collapsed/expanded — CSS can't animate to/from `height: auto`). **Flag as the riskiest of the three** — the collapsed height is a guess at the header row's natural height and must be visually verified; if it clips or looks janky, skip animating this one and keep it instant rather than shipping a broken-looking transition.
- **Busy-dot fade** (ties to item 4): wrap the dot in `<Transition name="fade">` instead of a bare `v-if`, reusing the same CSS classes.

## Item 6 — Application version display

- **`src/shared/contract.ts`**: add `AppVersionResult { version: string }` and a new invoke channel `systemGetAppVersion: 'system:getAppVersion'`.
- **`src/main/ipc/system.ipc.ts`**: add `handle<AppVersionResult>(INVOKE_CHANNELS.systemGetAppVersion, () => ({ version: app.getVersion() }))` — `app.getVersion()` always reflects `package.json`, so it can never drift from a manually-maintained string.
- **`src/renderer/src/components/sessions/SessionManagerView.vue`** (the landing/picker screen, always shown before any connection): fetch the version on mount, render small muted footer text (`Ferry v{{ version }}`) below the existing site-picker cards.

## Item 7 — LOCAL/REMOTE label prominence

- **`src/renderer/src/components/files/FilePane.vue`**: current header is `<span v-if="showBody" class="text-xs font-medium uppercase tracking-wide text-muted">{{ side }}</span>` inside a `h-8` bar. Replace with an icon + text group: `text-muted` → `text-highlighted`, `font-medium` → `font-semibold`, plus an `i-lucide-monitor` (local) / `i-lucide-server` (remote) icon prefix — `i-lucide-server` is already used for remote-site rows elsewhere in the app, so this stays visually consistent. Same file/pass as item 5's width-transition change (different region — header span vs. root div class — no overlap).

## Item 8 — Terminal opens directly at the Remote start path

Confirmed: `Site`/`SiteInput` already has `remoteInitialPath?: string` (`contract.ts`), and `SessionManager.ts` already seeds `SessionEntry.cwdRemote` from it at connect time (`openFromSite()`/`openQuickConnect()` → `connect()`), exposed via `SessionManager.cwd(sessionId)` (already used by the file browser). SSH's shell-channel protocol has no cwd concept (verified against `@types/ssh2` — neither `PseudoTtyOptions` nor `ShellOptions` has one), so the only way to land in a directory is writing `cd <path>\n` into the stream after it opens.

- **`src/main/terminal/TerminalManager.ts`**: in `open()`, after `stream.on('data'/'exit'/'close', ...)` listeners are attached (so the shell's response to the injected command is forwarded like any normal typed command) but before returning, read `SessionManager.getInstance().cwd(sessionId)` and, if it's set and not `.` (i.e., a real configured path — skip the no-op case to avoid polluting scrollback), `stream.write(`cd ${shellEscape(cwd)}\n`)` using the shared `shellEscape()` from item 2's new module. Pure main-process change — no `contract.ts`/IPC/renderer changes needed at all. A nonexistent/unauthorized path just produces the shell's own normal `cd` error text in the terminal, identical to a user typing it manually — no special-case handling required.

## Critical files

- `src/renderer/src/main.ts`
- `src/main/terminal/TerminalManager.ts`
- `src/main/unzip/UnzipService.ts`
- `src/main/ssh/SessionManager.ts` (read-only reference — `cwd()`/`cwdRemote` already exists)
- `src/shared/contract.ts`
- `src/renderer/src/utils/fileTypes.ts`
- `src/renderer/src/components/files/FilePane.vue`
- `src/renderer/src/components/shell/TitleBar.vue`
- `src/renderer/src/components/sessions/SessionManagerView.vue`
- `src/renderer/src/App.vue`

## Verification

1. `npm run typecheck` and `npm run build` must stay clean throughout (existing project convention before every commit).
2. `npm run dev` boot smoke test: watch DevTools/console for errors from the deferred icon-set load and the async `FilePane`/`BottomDock` components; use PowerShell timing (or just visual judgment) to compare perceived time-to-interactive against a `git stash` baseline of round-4.
3. Manual pass against a real SFTP/SSH server (same limitation as every prior round — no tool here can drive the actual Electron window or a real server, so this is a checklist for the user):
   - Preview a file with a newly-added extension (e.g. `.py`, `.env`, `Dockerfile`) and confirm it renders as text.
   - Right-click/extract a `.tar.gz` and a `.tar` archive on the remote pane and confirm both extract; confirm a `.7z` file still shows no extract affordance (intentional).
   - Open the file preview dialog and confirm it's visibly wider with a taller scrollable body.
   - Kick off a transfer or connect a new site and confirm the title-bar dot appears/disappears and its tooltip text is accurate.
   - Collapse/expand the Local pane and the BottomDock and confirm the width/height transitions look smooth, not janky (per the flagged risk on BottomDock's collapsed height).
   - Confirm the version footer shows the correct `package.json` version on the landing screen.
   - Glance at the Local/Remote pane headers and confirm they're now clearly distinguishable (icon + higher-contrast text).
   - Set a site's "Remote start path," connect, open the Terminal, and confirm the shell lands directly in that directory (check via `pwd`).
4. Package (`npm run package`) and spot-check the installed app boots and behaves the same as dev mode.

# Milestone 2 — Pilot Hardening

## Context

Milestone 1 fixed the CI/auto-update pipeline. Before Ferry goes to a pilot group of real
users, Milestone 2 closes out the deferred half of the last full code review
(`.claude/report/2026-07-20-code-review-final.md`) and runs a fresh audit pass on top, so we
ship with as few known rough edges as possible.

That review's 7 Critical + 6 High-Priority issues were already fixed and committed (`ca4e7ce`).
Its own `handoff.md` explicitly deferred the rest — 22 lower-severity "Suggestions," test
coverage backfill, and CI/docs drift — to "a follow-up round." This milestone is that follow-up,
plus a full fresh audit (not just a diff review) since real users are now involved, plus one
small new feature (an "Open Edits" UI) that was left as unwired plumbing in the same review.

No Docker or real Electron UI is available in this environment, so the manual/integration
verification steps from the last round are still open — this milestone explicitly does not
pretend to close them; it flags them for the user to run before actual pilot rollout.

## Phase A — Fresh full audit

Run a comprehensive review of the entire codebase with fresh eyes (parallel `Agent` dispatches
by subsystem, mirroring the shape of the 2026-07-20 review: SSH/security core, IPC/secrets
boundary, transfer/sync, renderer stores, file-browser/shell UI components, build/CI). Dedupe
findings against the 22 known Suggestions in the existing report (don't re-litigate what's
already scoped) — the goal is to surface anything new introduced or missed since that review,
including any interaction with the Milestone 1 CI/AutoUpdater changes. Consider using the
`engineering:code-review` skill for this pass, or hand-rolled parallel `Agent` calls per
subsystem plus an adversarial verify pass on anything found, matching how the original review
was conducted.

Output: a merged, deduped findings list (known 22 + any new ones), each with file/line and a
proposed fix, ready to feed Phase B.

## Phase B — Fix everything confirmed

Fix the 22 known Suggestions (full list and file/line refs in
`.claude/report/2026-07-20-code-review-final.md`, "Suggestions" table) plus whatever Phase A
adds, batched by file/subsystem to avoid touching the same file twice:

- **`FilePane.vue` cluster**: #10 (delete ignores multi-selection in context-menu/hover-icon
  path), #11 (`renamingPath` stuck when filter hides the renaming row).
- **`PathBreadcrumb.vue`**: #12 (Windows backslash paths don't split into dimmed/bold segments;
  missing `@keyup.esc`).
- **Resource leaks**: #1 (`TransferQueue.ts` stream error handlers don't destroy on error like
  `onAbort` does), #6 (`CompressService.ts` partial-zip cleanup only on `CANCELLED`, not real
  fs/archiver errors).
- **Correctness/races**: #2 (`remoteFs.store.ts` `loadForSession` no request-sequencing guard),
  #5 (`TailManager.ts` `stop()` before PID line arrives orphans the remote process), #13
  (`MonitorPanel.vue` un-awaited `switchTo` with no overlap guard).
- **Consistency/type-safety**: #4 (`TailManager.ts`'s local `shellEscape()` duplicate — import
  the shared one), #8 (request payload interfaces declared locally instead of in
  `shared/contract.ts` — move `MonitorStartRequest`, `TailStartRequest`, `TerminalOpenRequest`,
  `TransferEnqueueRequest`, `DeleteManyRequest`, `Compress*Request`, `UnzipRunRequest`,
  `SessionOpenRequest`).
- **Validation**: #9 (`RemoteShell.chmod`'s `parseInt(mode, 8)` unguarded), #15
  (`SiteFormDialog.vue` `canSave` doesn't check `proxyHost` for custom proxy mode), #21
  (`settingsSetBandwidthLimit` no bounds check).
- **UX consistency**: #16 (`HistoryDialog.vue` "Clear" has no confirmation, unlike site-delete).
- **Robustness/defensive**: #3 (comment noting the intentional no-scoping assumption in
  `fs.ipc.ts`), #7 (`concurrency.ts` guard against `concurrency <= 0`), #14
  (`monitor.store.ts` per-session buckets never removed on tab close), #17
  (`sessions.store.ts` fire-and-forget `disposeForSession` — handle rejection), #18
  (`edit.ipc.ts`'s `editOpenLocal` forwards unvalidated path to `shell.openPath()`), #20
  (`release.yml` retry idempotency against an existing tag), #22 (`TerminalManager.open()` no
  defensive cleanup of a prior entry).

Group the actual edits by file, not by report-item-number, when implementing.

## Phase C — Test coverage backfill

Add tests for:
- Zero-coverage modules: `TailManager.ts`, `TerminalManager.ts`, `MonitorManager.ts` (lifecycle —
  its `procParse.ts` helpers are already tested), `AppSettingsStore.ts`, `BookmarkStore.ts`,
  `HistoryStore.ts`/`HistoryRecorder.ts`, `concurrency.ts`.
- All `src/main/ipc/*.ipc.ts` handlers (~20 files) — the raw-renderer-input boundary.
- `ProxyConnector.ts`'s SOCKS5 branch (only HTTP CONNECT is tested today).
- The two security-relevant sanitizers: `TailManager.sanitizeHistoryLines`,
  `MonitorManager.sanitizeIntervalMs`.

Follow existing test conventions in the same directories (see sibling `*.test.ts` files for
mocking patterns — e.g. `EditSessionManager.test.ts` for how `LocalFsService`/`RemoteFsService`
get mocked).

## Phase D — CI/docs drift

Revised after Phase A's audit — 2 of the 3 originally-scoped items turned out to be already
done or moot (see Phase A results above); real remaining work is:

- `README.md`'s "Releasing" section (lines 70-81): rewrite to match the actual current pipeline
  (single `ci.yml` workflow, auto-tag + build + `gh release create` with notes sourced from
  `CHANGELOG.md`, dormant SignPath signing gated on `SIGNPATH_ORGANIZATION_ID` — no separate
  `release.yml`, no `package-artifact` job, no `CSC_LINK`/`CSC_KEY_PASSWORD`).
- `package.json:20`: fix or remove the vestigial `"publish": "electron-builder --publish always"`
  script — misleading since CI actually does `--publish never` + a separate `gh release create`.
- `ci.yml`'s `auto-release` job: add a recovery path (or at least a clear failure message) for
  the case where the job fails after the version-bump-and-push step but before/during the final
  release creation — today a rerun would tag/build/release the wrong (already-bumped) version.
- Opportunistic, low-priority: fix `.claude/plan/ferry-smartscreen-signing-plan.md`'s stale
  references to a `release.yml` that no longer exists.
- No change needed to `ci.yml`'s `permissions:` block — already correct (verified against
  SignPath's own docs); do not "fix" it to `actions: write`, that would be wrong.

## Phase E — "Open Edits" UI feature

New self-contained feature, mirrors the existing `tailStreams` store + `BottomDock.vue` tail-tab
pattern exactly (same file: `src/renderer/src/components/shell/BottomDock.vue`, ~lines 93-186
for the badge/tab-strip convention to copy).

- **Main process**: add `EditSessionManager.listEdits()` — return a public-safe snapshot
  (editId, sessionId, remotePath, dirty/synced state) of the in-memory `edits` map. Add an
  `editList` invoke channel (`src/main/ipc/edit.ipc.ts`, `src/shared/contract.ts`).
- **Renderer store**: extend `src/renderer/src/stores/editSessions.store.ts` (currently discards
  `editEvent` payloads after firing toasts) to also accumulate them into an `edits: OpenEdit[]`
  array, keyed by `editId`. On store init / window load, call `editList` once to hydrate state
  for edits already open (the event stream alone only covers edits opened after that point).
- **Component**: new `src/renderer/src/components/edits/` directory, one component rendering a
  horizontal pill strip (truncated filename, session context, dirty/synced dot, a
  `UButton icon="i-lucide-x"` close button wired to the existing `editClose` channel) — same
  shape as the tail-tab strip. Wire it into `BottomDock.vue` as a new tab with a live-count
  `UChip` badge (same convention as the Transfers/Operations badges).
- No new channel needed for closing — `editClose` (`src/main/ipc/edit.ipc.ts`) already exists
  and works; this phase only adds visibility + the button to call it.

## Phase A results — fresh audit findings (confirmed, feeding into Phase B)

Six parallel subsystem audits ran against the current code. Findings below were spot-verified
by direct reading before being accepted; one claim was checked and rejected (noted). These are
*in addition to* the original 22 Suggestions above — fix both sets together, batched by file.

**SSH/security core:**
- `SessionManager.ts` `connect()`/`close()` race (Medium-High, **verified**): `connect()` inserts
  the `SessionEntry` into `this.sessions` (line 433) before the handshake completes, then does
  no re-check that the entry is still current before finalizing `status = 'connected'` (line
  553) or in the catch's `this.sessions.delete(sessionId)` (line 545). If `close(sessionId)` is
  called while a connect is in flight (e.g. user closes the tab during a slow handshake or a
  pending prompt), `close()` removes the entry and ends the client — but the in-flight
  `connect()` still finishes and unconditionally sets status back to `'connected'` and
  broadcasts it, for a session already torn down main-side. The underlying `ssh2.Client` socket
  is never closed (not reachable by any future `close()` call, since it's no longer in the map)
  — a real leaked connection plus a spurious "connected" toast. Fix: capture the entry reference
  at the start of `connect()` and check `this.sessions.get(sessionId) === entry` before
  finalizing status in both the success and catch paths.
- `ProxyConnector.ts` HTTP CONNECT / SOCKS5 auth is sent in cleartext before the SSH handshake
  (Low-Medium, architectural, not a coding bug — flag in docs/README as a caveat for untrusted
  proxy networks, no code fix planned this round).
- `RemoteShell.ts` `readFile`'s `truncated` flag is wrong when `maxBytes === 0` (Low, currently
  dormant — no production caller passes a dynamic/zero cap; fix while touching the file for other
  reasons, not worth a dedicated pass).
- `SessionManager.ts` password-auth branch has no upfront validation unlike privateKey/agent
  branches (Low — cosmetic error-message clarity only).

**IPC/secrets boundary:**
- `session.ipc.ts`'s `sessionKeyboardInteractiveRespond` doesn't validate `responses` shape
  before forwarding to ssh2 (Low).
- `contract.ts`'s `FsLocalWriteFileRequest` is exported but unused anywhere (confirmed via grep —
  only appears in `contract.ts` itself) — dead type, remove or wire up.
- `index.ts:166`'s `profileReport` handler bypasses the shared `handle()` envelope wrapper (Low,
  consistency only, dev-only path).

**Transfer/sync/background services:**
- `TailManager.ts` stale-reconnect-timer race (High, **verified** by direct read): `reconnect()`
  schedules an untracked `setTimeout` calling `follow(tailId, ...)`. If `start(tailId, ...)` is
  called again on the same id before that timer fires (tail panel closed/reopened during a
  transient-drop retry), `start()` replaces the map entry under the same key, but the orphaned
  timer's `follow()` re-fetches by key — finds the *new* entry, unaborted — and starts a second
  concurrent remote `tail` process. `stop()` only ever kills one of the two, permanently orphaning
  the other. Fix: capture the entry reference in the closure (or add a generation counter) instead
  of re-fetching by key in `follow()`/`reconnect()`.
- `EditSessionManager.ts` `watch()` watches the temp file path directly, not its containing
  directory (High, **verified** — real Node.js `fs.watch` caveat): editors that save via
  write-temp-then-rename-over replace the inode at that path; a watch bound to the original path
  can go silent after the first rename on some platforms/editors, meaning only the *first* save
  re-uploads and every subsequent save is silently never detected. Fix: watch the containing
  directory and filter events by filename (matches the project's own stated goal of surviving many
  saves per edit session).
- `SyncService.ts` `listRemoteTreeOrEmpty` swallows all remote errors, not just not-found (Medium-
  High, **plausible**, not independently re-verified line-by-line — re-check when implementing):
  a transient remote listing failure during a push-sync could be silently treated as "destination
  empty," queuing every source file for upload as a silent full overwrite.
- `CompressService.ts` cancel-before-import race in `compressLocal` (Medium-Low): abort listener
  attached only after the dynamic `import('archiver')` resolves, so a cancel requested during that
  window is missed.
- `MonitorManager.ts` `tick()` doesn't recheck `entry.stopped` immediately after the awaited exec
  (Low, UI consistency glitch only).

**Renderer stores:**
- `sessions.store.ts` `performOpenSession` (Medium-High, **plausible**): resolves `sessionOpen`,
  then awaits `remoteFs.loadForSession(...)`, and only after that unconditionally sets
  `tab.status = result.status` + a success toast — clobbering a legitimate concurrent
  `sessionStatus: 'error'` event if the connection drops during that window. Fix: check current
  `tab.status` isn't already a terminal/error state before overwriting.
- `transferQueue.store.ts` `enqueue()` unconditionally overwrites live event-driven item state with
  a stale `{state:'queued', ...}` snapshot once its own `invoke()` resolves, which can race behind
  the main process's synchronous `queued`/`started` broadcasts and — for very fast transfers —
  even clobber a terminal `done`/`error` state permanently (Medium).
- `history.store.ts` `list()` has no request-sequencing guard, same class of bug as the already-
  known `remoteFs.store.ts` one (Medium-Low).
- `remoteFs.store.ts` `clearSession` leaves a small knock-on bucket leak when a `loadForSession`
  resolves after the session's tab already closed (Low).
- `terminalStreams.store.ts` `disposeForSession` has no reservation guard against a concurrent
  `ensureTerminal` the way the open path does (Low, narrow race).

**File-browser/shell UI:**
- `FileRow.vue` Escape-to-cancel-rename can still commit the typed name (High, **verified** by
  direct read): the rename `<UInput>` has both `@keyup.esc="emit('cancel-rename')"` and
  `@blur="submitRename"`; cancelling doesn't reset `draftName`, and when Vue unmounts the input
  after `renamingPath` goes null, the browser's DOM-removal-fires-blur behavior triggers
  `submitRename()` with the stale, un-reverted draft — silently renaming the file to whatever was
  typed right after the user believed Escape cancelled it. Fix: reset `draftName` back to
  `entry.name` in the `cancel-rename` handler (or on the same watch that currently only resets it
  when renaming *starts*).
- `SessionManagerView.vue` multi-prompt keyboard-interactive auth: Enter in an earlier prompt field
  submits immediately with later fields blank (Medium-High, auth/lockout risk) — Enter should only
  submit from the last prompt or advance focus instead.
- `CommandPalette.vue`'s global Ctrl+K handler only excludes `.xterm` focus, not other text inputs
  generally (Medium) — same class of gap as the already-fixed `FilePane.vue` keydown hijack, just
  in a different component; add the same text-input `event.target` check.
- `BottomDock.vue` drag-resize has no live clamping during the drag itself (Low, cosmetic,
  self-corrects on release).

**Build/CI/docs:**
- `README.md`'s "Releasing" section (lines 70-81) is stale (High, **verified** by direct read):
  describes a separate `package-artifact` CI job, a standalone `release.yml`, release notes "from
  commit history," and `CSC_LINK`/`CSC_KEY_PASSWORD` signing — none of which match the current
  single-workflow `ci.yml` + `CHANGELOG.md`-sourced notes + dormant SignPath setup. Needs a
  rewrite to match reality.
- `package.json:20`'s `"publish": "electron-builder --publish always"` script is vestigial
  (Low, **verified**) — unused by CI (which does `--publish never` + a separate `gh release
  create`), misleading if run manually. Remove or fix its description.
- **Rejected finding**: the audit claimed `ci.yml`'s `permissions.actions: read` (lines 11-16) is
  wrong and needs to be `actions: write` for `actions/upload-artifact`/SignPath to work once
  activated. **Verified false** — `actions/upload-artifact` authenticates via a separate
  `ACTIONS_RUNTIME_TOKEN`, completely decoupled from the `permissions:` block (confirmed via
  GitHub Actions internals research); SignPath's own docs (`docs.signpath.io/trusted-build-
  systems/github`) show `actions: read` + `contents: read` as the correct example permissions
  block for a private repo without their GitHub App installed. **No change needed** — current
  `actions: read` is already correct. This also means the original Phase D item #1 ("add
  `permissions: contents: read` to ci.yml") is moot/already superseded — `ci.yml` already has a
  `permissions:` block (`contents: write`, needed because this job pushes tags/commits and
  creates releases; `contents: read` as originally scoped would break it).
- Original Phase D item #2 (stale `PROJECT_MAP.md` release-pipeline claim) — **already fixed**,
  confirmed accurate as of this audit. No action needed.
- Original Phase D item #3 (`release.yml` retry idempotency) — **moot**, `release.yml` no longer
  exists (consolidated into `ci.yml` in an earlier session); the described retry-wrapped
  `--publish always` step doesn't exist in the current pipeline.
- **New Phase D item**: `ci.yml`'s `auto-release` job has no recovery path if it fails *after* the
  version-bump-and-push step but before/during the final `gh release create` (e.g. mid-SignPath-
  signing) — a rerun would tag/build/release the wrong (already-bumped) next version, leaving the
  version that actually failed with no tag and no release (Medium).
- Low-priority doc cleanup: `.claude/plan/ferry-smartscreen-signing-plan.md` still references a
  `release.yml` that no longer exists (lines 20, 55, 90) — plans are non-authoritative per
  CLAUDE.md, low priority, fix opportunistically.

## Verification

- `npm run typecheck`, `npm test`, `npm run build` must all pass clean after every phase.
- Phase C additions should bring meaningful coverage to every module/file listed above — check
  with `npm test -- --coverage` if useful, but the bar is "the listed files have real tests,"
  not a specific percentage.
- **Explicitly not verified this round** (no Docker, no real Electron UI in this sandboxed
  environment): the Docker-backed SSH integration suite
  (`RemoteShell.integration.test.ts`'s header has the container command) and a manual
  click-through of the new Open Edits tab plus confirmation that the Phase B fixes behave
  correctly in the running app. Flag both clearly as open items for the user to run themselves
  before actual pilot rollout — do not claim them done.
- Per user preference, this plan should also be saved into `.claude/plan/` in the repo (not just
  the harness plan file) once approved, and per standing instruction: do not commit anything
  without being asked.

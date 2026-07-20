# Handoff — Code review fix round (2026-07-20 report), Critical + High-Priority items

## Goal

Fix every Critical and High-Priority issue from `.claude/report/2026-07-20-code-review-final.md`
(a merged two-round review covering SSH/security core, IPC/secrets boundary, transfer/sync, and
every renderer file-browser/store/component), in the report's own "Recommended Fix Order" section.
Scope was explicitly narrowed up front via `AskUserQuestion`: **Critical #1-7 + High-Priority #1-6
only** — the 22 Suggestions-level items, test-coverage backfill, and CI/docs drift (the report's
steps 5-6) are out of scope for this round, left for a follow-up.

The single worst finding driving this work: normal typing in the file browser (filter box, new-
folder box) could trigger the pane's Delete/Ctrl+A/F2 shortcuts and silently delete selected files,
because the keydown handler wasn't scoped away from text inputs.

## Current state of the code

**Committed and clean.** Commit `ca4e7ce` ("fix: resolve critical and high-priority code review
findings") is on `main`, 23 files changed (+330/-65), and includes a follow-up fix for a
self-review-caught regression (see below) folded into the same commit — `git status` shows only
`.claude/report/` (untracked, the review doc itself, not a code change — left alone deliberately)
and `.claude/PROJECT_MAP.md` (this session's documentation update, about to be committed alongside
this handoff). `CHANGELOG.md` shows as modified in `git status` but has a genuinely empty `git
diff` — a pre-existing artifact (likely line-ending/mode only), not something this session touched
or should worry about.

`npm run typecheck`, `npm test` (192 passed, 32 skipped), and `npm run build` all pass clean. The
32 skipped tests are the 5 real-server SSH integration test files self-skipping — **Docker isn't
running in this environment**, so none of the SSH/traversal/host-key fixes were verified against a
real server this session. That's the one category of verification still outstanding (see Next
Step). Manual UI click-through of the Electron app also wasn't performed (non-interactive
environment) — the file-browser keyboard fixes and the host-key-mismatch retry dialog both deserve
a real run-through before shipping.

## Files actively edited this session

All in commit `ca4e7ce`:

- `src/renderer/src/components/files/FilePane.vue` — keydown text-input guard, Ctrl+A/filter fix,
  stuck-rename fix, multi-select-aware delete (highest-churn renderer file)
- `src/main/ssh/SessionManager.ts` — host-key trust scoping (`TrustedHostKey` replaces a bare
  boolean), proxy socket leak fix (highest-churn main file)
- `src/main/ssh/RemoteShell.ts` — path-traversal entry-name validation, abort-destroys-stream fix
- `src/renderer/src/stores/sessions.store.ts` — in-flight-connect race fix, host-key retry wiring,
  tailStreams cleanup on tab close
- `src/shared/contract.ts`, `src/main/ssh/errors.ts`, `src/main/ipc/envelope.ts`,
  `src/main/ipc/session.ipc.ts` — `hostKey` field threaded through the whole IPC error envelope
- `src/main/transfer/TransferQueue.ts`, `src/main/sync/SyncService.ts` — `joinLocal` root-boundary
  guard (touched twice this session — see Changes Made #2 for the regression-and-fix)
- `src/main/edit/EditSessionManager.ts`, `src/main/ipc/edit.ipc.ts` — new `closeEdit()` + IPC
  channel (not yet called from anywhere in the UI — see Next Step)
- `src/main/archive/CompressService.ts` (+ its test) — zip `--` argument-injection guard
- `src/main/sites/SiteStore.ts`, `src/main/app/AppSettingsStore.ts` — `decrypt()` guards
- `src/renderer/src/components/terminal/TerminalView.vue`, `src/renderer/src/App.vue` — stale-
  session reattach guard, picker↔connected swap rework (`v-if`+`v-show` instead of `v-if`/`v-else`)
- `src/renderer/src/stores/tailStreams.store.ts`, `localFs.store.ts`, `remoteFs.store.ts`,
  `src/renderer/src/api.ts` — supporting store/type changes for the above

Also touched, not code: `.claude/PROJECT_MAP.md` (Conventions/Gotchas updated to document the new
patterns — see below), `handoff.md` (this file).

## Changes made

Followed the report's fix order exactly:

1. **`FilePane.vue` keyboard hijack + selectAll/filter mismatch** (Critical #1/#2) — `onKeydown`
   now returns immediately if `event.target` is a text input; Ctrl+A scopes to `filteredEntries`
   (both fs stores' `selectAll()` gained an optional `entries?` param). Bundled two related bugs
   found in the same file/pass: `renamingPath` getting stuck when a filter hides the renamed row
   (new `watch(filteredEntries, ...)`), and the context-menu/hover-icon delete ignoring an active
   multi-selection (new `onRemoveEntry` dispatches to `removeMany` when appropriate).
2. **Path traversal via SFTP filenames** (Critical #3) — `RemoteShell.readdirRecursive` now throws
   on any entry filename that's empty, `.`/`..`, or contains `/`/`\`. Defense-in-depth:
   `TransferQueue`/`SyncService`'s `joinLocal` assert the resolved path stays under root. **This
   introduced a real regression, caught by this session's own `/engineering:code-review` pass**:
   the boundary check false-positive-rejected every legitimate path when `root` was exactly a
   drive/filesystem root (`path.resolve('C:\\')` already ends in a separator, so appending another
   for the prefix check doubled it) — verified with a direct Node repro, then fixed by normalizing
   the trailing separator before comparing. Both the bug and the fix are documented as PROJECT_MAP
   Gotcha #21.
3. **Host-key trust over-scoping** (Critical #4) — the report and the initial exploration pass
   disagreed on this one, so it was traced carefully before touching code: confirmed a single
   `trustHostKeyChange: boolean` was threaded into every hop's `buildConnectConfig` AND the target,
   so a user-confirmed retry after ONE hop's mismatch silently force-trusted every other hop too.
   Replaced with `TrustedHostKey | undefined` (`{host, port}`), threaded end-to-end: `SshError`/
   `IpcErr` gained an optional `hostKey` field, `SessionOpenRequest.trustedHostKey` replaces the
   boolean, `pendingHostKeyMismatch` on the renderer side now carries the specific host:port to
   re-confirm. Added an integration test proving an unrelated host:port still gets flagged on retry.
4. **`EditSessionManager` leak** (Critical #5) — added `closeEdit(editId)` (stops watcher/timer,
   removes the map entry, deletes the temp dir unless unsynced) + a new `edit:close` IPC channel,
   wired through `contract.ts`/`edit.ipc.ts`. `closeAllForSession`'s existing "keep watching-and-
   never-delete" behavior on session close was left as-is (documented intentional design, not part
   of this fix).
5. **`tailStreams` cross-session bug** (Critical #6) — `OpenTail` gained a `sessionId` field;
   `open()` dedups on `(sessionId, remotePath)` instead of `remotePath` alone; new
   `closeForSession()` wired into `sessions.store.ts`'s `closeTab()`.
6. **`RemoteShell` abort leak + tab-close race** (Critical #7 + High #1, same pass) — `execOnce`/
   `execLines` now destroy the SSH channel on abort (mirroring the existing timeout path).
   `sessions.store.ts`'s `openSession` was split into a thin wrapper + `performOpenSession` (to
   avoid a TypeScript TDZ error self-referencing its own promise) so the in-flight connect promise
   can be stored on the tab; `closeTab` now awaits it before tearing down, instead of detaching the
   tab while a real SSH session was still connecting underneath it.
7. **Remaining High-Priority items**: zip `--` separator (argument injection), proxy socket
   `destroy()` on a failed connect (hoisted the `sock` variable above the `try` so the `catch` can
   reach it), `decrypt()` guards (`isEncryptionAvailable()` + try/catch) in both `SiteStore`/
   `AppSettingsStore`, `TerminalView.vue`'s capture-and-recheck staleness guard, and `App.vue`'s
   picker↔connected swap rework (see PROJECT_MAP.md's updated Convention entry + Gotcha #9 addendum
   for the full mechanism and trade-off — the connected view no longer fades OUT on disconnect).
8. **Self-review** (`/engineering:code-review` on the diff, at the user's request): found the
   `joinLocal` drive-root regression above (fixed, folded into `ca4e7ce`), plus three lower-severity
   notes accepted as-is: the `joinLocal` guard logic is duplicated verbatim across two files (not
   extracted to a shared helper — not requested); the new `edit:close` channel has no caller yet
   (intentional — see Next Step); the picker↔connected swap's disconnect fade-out is gone (accepted
   trade-off for the `term.open()`-twice correctness fix).
9. **PROJECT_MAP.md updates**: reworked the "picker↔connected swap" Convention bullet, added an
   addendum to Gotcha #9 (xterm double-open), added a new Gotcha #21 (the `path.resolve` drive-root
   trailing-separator pitfall), and two new Convention bullets (pane-keydown-must-check-target;
   host-key-retry-must-be-scoped-not-boolean).

## Everything tried that failed

- **Self-referencing `const attempt = (async () => {...})()`** in `sessions.store.ts`'s
  `openSession`, where the closure's `finally` block read `attempt` to null out
  `tab.connectPromise`. TypeScript flagged `TS2454: used before being assigned` — even hoisting to
  `let attempt: Promise<void>` declared before the IIFE didn't help, since TS eagerly analyzes an
  IIFE's body as part of the same expression evaluating the assignment. Fixed by extracting the
  body into a separate `performOpenSession` action, called and assigned to `tab.connectPromise`
  before it starts running — no self-reference needed. (`npm run typecheck` caught this
  immediately; not a runtime bug, just worth knowing if you see the same TDZ error again in a
  similar closure-stores-its-own-promise pattern.)
- **Trying to verify the SSH integration tests / manually click through the app.** Docker isn't
  running in this sandboxed environment (`docker ps` fails to connect to the daemon), and there's
  no way to drive the actual Electron UI here — both are explicitly flagged as outstanding, not
  silently skipped.

## Next step

1. **Run the Docker-backed integration suite for real** before shipping — `RemoteShell`,
   `SessionManager` (incl. the two new/modified host-key-scoping tests), `SessionManager.jumphost`,
   and `TransferQueue` integration tests all currently self-skip here. See
   `RemoteShell.integration.test.ts`'s file header for the container command.
2. **Manually click through the Electron app** (`npm run dev`), specifically: type into the filter/
   new-folder boxes while files are selected (the original critical bug); Ctrl+A with an active
   filter; trigger a real host-key mismatch and confirm the retry dialog only re-prompts for a
   genuinely different host on a second, unrelated mismatch; disconnect/reconnect a session with an
   open terminal (confirm no console error, no lost scrollback); tail the same path from two
   different sessions.
3. **Decide whether to build a UI affordance for `closeEdit()`.** The IPC channel and manager
   method exist and are wired end-to-end but nothing in the renderer calls
   `INVOKE_CHANNELS.editClose` yet — there's no existing "open edits" list/tab in the UI to attach a
   close button to. Either add one, or leave it as future-use plumbing (current behavior:
   `closeAllForSession`'s existing cleanup on session-close/app-quit is unchanged).
4. **Follow-up round for the remaining report items** (Suggestions #1-22, test-coverage backfill
   for `ipc/*.ipc.ts` and the two sanitizer functions, `.github/workflows` docs drift) — deliberately
   out of scope this round per the user's own scope choice.
5. Do not commit anything further without being asked.

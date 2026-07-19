# Handoff — WinSCP-parity gap review, 13-feature implementation (0.13.0)

## Goal

Close every gap identified in a critical WinSCP-parity review of Ferry (pretending to be a daily
user of the app, then turning the findings into an actual implementation plan): 13 features
spanning file-browser UX, connection/auth hardening, and sync/history/polish, built via an
approved 4-round phased plan. Scope decisions the user made up front, via `AskUserQuestion`: build
everything (not a subset), phased; external-editor launch uses the OS default file association (no
new settings surface); sync is one-way mirror only for v1 (no bidirectional conflict resolution).
After implementation, a self-review (`/engineering:code-review`) found 5 real issues, all fixed.
Then: version bump to 0.13.0, a `CHANGELOG.md` entry, commit, and this handoff.

The approved plan currently lives only at
`C:\Users\nvtthien\.claude\plans\pretend-that-you-are-joyful-jellyfish.md` — it has NOT yet been
copied into `.claude/plan/` under this repo's usual naming convention
(`ferry-feature-round2..6-plan.md`), see Next Step.

## Current state of the code

**Committed and clean.** Commit `b52d2c6` ("feat: WinSCP-parity gap review — 13 features
(v0.13.0)") is on `main`, includes all 13 features + the 5 code-review fixes + the version bump +
changelog entry. `npm run typecheck` and `npm test` are both green except two **pre-existing,
environmental** integration-test failures in `SessionManager.jumphost.integration.test.ts`
(`CHANNEL_OPEN_FAILURE` against the local Docker test container — reproduces identically on `main`
before any of this session's changes, confirmed by comparing failure signatures; not a regression,
documented as Gotcha #16 in `.claude/PROJECT_MAP.md`).

Working tree right now has two uncommitted changes:
- `.claude/PROJECT_MAP.md` — this session's documentation update, re-read end-to-end just now to
  confirm the whole edit sequence landed cleanly with no markdown corruption. Not yet committed.
- `electron.vite.config.ts` — a one-line change (`ui({ router: false, ui: {...} })`) made by a
  **concurrent Claude Code session** running against this same repo in parallel, not by this
  session. Deliberately left uncommitted and unstaged, exactly as it was when `b52d2c6` was made
  (that commit staged all 68 files individually by path, never `git add -A`, specifically to avoid
  bundling this stray change).

## Files actively edited this session

Most-recently-touched, most likely to need follow-up:
- `handoff.md` (this file, repo root)
- `.claude/PROJECT_MAP.md` (extensive update this turn, uncommitted)
- `CHANGELOG.md`, `package.json`, `package-lock.json`, `VERSION` (0.13.0 bump, committed)

Everything else from the 13-feature build is already committed in `b52d2c6` (~68 files). Highest-
churn files: `src/main/ssh/SessionManager.ts` (multi-hop jump-chain + proxy refactor —
`jumpClient: Client|null` → `jumpClients: Client[]`, `connect()` rewritten as a loop over hops),
`src/shared/contract.ts` (largest single diff — new types for `ProxyConfig`, `JumpHostConfig[]`,
symlink fields, `Bookmark`, `HistoryEntry`, edit/sync channels), `SiteFormDialog.vue` (jump-hop
array editor + proxy inherit/none/custom selector + "Generate new key" button).

New domain directories under `src/main/`: `bookmarks/`, `edit/`, `history/`, `sync/` — each a
`Store`/`Manager`/`Service` singleton or pure-function module plus its own `ipc/*.ipc.ts` file,
following the existing per-domain pattern.

## Changes made

1. **Round 7** (independent, built in parallel): symlink handling — a remote directory reached via
   a symlink was misreported as a plain file because SFTP's `readdir` returns lstat-style attrs;
   fixed with a second `stat()`/`readlink()` round-trip. In-listing search/filter (pure renderer,
   no IPC). SSH-agent pre-flight diagnostics (`agentDiagnostics.ts` — reachability + identity-count
   probe before connect, rewritten error messages). WinSCP/PuTTY nested-folder-group import fix (a
   real, confirmed bug: `scanWinScpSessions` silently dropped folder groups and everything nested
   in them — fixed with `walkWinScpNode`'s recursion). Custom accent color (`colorRamp.ts`,
   targets the live `--ui-color-primary-*` vars, confirmed via devtools spike, not the build-time
   `--color-brand-*` source palette). Auto-update — no code change; confirmed the publish config
   and release workflow are already correctly wired, flagged the remaining cert/first-release
   decisions to the user as ops calls, not engineering ones.
2. **Round 8**: multi-hop jump-host chaining (`SessionManager.connect()`'s `hops` loop — each hop
   gets its own `HostKeyMismatchHolder`, never a shared one, or TOFU mismatch detection silently
   breaks for all but the last hop). SSH ed25519 key generation (`KeyGenerator.ts` — prefers the
   system `ssh-keygen`, falls back to a hand-rolled `openssh-key-v1` PEM encoder, cross-validated
   against a real installed `ssh-keygen -y`/`-l`). Bookmarks (new CRUD vertical slice, cascade-
   deletes when their site is deleted).
3. **Round 9**: SOCKS5/HTTP CONNECT proxy support (`ProxyConnector.ts` — SOCKS5 via the `socks`
   npm package, HTTP CONNECT hand-rolled; plugs into hop 0 only, later hops keep using the
   ordinary `forwardOut` tunnel). Persisted transfer/operation history (`HistoryStore` +
   `HistoryRecorder`, subscribing to a new additive `onTerminalEvent` hook on both `TransferQueue`
   and `OperationRegistry`).
4. **Round 10**: edit-in-external-editor (`EditSessionManager.ts` — reuses `OperationRegistry`, not
   `TransferQueue`, since opening a file needs an awaitable full download before `shell.openPath`;
   new `downloadForEdit`/`uploadForEdit` in `RemoteFsService.ts`, deliberately NOT the same read
   path as the ~1MiB-capped preview dialog). One-way directory sync/mirror (`SyncService.ts` — pure
   `computePlan` with a 2s mtime tolerance, mandatory preview-before-run step in `SyncDialog.vue`
   for the destructive `deleteExtras` option).
5. **Code-review fixes** (5 findings from `/engineering:code-review`, all applied): `fs.mkdir` for
   `EditSessionManager`'s temp dir now passes `{ recursive: true, mode: 0o700 }` (was missing
   `mode`); `RemoteFsService.downloadForEdit`'s write stream now uses `{ mode: 0o600 }`;
   `HistoryStore` rewritten from synchronous `electron-store` writes on every event to an in-memory
   array + 1s-debounced flush + explicit `flush()` on `before-quit` (a sync enqueuing hundreds of
   files would otherwise fire hundreds of blocking full-file JSON rewrites); a "bypass default
   proxy" checkbox added to `SessionManagerView.vue`'s quick-connect (shown only when a default
   proxy is configured, since `QuickConnectInput` has no persisted `proxyMode` to default from);
   `KeyGenerator.ts`'s `runSshKeygen()` got its doc comment expanded to document the passphrase-
   argv-exposure as an accepted, unavoidable risk (see Failed section — no behavior change).
6. Version bump 0.12.0 → 0.13.0 (`npm version 0.13.0 --no-git-tag-version`), a `CHANGELOG.md`
   entry following the file's existing Keep-a-Changelog-style format, single commit `b52d2c6`.

## Everything tried that failed

- **Fixing `ssh-keygen`'s passphrase exposure in argv.** Investigated whether there's a
  stdin/file-based way to pass `-N`/`-P`; confirmed via `ssh-keygen --help`'s full usage text that
  there isn't — its interactive prompt deliberately reads `/dev/tty` directly, bypassing stdin,
  specifically to prevent piping one in. Concluded no code fix is possible without reimplementing
  OpenSSH's bcrypt-pbkdf passphrase KDF ourselves, which was already rejected elsewhere in the same
  file as unjustified risk for a fallback code path. Resolution: documented as an accepted residual
  risk in the code (Gotcha #20 in PROJECT_MAP.md), not "fixed."
- **Weakening `EditSessionManager.disposeAll()`'s `stats.mtimeMs > entry.lastSyncedMtimeMs` check
  to `>=`, to fix a flaky test.** Considered and rejected. The flake's real cause was a filesystem
  mtime-resolution race in the *test* (two `fs.writeFile` calls close enough together in time that
  mtime didn't reliably distinguish them, occasionally making the "unsynced" file look already-
  synced), not a bug in the production comparison. Loosening `>` to `>=` would have broken the
  "delete a truly-synced file on quit" case entirely just to paper over a test artifact. Fixed the
  test instead (added a 50ms delay before the final write) — reproduced the flake 1-in-3 runs
  before the fix, confirmed 5/5 clean runs after.
- **A `v-for` over an object keyed by triplet name**, considered while touching adjacent
  `ChmodDialog.vue` code during Round 8 review — rejected: `vue-tsc --build`'s strict template
  checking can't narrow a `v-for`-widened key to a literal union, so the 3×3 permission grid stays
  three explicit `<tr>`s (a pre-existing decision from an earlier round, reconfirmed not re-tried).
- No implementation attempt in the 13-feature build had to be reverted outright — every service/
  IPC/store addition worked on its first typecheck+test pass.

## Next step

1. **Commit `.claude/PROJECT_MAP.md`'s update** — it's verified clean but still unstaged. Leave
   `electron.vite.config.ts` out of that commit (it isn't this session's change).
2. **Copy the approved plan into `.claude/plan/`** under this project's naming convention (e.g.
   `ferry-feature-round7-10-plan.md`, matching `ferry-feature-round2..6-plan.md`) so it's
   discoverable the same way every prior round's plan is, per a standing preference to keep
   plan-mode plans in-repo rather than only in the harness's plan-file location.
3. **Manual QA still outstanding** (documented as required in the plan, not yet performed by a
   human): SSH-agent hardening against a real Windows OpenSSH Agent/Pageant; a real multi-hop +
   proxied connection including a deliberate host-key-mismatch case; the full edit-in-editor matrix
   (remote edit+save, kill-connection-mid-edit, quit-with-pending-reupload, same file opened
   twice); a real `deleteExtras` sync run against a live directory tree. None of this blocks
   anything already committed, but it's the one category of verification typecheck/vitest can't
   cover for an Electron app (see PROJECT_MAP.md Gotcha #13).
4. Do not commit anything further without being asked — the standing rule for this session.

# Handoff — Electron Security & Performance Hardening (0.11.0)

## Goal

An audit against Electron's own official [security](https://www.electronjs.org/docs/latest/tutorial/security) and [performance](https://www.electronjs.org/docs/latest/tutorial/performance) checklists, run against the whole codebase. Ferry already had the fundamentals right (context isolation, sandbox, no Node integration, bundled build, a CSP, no default menu, no `<webview>`, local-only architecture) — this round closed the remaining defense-in-depth gaps, banked a few real performance wins, and brought Electron off an end-of-life major version (30 → 43), since that was in scope too.

Full plan record: [`.claude/plan/ferry-security-perf-hardening-plan.md`](.claude/plan/ferry-security-perf-hardening-plan.md).

## Current state

**All of this session's work is implemented, verified, and committed on branch `harden/security-perf` (not yet merged to `main`).** `npm run typecheck` and `npm run build` are clean; `npm test` passes 180/181 (the 1 failure — `SessionManager.jumphost.integration.test.ts` — is a pre-existing environmental gap in the local Docker SSH container, confirmed to fail identically on unmodified `main`, not a regression from anything here).

Commit sequence on `harden/security-perf`, **this session's commits**:
```
3739bda feat(security): harden main-process against Electron checklist gaps
80e4cee perf(main): lazy-load ssh2 and archiver off the startup path
80f323d perf(renderer): virtualize FileList with @tanstack/vue-virtual
c4f421a chore(deps): upgrade Electron v30 -> v43 and modernize build toolchain
4f67ec8 fix(dnd): resolve dropped-file paths via webUtils for Electron 43
e26f3b9 docs: add changelog entry for 0.11.0 security & performance hardening
7b71803 fix(security): allow clipboard-write through the permission handler
[ 09795f0 — see "Branch note" below, not this session's commit ]
a033d34 docs: correct PROJECT_MAP's permission-handler description, add clipboard gotcha
```

**Branch note:** `harden/security-perf` was shared with a second, concurrent Claude Code session working the same repo in parallel (a Monitor-dashboard overhaul — storage usage, top-processes table, resizable dock). Their commit, `09795f0 feat(monitor): storage usage, top-processes table, resizable dock`, landed on this same branch in between this session's own commits. It is **not** this session's work — it was left completely untouched throughout (its in-progress files kept reappearing as uncommitted changes in `git status` across this whole session and were never edited or committed by this session). Their own `CHANGELOG.md` entry (`## 0.12.0`) now sits correctly above this session's `## 0.11.0` entry, and they bumped `VERSION`/`package.json` to `0.12.0` on top of this session's `0.11.0` — both are consistent and in order.

**This file (`handoff.md`) itself was overwritten by that same parallel session with their own handoff before this write.** Their content isn't lost — it's recoverable via `git show 09795f0:handoff.md` (or `git log -p -- handoff.md`) — this session's `/handoff` simply reflects the current conversation, per this repo's established convention of one handoff.md per most-recent session.

**Worth flagging to whoever merges this branch:** it now carries two unrelated pieces of work (this session's hardening + the parallel Monitor round) under one branch name. Either merge as-is with that called out in the PR description, or split first — the commit list above makes the split mechanical (cherry-pick/rebase around `09795f0`).

## Files actively edited this session

- **Security hardening**: `src/main/index.ts` (permission handler, `will-navigate` guard, `openExternal` scheme allowlist), `src/renderer/index.html` (CSP `img-src`/`connect-src`), `electron-builder.yml` (Electron Fuses block)
- **Async private-key read**: `src/main/ssh/SessionManager.ts` (`readFileSync` → `readFile`, `buildConnectConfig` made async)
- **Lazy-loading**: `src/main/ssh/SessionManager.ts` (`ssh2` → `import type` + dynamic `import()` in `connect()`), `src/main/archive/CompressService.ts` (`archiver` → dynamic `import()` in `compressLocal()`), `electron.vite.config.ts` (added `archiver` to main externals)
- **FileList virtualization**: `src/renderer/src/components/files/FileList.vue` (wired up `@tanstack/vue-virtual`'s `useVirtualizer`, `measureElement`-based dynamic row heights)
- **Electron 30→43 bump**: `package.json` (`electron`, `electron-builder`, `electron-vite`, `@types/node`), `package-lock.json`
- **Drag-and-drop fix (Electron 43 breaking change)**: `src/preload/index.ts` (exposed `getPathForFile` via `webUtils`), `src/renderer/src/env.d.ts` (typed it on `ElectronAPI`), `src/renderer/src/components/files/FilePane.vue` (`onOsDrop` uses it instead of `File.path`)
- **Clipboard-permission fix**: `src/main/index.ts` (permission handler now allowlists `clipboard-sanitized-write` instead of denying everything)
- **Docs**: `.claude/PROJECT_MAP.md` (Electron/tooling versions, 4 new Conventions entries, Gotchas #5 rewritten + #14–#17 added), `CHANGELOG.md` (`## 0.11.0` entry), `VERSION`/`package.json` (bumped to `0.11.0`, later carried forward to `0.12.0` by the parallel session), `.claude/plan/ferry-security-perf-hardening-plan.md` (new, copy of the approved plan)

## Changes made (by area)

1. **Security hardening** — `session.defaultSession.setPermissionRequestHandler` now allowlists only `clipboard-sanitized-write` (see item 7 below — first pass was deny-all and broke clipboard copy). An unconditional `will-navigate` handler blocks all top-level navigation (there's no `vue-router`, so anything triggering it is illegitimate; it doesn't fire for the initial `loadURL`/`loadFile`). `setWindowOpenHandler`'s `shell.openExternal(url)` now only fires for `http:`/`https:` schemes (parsed via `new URL`, try/caught for malformed URLs) — closes a path where a maliciously-named remote file/log line could trigger an arbitrary OS handler. CSP gained explicit `img-src 'self'; connect-src 'self'` (behavior-neutral — no `<img>`/remote fetch exists — just documents the boundary); `style-src 'unsafe-inline'` was deliberately kept and now has an inline comment explaining why (xterm.js/Vue set inline styles at runtime; nonce/hash CSP isn't feasible for a statically-served packaged `index.html`). Electron Fuses (`runAsNode:false`, `enableCookieEncryption:true`, `enableNodeOptionsEnvironmentVariable:false`, `enableNodeCliInspectArguments:false`, `enableEmbeddedAsarIntegrityValidation:true`, `onlyLoadAppFromAsar:true`) are now set in `electron-builder.yml` — verified applied via `npx @electron/fuses read --app dist/win-unpacked/Ferry.exe` after packaging, and verified the fused, packaged binary still boots.

2. **Async private-key read** — `SessionManager.buildConnectConfig()` is now `async`; the one `readFileSync(auth.privateKeyPath)` on the connect path became `await readFile(...)`, so a private-key connect no longer blocks the main process's event loop while the file loads.

3. **Lazy-loading `ssh2`/`archiver`** — both were imported at module top-level and pulled in transitively at app startup via the statically-imported IPC handler chain, even though neither is needed until the user actually connects or runs a local compress. `SessionManager.ts` now imports `Client` as `import type` only and does `const { Client: SshClient } = await import('ssh2')` inside `connect()` (aliased to dodge the file-wide type name); `CompressService.ts` does the equivalent for `ZipArchive` inside `compressLocal()`. Verified via `grep 'import("ssh2")' out/main/index.js` after a build that both stay runtime `import()` calls, not bundled.

4. **FileList virtualization** — `@tanstack/vue-virtual` was a declared-but-unused dependency; `FileList.vue` now uses `useVirtualizer` with `measureElement`-based dynamic row heights (not a fixed `estimateSize`, since row height shifts slightly with the inline rename input and the remote permissions column — measuring self-corrects instead of risking overlap), keyed by `entry.path` so sorts don't remount rows. `FileRow.vue` itself is unchanged (single consumer).

5. **Electron 30 → 43** — bumped `electron`, `electron-builder` (24→26), `electron-vite` (2→5), `@types/node` (20→22). Verified: clean typecheck (after clearing a stale `.tsbuildinfo` that briefly showed phantom `MonitorManager.ts` errors — see Gotcha #14), clean build, 180/181 tests passing, the built app boots (both `npx electron .` and the Fuses-hardened packaged `dist/win-unpacked/Ferry.exe`), and the installer builds successfully after a transient `EPERM` on the NSIS-resource cache resolved itself on retry (see Gotcha #15).

6. **Drag-and-drop fix** — the version bump would have silently broken OS-drag uploads (Explorer → remote pane): Electron 32 removed the DOM `File.path` extension that `FilePane.vue`'s `onOsDrop` read directly. This was flagged in advance by `PROJECT_MAP.md`'s pre-existing Gotcha #5 (written during an earlier session specifically to warn about this). Fixed by exposing `webUtils.getPathForFile` through the preload's `contextBridge` (`getPathForFile` on the `ElectronAPI` surface) and calling it from `onOsDrop` instead of reading `.path`. Gotcha #5 rewritten to describe the new, working mechanism.

7. **Clipboard-permission regression, found by the user in production console logs** — the security-hardening pass's permission handler was originally a blanket deny-all (`callback(false)` for every permission). This passed typecheck, build, and the full test suite, but broke `navigator.clipboard.writeText()` at runtime: Chromium gates it behind the `clipboard-sanitized-write` permission, routed through the exact same handler as camera/mic/geolocation. Two real call sites depend on it — `FileRow.vue`'s "Copy path" context-menu action and the terminal's Ctrl+C copy-selection (`terminalStreams.store.ts`) — both threw `NotAllowedError` until the user reported the console error directly. Fixed by allowlisting exactly `clipboard-sanitized-write` and denying everything else, including `clipboard-read` (the app already reads the clipboard via the main-process `system:clipboardReadText` IPC, never `navigator.clipboard.readText()`). Documented as PROJECT_MAP Gotcha #17 specifically because it's the kind of break automated verification cannot catch — only exercising the actual feature surfaces it.

## Everything tried that failed

- **Nothing was a dead end in the sense of "abandoned and reverted."** Two things looked like problems but weren't real regressions, and one thing was a real regression caught after the fact:
  - **Phantom `MonitorManager.ts` typecheck errors right after the Electron 30→43 `npm install`.** `npm run typecheck` reported 2 type errors in a file this session never touched. Traced to `tsc --build`'s incremental cache (`.tsbuildinfo`) going stale across the dependency bump — deleting the `.tsbuildinfo` files and re-running gave a clean result, and a side-by-side check against unmodified `main` under the same new `node_modules` confirmed it was clean there too. Not a real error; now documented as Gotcha #14.
  - **`EBUSY`/`EPERM` file-rename errors during `npm install` and the first `npm run package` attempt** (electron binary swap, then NSIS-resource cache extraction) — transient Windows file-lock/AV issues, not configuration problems. Both resolved by simply re-running the same command; `electron-builder` even logged "Detected stale extracting state ... re-extracting" and finished clean on retry. Documented as Gotcha #15.
  - **The real regression**: the deny-all permission handler broke clipboard copy in production, as described in item 7 above. This one genuinely shipped in an intermediate commit (`3739bda`) before being caught — worth being upfront about, since it's a real "verification gap" lesson (typecheck/build/tests all green, feature still broken), not a caught-in-review non-issue like the two above.
- The one pre-existing test failure (`SessionManager.jumphost.integration.test.ts`, `CHANNEL_OPEN_FAILURE`) was investigated and confirmed environmental (fails identically against unmodified `main`), not something this session broke or could fix — it's a limitation of the local Docker SSH container's channel-forwarding setup, tracked as Gotcha #16.

## Next step

No blocking next step for this session's own work — it's complete, verified, and committed. Two things worth doing before/at merge time:

1. **Decide how to land `harden/security-perf`** given the two-unrelated-pieces-of-work situation described in "Branch note" above.
2. **Real interactive QA still needs a human with a real SSH server**, same limitation as every prior round (`PROJECT_MAP.md` Gotcha #13 — this Electron app can't be driven through a browser preview tool). Specifically worth exercising manually before shipping 0.11.0's changes: connect via password/key/agent/jump-host (confirms the async private-key read and lazy `ssh2` load didn't regress any auth path), a local and remote compress-to-zip (lazy `archiver` load), a large-directory scroll/select/drag/rename/context-menu pass in the file list (virtualization), OS-drag-drop upload (the `webUtils.getPathForFile` fix), and "Copy path" + terminal Ctrl+C (the clipboard fix — the user's console-error report was the only signal this was broken, so re-confirming it's fixed for real would close the loop).

# Ferry — Electron Security & Performance Hardening

## Context

Ferry was audited against Electron's official **Security** and **Performance** checklists. The
fundamentals are already solid: `contextIsolation`, `sandbox`, `nodeIntegration:false`,
`webSecurity:true`, `allowRunningInsecureContent:false`, `experimentalFeatures:false` are all set
([src/main/index.ts:60-68](../../src/main/index.ts)); a CSP meta tag exists
([src/renderer/index.html:5](../../src/renderer/index.html)); the default menu is disabled on
Win/Linux ([src/main/index.ts:129-133](../../src/main/index.ts)); all three processes are bundled by
electron-vite; no `<webview>`, no remote content loaded, no external network calls at startup. The
app is local-only (renderer talks to main solely over the contextBridge IPC whitelist).

What remains are **defense-in-depth gaps** and a few **perf opportunities** the checklists flag:
no permission handler, no navigation guard, an unvalidated `shell.openExternal`, no Electron Fuses,
an EOL Electron (v30 vs current v43), eager loading of heavy native modules on the startup path, a
non-virtualized file list (with the virtualization library already installed but unused), and a
synchronous private-key read. This plan closes all of them.

**Scope confirmed with user:** all three tiers — low-risk hardening + lazy-loading + FileList
virtualization — **plus** the Electron major-version bump.

---

## Part A — Security hardening (low-risk, one pass)

### A1. Deny all permission requests by default
- **File:** `src/main/index.ts`, inside `app.whenReady()`.
- import `session` from `electron`; add
  `session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))`.

### A2. Block in-page navigation (`will-navigate`)
- **File:** `src/main/index.ts`, inside `createWindow()` beside `setWindowOpenHandler`.
- `win.webContents.on('will-navigate', (e) => e.preventDefault())`. No `vue-router`; `will-navigate`
  doesn't fire for the initial load, so unconditional prevent is safe.

### A3. Scheme allowlist before `shell.openExternal`
- **File:** `src/main/index.ts` (`setWindowOpenHandler`).
- Parse `new URL(url).protocol`; only `shell.openExternal(url)` for `http:`/`https:`; try/catch
  malformed; always `return { action: 'deny' }`.

### A4. Lock down Electron Fuses
- **File:** `electron-builder.yml` (top level).
- Add `electronFuses:` block — `runAsNode:false`, `enableCookieEncryption:true`,
  `enableNodeOptionsEnvironmentVariable:false`, `enableNodeCliInspectArguments:false`,
  `enableEmbeddedAsarIntegrityValidation:true`, `onlyLoadAppFromAsar:true`.
- Requires a real `npm run package` + launch smoke test.

### A5. Explicit CSP `img-src`/`connect-src`; keep `style-src 'unsafe-inline'` (documented)
- **File:** `src/renderer/index.html`.
- Append `img-src 'self'; connect-src 'self'`. Keep `style-src 'unsafe-inline'` (xterm.js/Vue inline
  styles); add an HTML comment explaining the tradeoff.

### A6. IPC sender validation — considered, declined (no change)
### A7. electron-store sync reads at startup — considered, declined (no change)

---

## Part B — Performance

### B1. Async private-key read
- **File:** `src/main/ssh/SessionManager.ts` — `readFileSync` → `readFile` (fs/promises) + `await`;
  make `buildConnectConfig` async; `await` its two call sites in `connect()`.

### B2. Lazy-load `ssh2` and `archiver`
- **Files:** `src/main/ssh/SessionManager.ts`, `src/main/archive/CompressService.ts`,
  `electron.vite.config.ts`.
- `import type { Client }` + `const { Client: SshClient } = await import('ssh2')` inside `connect()`.
- `const { ZipArchive } = await import('archiver')` inside compress methods.
- Add `'archiver'` to `main.build.rollupOptions.external`.

### B3. Virtualize FileList with `@tanstack/vue-virtual`
- **File:** `src/renderer/src/components/files/FileList.vue`.
- `useVirtualizer` on the scroll container; fixed `estimateSize: () => 32`, `overscan: 8`,
  `getItemKey: entry.path`; spacer sized to `getTotalSize()`; render only `getVirtualItems()`.
- Manual QA on a large dir: rename/drag mid-scroll, context menu at boundary, selection variants.

---

## Part C — Electron major-version bump (v30 → v43)

- Bump `electron` `^30.5.1` → `^43`; `electron-builder` `24.13.3` → `^26`; update `electron-vite`.
- `npx @electron/rebuild` for ssh2 native deps (`cpu-features`, `nan`) ABI.
- Review Electron breaking changes 31→43 (frameless title bar, `setWindowOpenHandler`, sandbox
  defaults, `safeStorage`). Full manual QA on a packaged build. Land last.

---

## Landing order

1. Security + small perf (A1, A2, A3, A5, B1; A6/A7 no-ops).
2. Fuses (A4) — gated on packaged smoke test.
3. Lazy-load (B2).
4. FileList virtualization (B3).
5. Electron v30→v43 bump (Part C) — last.

## Verification

- `npm run typecheck`, `npm test`.
- Manual per part (see landing order). Packaged `npm run package` launch test for A4 + Part C.
- Update `.claude/PROJECT_MAP.md` with new conventions/gotchas.

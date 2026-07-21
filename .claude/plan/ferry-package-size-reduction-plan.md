# Reduce Ferry package size (currently ~118MB installer vs. WinSCP's 12MB)

## Context

The user compared Ferry's packaged installer size (~118MB, `dist/win-unpacked` unpacked to 459MB)
against WinSCP's 12MB and flagged it as a problem. Investigation (Explore agent + direct
verification) found two separate things going on, and it's important the user understands both
before we touch anything:

1. **A large, genuinely fixed cost**: WinSCP is a native Win32 app with no bundled browser engine.
   Ferry is Electron, which bundles a full Chromium + V8 + Node runtime. `Ferry.exe` alone is
   216MB uncompressed (GPU/media DLLs, `icudtl.dat`, `dxcompiler.dll` add another ~55MB). This is
   the standard cost of every Electron app (VS Code, Slack, Discord are all 100MB+ for the same
   reason) and is **not reducible** without abandoning Electron for a native toolkit — out of scope
   here, not proposed.

2. **A real, fixable bug in packaging**: of the ~88MB `app.asar`, only ~4-5MB is code actually
   `require()`'d at runtime by the packaged main/preload process (confirmed by reading
   `out/main/index.js`'s requires — it's `ssh2`, `archiver`, `socks`, `electron-store`,
   `electron-updater`, plus their small transitive deps). Everything else in there — `@nuxt/ui`'s
   full transitive tree (tailwindcss, vite, esbuild, lightningcss, babel, rollup/rolldown, tiptap,
   framer-motion, fontless, unstorage, lib0) plus duplicate raw copies of `vue`/`pinia`/`@xterm/*`/
   `@iconify/*`/`@tanstack/vue-virtual` — is dead weight. All of those packages are renderer-only:
   electron-vite/Vite already compiles and inlines their code into the static, minified
   `out/renderer` bundle (2.8MB total). The renderer loads that static bundle inside Chromium; it
   never does `require()` on the raw npm packages. Verified directly: no file under `src/main/` or
   `src/preload/` imports `vue`, `pinia`, `@nuxt/ui`, `@xterm/*`, `@iconify/*`, or
   `@tanstack/vue-virtual`.

   The reason they end up shipped anyway: electron-builder decides what to copy into the asar by
   walking the dependency tree starting from package.json's top-level `"dependencies"` (not
   `devDependencies`), recursively including each visited package's own `"dependencies"`. Because
   Ferry's [package.json](../../package.json) currently lists `vue`, `pinia`, `@nuxt/ui`,
   `@xterm/xterm`, `@xterm/addon-fit`, `@iconify/vue`, `@iconify-json/lucide`, and
   `@tanstack/vue-virtual` as top-level `dependencies`, electron-builder walks into `@nuxt/ui`'s own
   package.json — which declares `tailwindcss`, `@tailwindcss/vite`, `vite`, etc. as **its own**
   regular dependencies (it's designed to run inside Nuxt's build pipeline, where that's normal) —
   and copies all of it into the shipped app.

The fix is to reclassify those renderer-only packages as `devDependencies` in Ferry's own
package.json. This doesn't change how the app is built (Vite/electron-vite consume dependencies
and devDependencies identically at build time) — it only changes what electron-builder considers
"production" and therefore copies into the final package. Combined with trimming unused Chromium
locale files (a supported electron-builder option, unrelated to the node_modules issue), this
should meaningfully shrink the installer without any behavior change. It will **not** get Ferry
anywhere near WinSCP's 12MB — that gap is the Electron baseline described in point 1 — but it
removes real, unintentional bloat.

## Changes

### 1. Reclassify renderer-only packages in [package.json](../../package.json)

Move these from `"dependencies"` to `"devDependencies"`:
- `vue`
- `pinia`
- `@nuxt/ui`
- `@xterm/xterm`
- `@xterm/addon-fit`
- `@iconify/vue`
- `@iconify-json/lucide`
- `@tanstack/vue-virtual`

Leave as `"dependencies"` (genuinely required at runtime by `src/main`):
- `ssh2`, `archiver`, `socks`, `electron-store`, `electron-updater`

Note: this list should be re-verified against `src/main` and `src/preload` imports at
implementation time in case new dependencies were added since this plan was written — the grep
that confirmed this (`vue|pinia|@nuxt/ui|@xterm|@iconify|@tanstack` under `src/main` and
`src/preload`) should be re-run.

### 2. Trim unused Chromium locales in [electron-builder.yml](../../electron-builder.yml)

Add `electronLanguages: ["en-US"]` (electron-builder's supported option for this exact purpose —
distinct from the node_modules/`files` mechanism, since the `locales/` directory comes from the
prebuilt Electron binary distribution, not from app node_modules). This removes ~50 of the 55
`.pak` files (~45MB uncompressed) currently in `dist/win-unpacked/locales/`. If Ferry has no
current i18n/localization feature (confirm quickly during implementation), English-only is safe.

### 3. Rebuild and measure

- `npm install --registry=https://registry.npmjs.org` (picks up the package.json reclassification;
  no actual package versions change, just where they land in the dependency graph)
- `npm run package`
- Compare new `dist/win-unpacked` size and new `Ferry-Setup-*.exe` size against the current 459MB /
  118MB baseline. Report the delta to the user.

## Verification

- `npm run typecheck` — confirms moving packages to devDependencies didn't break the TS build
  (should be unaffected; typecheck already runs in a dev context).
- `npm test` — full existing suite, confirms no runtime regression.
- `npm run package`, then launch `dist/win-unpacked/Ferry.exe` directly and smoke-test: connect to
  a site, browse a remote directory, open a terminal tab — confirms the renderer still has
  everything it needs (this is the real risk: if electron-builder's asar no longer contains these
  packages' raw source but the renderer bundle was somehow relying on runtime resolution rather
  than the compiled `out/renderer` bundle, this would surface immediately as a blank UI or console
  errors).
- Report final installer size vs. the 118MB baseline to the user, and reiterate the fixed
  Electron/Chromium cost so expectations are calibrated against WinSCP's 12MB going forward.

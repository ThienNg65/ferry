# Session Handoff — Ferry Glassmorphism & Minimalist UI Redesign

## 1. Goal We Are Working Toward
- **Project Vision**: Elevate Ferry's visual identity with an opt-in **Modern Minimalist Glassmorphism** UI mode (`glassUiEnabled`, default `false`) inspired by [Mikołaj Gałęziowski's Dribbble explorations](https://dribbble.com/galeziowski) and [Figma's *33 Modern Fonts*](https://www.figma.com/resource-library/modern-fonts/) (`Plus Jakarta Sans Variable` + `Cascadia Code / JetBrains Mono Variable`).
- **Architectural Paradigm**:
  - Neutralinojs (`WebView2`) + Vue 3.5 + Nuxt UI v4.9 + Tailwind CSS v4.0.
  - All glass styles, tokens, and typography overrides are strictly scoped to `html.ferry-glass` (`document.documentElement`) so that when `glassUiEnabled === false` (default), Ferry looks and behaves 100% identically to today's classic UI.
  - 3-Tier Glass Elevation + High-Legibility Content Wells over a static-at-rest `.ferry-ambient-canvas` backdrop.
  - Controlled by a feature switch at the top of **Settings → Appearance** (`Modern Glass UI` with an `In Development` badge) and surfaced once via a non-intrusive discovery toast after legal consent (`needsLegalConsent === false`).
- **Active Phase / Milestone**:
  - **Phase 1 (Complete):** Deep research & authoring of the 5-document Design System Suite (`DESIGN.md` + `docs/design-system/01..04`).
  - **Phase 2 (Next Session Target):** Plan and implement the Glassmorphism UI redesign in production code (`src/`, bundled `.woff2` fonts, license generator, and unit tests).

---

## 2. Current State of the Code & Environment
- **Git Commit / Branch**: `b041144` on branch `fix/log-window-readiness`
- **Working Tree**: All Phase 1 design system documents are committed (`b041144`). Zero production files in `src/` were touched in Phase 1.
- **Verification Status**:
  - Documentation Verification Scripts: `5/5` passed (`DESIGN.md` and `docs/design-system/01..04` verified and reviewed by a fresh Principal Architect subagent).
  - Production Tests / Typecheck: Not run in Phase 1 (per documentation-only phase rule; run `npm run typecheck && npm test` only after Phase 2 code implementation is complete).

---

## 3. Files Actively Edited

| File | Purpose & Specific Changes |
| :--- | :--- |
| [`DESIGN.md`](../../DESIGN.md) | Master agent entrypoint, documentation map, 10 non-negotiable architectural guardrails, and token cheat sheet. |
| [`docs/design-system/01-visual-direction.md`](../../docs/design-system/01-visual-direction.md) | Philosophy of Minimalist Glassmorphism, Mikołaj Gałęziowski case study, Light ("Frosted Quartz") vs. Dark ("Smoked Obsidian") material physics, Static Ambient Mesh Canvas, and 3-Tier hierarchy. |
| [`docs/design-system/02-styling-and-tokens.md`](../../docs/design-system/02-styling-and-tokens.md) | Exact CSS custom properties (`--ferry-glass-*`, `--ferry-caption-bg`), Nuxt UI v4 semantic overrides, Chromium `backdrop-filter` nesting rules, `@media (prefers-reduced-transparency: reduce)`, and WCAG 2.2 contrast matrix. |
| [`docs/design-system/03-typography-system.md`](../../docs/design-system/03-typography-system.md) | Figma *33 Modern Fonts* study, optical rules over blurred glass (`font-weight >= 400`, `tabular-nums`, `ss01` scoping), offline `.woff2` bundling (`PlusJakartaSans-Variable.woff2` & `JetBrainsMono-Variable.woff2`), OFL-1.1 license script integration, and `terminalAppearance.ts` (`'jetbrains-mono'`) updates. |
| [`docs/design-system/04-design-patterns-and-rollout.md`](../../docs/design-system/04-design-patterns-and-rollout.md) | Component-by-component mapping (`App.vue`, `SiteTabBar`, `SessionManagerView`, `FilePane`, `FileList`, `FileRow`, `BottomDock`, `LogTailViewer`, `TerminalView`), `ui.store.ts` state/actions, `SettingsDialog.vue` toggle, and `App.vue` one-time discovery toast. |
| [`docs/superpowers/specs/2026-11-18-glassmorphism-ui-research-design.md`](../../docs/superpowers/specs/2026-11-18-glassmorphism-ui-research-design.md) | Approved Phase 1 design specification and builder calls. |
| [`docs/superpowers/plans/2026-11-18-glassmorphism-ui-research.md`](../../docs/superpowers/plans/2026-11-18-glassmorphism-ui-research.md) | Phase 1 documentation implementation plan. |

---

## 4. Changes Made
- **Design System Architecture**: Created the root `DESIGN.md` index and `docs/design-system/01..04` suite covering visual philosophy, CSS token recipes, typography, component patterns, and rollout mechanics.
- **Zero Production Code Diff**: Kept `src/`, `package.json`, and `neutralino.config.json` completely untouched in Phase 1 as requested.

---

## 5. Everything Tried That Failed / Pitfalls Caught in Review (Critical for Phase 2)

1. **Nested `backdrop-filter` inside `SiteTabBar.vue`, `PathBreadcrumb.vue`, and `LogTailViewer.vue`**:
   - *Symptom & Root Cause*: In Chromium/WebView2, any parent with `backdrop-filter` establishes a Backdrop Root that breaks child `backdrop-filter` sampling and multiplies GPU compositing cost. Furthermore, `PathBreadcrumb.vue:182` and virtualized rows in `LogTailViewer.vue:959` (`backdrop-blur-xs`) and `1036` (`backdrop-blur-md`) already have inner blur classes.
   - *Resolution*: Active `.ferry-site-tab` inside `<header class="ferry-glass-chrome">` must **not** apply `.ferry-glass-card` (use `bg-default` + inset top highlight shadow only, preserving `border-t-2` environment borders). Strip `backdrop-blur-xs` from `PathBreadcrumb.vue:182` and `LogTailViewer.vue:959,1036`.
2. **Global `[data-reka-popper-content-wrapper] > *` Catching `UTooltip` and Missing `UToast`**:
   - *Symptom & Root Cause*: In `@nuxt/ui` v4.9 / `reka-ui`, `UTooltip` renders inside `[data-reka-popper-content-wrapper]`, whereas `UToast` (`ToastRoot`) does not.
   - *Resolution*: Scope the Tier 3 overlay selector in `main.css` to exclude `[role="tooltip"]` (`[data-reka-popper-content-wrapper] > :not([role="tooltip"]):not(:has([role="tooltip"]))`) and explicitly include `[data-slot="viewport"] > li` for `UToaster` items.
3. **`toast.add` Close Handler (`'onUpdate:open'` vs. `onOpenChange`) and Auto-Timeout**:
   - *Symptom & Root Cause*: `@nuxt/ui` v4.9's `ToastRoot` emits `'onUpdate:open'`, not `onOpenChange`. Also, setting a 10–12s auto-timeout when `'onUpdate:open'` calls `ui.dismissGlassUiPromo()` would permanently dismiss the promo if the user wasn't looking at the screen during startup.
   - *Resolution*: Use `'onUpdate:open': (open: boolean) => { if (!open) ui.dismissGlassUiPromo() }` with `duration: 0` (matching `App.vue:250` and `useNotify.ts:34`).
4. **Windows 11 DWM Caption Sync Ordering & `ColorPicker` Drag Spam**:
   - *Symptom & Root Cause*: `App.vue:92-93` currently calls `ui.initTheme()` *before* `ui.initAccentColor()`, and `windowsWindow.ts:125` spawns `powershell.exe` on every `window:syncTheme` call.
   - *Resolution*: Call `ui.initGlassUi()` and `ui.initAccentColor()` *before* `ui.initTheme()` in `App.vue`. In `ui.store.ts`, read `--ferry-caption-bg` (100% opaque `alpha === 255`) when `.ferry-glass` is active, and in `setAccentColor(hex)` only re-invoke `applyTheme()` when `this.glassUiEnabled` is `true` (debounced by 250ms).
5. **Terminal WebGL (`allowTransparency: false`) & `'jetbrains-mono'` Font ID**:
   - *Symptom & Root Cause*: `@xterm/addon-webgl` in `terminalStreams.store.ts` does not enable transparency, and `terminalAppearance.test.ts` asserts 6-digit opaque hexes. Also, `terminalAppearance.ts:144` uses ID `'jetbrains-mono'` (not `'jetbrains'`), and `TerminalAppearanceSettings.vue:42` filters fonts via `isFontInstalled()` (which only checks OS-installed fonts on a 2D canvas).
   - *Resolution*: Use 100% opaque `#0b0f19` / `#f8fafc` for the default `Ferry` terminal scheme under `.ferry-glass`, call `terminalStreams.applyAppearance()` when `glassUiEnabled` toggles, and mark `'jetbrains-mono'` as a bundled built-in font in `TerminalAppearanceSettings.vue`.

---

## 6. Next Steps (Actionable Roadmap for Phase 2 Implementation Planning)

1. **Bundle Variable Fonts & Update License Script**:
   - Add `PlusJakartaSans-Variable.woff2` and `JetBrainsMono-Variable.woff2` under `src/renderer/src/assets/fonts/`.
   - Update `scripts/generate-third-party-licenses.mjs` (including line 130's font disclaimer) and regenerate `THIRD_PARTY_LICENSES.txt` with SIL OFL-1.1 notices.
   - Update `src/renderer/src/utils/terminalAppearance.ts` and `TerminalAppearanceSettings.vue` so `'jetbrains-mono'` uses the bundled variable font without requiring OS installation.
2. **Implement Glass CSS Tokens & `.ferry-glass` Rules in `src/renderer/src/assets/main.css`**:
   - Add `@font-face` declarations, `html.ferry-glass` / `html.dark.ferry-glass` tokens (`--ferry-caption-bg`, `--ferry-ambient-mesh`, `--ferry-glass-*`, `--ui-bg*`), utility classes (`.ferry-ambient-canvas`, `.ferry-glass-chrome`, `.ferry-glass-card`, `.ferry-glass-well`, `.ferry-glass-overlay`), and `@media (prefers-reduced-transparency: reduce)` fallbacks (including resetting `--ferry-surface-subtle` and neutralizing `--ferry-caption-bg`).
3. **Implement `ui.store.ts` State, DWM Caption Sync & Reset Handling**:
   - Add `glassUiEnabled` (`'ferry:ui:glassUi'`, default `false`) and `glassUiPromoDismissed` (`'ferry:ui:glassUiPromoDismissed'`, default `false`), `initGlassUi()`, `setGlassUiEnabled()`, `dismissGlassUiPromo()`, `--ferry-caption-bg` lookup in `resolveCaptionColorRef()`, debounced `applyTheme()` in `setAccentColor()`, and ensure `deleteAllLocalData()` in `settings.store.ts` resets the class.
4. **Update Shell, Session Manager, File Panes, Dock, Settings & Discovery Toast**:
   - `App.vue`: Init order (`initGlassUi` + `initAccentColor` before `initTheme`), `.ferry-ambient-canvas` layer, `bg-transparent` root flex wrapper, and the gated one-time discovery toast (`'onUpdate:open'`, `duration: 0`). Include `i-lucide-sparkles` in `src/renderer/src/startupIcons.ts`.
   - `SettingsRow.vue` & `SettingsDialog.vue`: Add optional `#label` slot (or `badge` prop) to `SettingsRow.vue` and add the **Modern Glass UI** (`In Development`) switch at the top of the Appearance tab.
   - Apply tier classes across `SiteTabBar.vue`, `SessionManagerView.vue`, `SiteDetailsPanel.vue`, `FileToolbar.vue`, `PathBreadcrumb.vue` (removing inner `backdrop-blur-xs`), `FileList.vue`, `BottomDock.vue`, and `LogTailViewer.vue` (removing per-row `backdrop-blur-xs`), plus `.tabular-nums` on `TransferItem.vue`, `HistoryDialog.vue`, and `FilePane.vue`.
5. **Verify with Unit Tests & Typecheck**:
   - Add unit tests for `ui.store.ts` (`glassUiEnabled`, `glassUiPromoDismissed`, `.ferry-glass` toggling, `--ferry-caption-bg`), `SettingsDialog.vue` toggle, and `App.vue` discovery toast gating.
   - Run `npm run typecheck && npm test` once implementation is complete.

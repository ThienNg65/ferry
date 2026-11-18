# Glassmorphism & Minimalist UI Redesign Research & Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author a comprehensive, agent-navigable Design System Documentation Suite (`DESIGN.md` + `docs/design-system/01..04`) defining Ferry's Minimalist Glassmorphism visual direction (Mikołaj Gałęziowski Dribbble study), CSS token recipes, typography (`Plus Jakarta Sans` + `Cascadia Code / JetBrains Mono`), component design patterns, and the Settings feature switch (`In Development`, `default: false`) with one-time user discovery notification.

**Architecture:** Five cohesive Markdown documents anchored by a root `DESIGN.md` index that links into four domain-specific specifications under `docs/design-system/`. Every document is grounded in Ferry's actual runtime stack (Neutralinojs WebView2, Vue 3.5, Nuxt UI v4.9, Tailwind CSS v4.0, `ui.store.ts`, and `windowsWindow.ts` DWM caption syncing) and strictly enforces zero regression when `glassUiEnabled` is `false`.

**Tech Stack:** Markdown (GitHub Flavored Markdown + Mermaid diagrams), CSS Custom Properties (`oklch`, `color-mix`, `backdrop-filter`), Tailwind CSS v4 (`@theme`), Nuxt UI v4, Vue 3 / Pinia (`ui.store.ts`).

**Spec:** `docs/superpowers/specs/2026-11-18-glassmorphism-ui-research-design.md`

## Global Constraints

- **No Production Code Changes in Phase 1:** This plan creates only documentation files (`DESIGN.md` and `docs/design-system/*.md`). No changes to `src/`, `package.json`, or `neutralino.config.json` happen in this phase.
- **Root Scoping via `.ferry-glass`:** When `glassUiEnabled` is `false` (default), Ferry must render 100% identically to today's classic UI. All glass tokens and font overrides activate exclusively under `html.ferry-glass` (`document.documentElement`).
- **Static Ambient Mesh Backdrop at Rest:** The ambient mesh gradient behind `#app` must be static at rest (updating only on `theme` or `accentColor` transitions) with zero continuous `@keyframes` drift loops behind `backdrop-filter` surfaces.
- **3-Tier Elevation + Content Wells:** Tier 1 (`--ferry-glass-chrome`), Tier 2 (`--ferry-glass-card` at `0.65–0.78` alpha for Session Manager cards; `--ferry-glass-well` at `0.82–0.92` alpha for connected data views), and Tier 3 (`--ferry-glass-overlay` at `blur(24px) saturate(180%)`).
- **Typography & Offline Bundling:** Primary UI font is `'Plus Jakarta Sans Variable'` (`PlusJakartaSans-Variable.woff2`) and Monospace is `'Cascadia Code', 'JetBrains Mono Variable'` (`JetBrainsMono-Variable.woff2`), bundled locally under `src/renderer/src/assets/fonts/` with OFL-1.1 license attribution in `scripts/generate-third-party-licenses.mjs`. Minimum weight on glass is `400` (`500`/`600` for UI labels), and `font-variant-numeric: tabular-nums` is mandatory on numeric columns.
- **Feature Switch & Discovery Toast:** `glassUiEnabled` (`'ferry:ui:glassUi'`, default `false`) and `glassUiPromoDismissed` (`'ferry:ui:glassUiPromoDismissed'`, default `false`) in `ui.store.ts`; top row in `SettingsDialog.vue` Appearance tab with `<UBadge color="primary" variant="subtle" size="xs">In Development</UBadge>`; one-time `useToast()` notification in `App.vue` after legal consent with `"Try Glass UI"` and `"Dismiss"` actions.

## Review Focus

1. **Nested `backdrop-filter` Compositor Trap in Chromium/WebView2:** In Chromium, a parent element with `backdrop-filter` (or `opacity < 1` / `transform`) creates a backdrop root that breaks child `backdrop-filter` sampling. `02-styling-and-tokens.md` and `04-design-patterns-and-rollout.md` must explicitly document the flat-sibling backdrop rule (never nest a `backdrop-filter` child inside a `backdrop-filter` parent).
2. **Windows 11 DWM Caption Alpha Rejection (`resolveCaptionColorRef`):** `ui.store.ts`'s `resolveCaptionColorRef()` rejects any CSS color where `alpha !== 255` and falls back to `#262626`/`#fafafa`. `02-styling-and-tokens.md` and `04-design-patterns-and-rollout.md` must specify the 100% opaque `--ferry-caption-bg` token and the exact `watch` / action triggers in `ui.store.ts` (`setGlassUiEnabled`, `setAccentColor`, `toggleTheme`).
3. **Legal Consent Gate vs. Discovery Toast Timing:** If the `"Try Glass UI"` toast fires while `LegalConsentDialog` (`needsLegalConsent === true`) is open on first launch, it obscures or distracts from mandatory legal acceptance. `04-design-patterns-and-rollout.md` must specify gating the toast behind `settingsStore.loaded && !needsLegalConsent.value`.
4. **Terminal (`xterm.js` WebGL) & Virtualized Row Performance:** Applying `backdrop-filter` to `.xterm` or virtualized rows (`FileRow.vue`, `TransferQueue.vue`) causes severe frame drops or conflicts with `@xterm/addon-webgl`. `04-design-patterns-and-rollout.md` must document the exact exclusion rules and how the default `Ferry` terminal theme adapts cleanly.
5. **OS `prefers-reduced-transparency: reduce` & Contrast Floor:** Users with visual sensitivities or OS reduced-transparency enabled must receive opaque (`>= 0.96` alpha, `backdrop-filter: none`) fallbacks automatically without toggling off the typography or layout improvements.

---

### Task 1: Deep Research & Visual Direction Document (`docs/design-system/01-visual-direction.md`)

**Files:**
- Create: `docs/design-system/01-visual-direction.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-11-18-glassmorphism-ui-research-design.md`, `docs/motion-system.md`
- Produces: Canonical visual philosophy, Mikołaj Gałęziowski case study breakdown, 3-Tier Glass + Content Well material hierarchy, and Static Ambient Mesh Canvas specification referenced by Tasks 2–5.

- [ ] **Step 1: Author `docs/design-system/01-visual-direction.md`**

Include the following required sections and exact technical content:
1. **Executive Vision: Minimalist Glassmorphism for a Developer Utility** — How to merge atmospheric translucency with minimalist restraint so an SFTP/SSH workspace feels weightless yet surgical.
2. **Case Study: Mikołaj Gałęziowski (`dribbble.com/galeziowski`)** — Deep architectural analysis of his *Glassmorphism Big Sur Creative Cloud* (Dark & Light) and *Big Sur Messenger* concepts:
   - **Multi-layered Frosted Planes:** Separation of sidebar/chrome (`blur(16px)`), content canvas (`blur(12px)`), and floating popovers (`blur(24px)`).
   - **1px Specular Edge Refraction:** Why glass looks flat without a 1px translucent border + top-inner highlight (`inset 0 1px 0 rgba(255,255,255,0.25)`).
   - **Vibrant yet Diffused Sub-Surface Backdrops:** Using soft, out-of-focus radial color orbs behind glass so translucency has chromatic variation to refract without high-frequency edges.
   - **Soft Ambient Elevation Shadows:** Replacing harsh dark drop-shadows with wide, low-opacity ambient shadows (`0 12px 32px -4px rgba(0,0,0,0.28)`).
3. **Material Physics: Light Mode ("Frosted Quartz") vs. Dark Mode ("Smoked Obsidian")** — Comparison table contrasting background base, glass tint, border luminance, saturation boost (`saturate(160%–180%)`), and shadow opacity across Light and Dark themes.
4. **The Static Ambient Mesh Canvas Architecture** — Mermaid diagram and specification of the `.ferry-ambient-canvas` layer behind `#app`:
   - Anchored dynamically to `var(--ui-color-primary-500)` (primary orb top-left), a cool secondary orb (bottom-right), and a subtle neutral-warm balance orb.
   - **Strictly static at rest** (zero `@keyframes` loops) to guarantee 0% idle GPU overhead in WebView2; transitions smoothly only when `theme` or `accentColor` changes.
5. **The 3-Tier Glass + Content Well Hierarchy** — Mermaid diagram mapping Tier 1 (App Chrome), Tier 2A (Session Manager Frosted Cards), Tier 2B (Connected High-Legibility Content Wells at `0.82–0.92` alpha), and Tier 3 (Floating Overlays).

- [ ] **Step 2: Verify `01-visual-direction.md` completeness and links**

Run: `node -e "const fs = require('fs'); const s = fs.readFileSync('docs/design-system/01-visual-direction.md', 'utf8'); for (const term of ['Gałęziowski', 'Frosted Quartz', 'Smoked Obsidian', 'ferry-ambient-canvas', 'Tier 1', 'Tier 2', 'Tier 3', 'mermaid']) { if (!s.includes(term)) throw new Error('Missing: ' + term); } console.log('01-visual-direction.md verified');"`
Expected: `01-visual-direction.md verified`

- [ ] **Step 3: Commit Task 1**

```bash
git add docs/design-system/01-visual-direction.md
git commit -m "docs(design): add visual direction and Gałęziowski glassmorphism study"
```

---

### Task 2: Styling, CSS Tokens & Theme Recipes Document (`docs/design-system/02-styling-and-tokens.md`)

**Files:**
- Create: `docs/design-system/02-styling-and-tokens.md`

**Interfaces:**
- Consumes: `docs/design-system/01-visual-direction.md`, `src/renderer/src/assets/main.css`, `src/renderer/src/stores/ui.store.ts`
- Produces: Exact CSS custom property definitions (`--ferry-glass-*`, `--ferry-caption-bg`), Light/Dark `oklch()`/`color-mix()` recipes, Chromium `backdrop-filter` nesting rules, and `@media (prefers-reduced-transparency: reduce)` fallback block.

- [ ] **Step 1: Author `docs/design-system/02-styling-and-tokens.md`**

Include the following required sections and exact CSS specifications:
1. **Activation & Scoping Architecture (`html.ferry-glass`)** — How `html.ferry-glass` and `html.dark.ferry-glass` scope every visual change in `src/renderer/src/assets/main.css` so `glassUiEnabled = false` has zero visual diff from today's UI.
2. **Complete Token Reference Table & CSS Block** — Exact copy-pasteable CSS custom properties for Light (`html.ferry-glass`) and Dark (`html.dark.ferry-glass`):
   - `--ferry-caption-bg`: `100%` opaque color (`alpha === 255`) mixed from `--ui-color-primary-500` (6% in Light, 8% in Dark) and the base background (`#f8fafc` in Light, `#0b0f19` in Dark) for `resolveCaptionColorRef()` in `ui.store.ts`.
   - `--ferry-ambient-mesh`: Multi-layer `radial-gradient(...)` using `color-mix(in oklab, var(--ui-color-primary-500) ..., transparent)` over base canvas.
   - `--ferry-glass-chrome-bg`, `--ferry-glass-chrome-blur` (`blur(16px) saturate(160%)`), `--ferry-glass-chrome-border`.
   - `--ferry-glass-card-bg` (`0.72` Light / `0.64` Dark), `--ferry-glass-card-blur` (`blur(16px) saturate(170%)`), `--ferry-glass-card-border`, `--ferry-glass-card-highlight` (`inset 0 1px 0 0 rgba(255, 255, 255, ...)`), `--ferry-glass-card-shadow`.
   - `--ferry-glass-well-bg` (`0.88` Light / `0.84` Dark) for dense connected `FileList`, `LogTailViewer`, and `MonitorPanel` viewports.
   - `--ferry-glass-overlay-bg` (`0.78` Light / `0.72` Dark), `--ferry-glass-overlay-blur` (`blur(24px) saturate(180%)`), `--ferry-glass-overlay-shadow`.
3. **Nuxt UI v4 Semantic Variable Overrides** — How `--ui-bg`, `--ui-bg-muted`, `--ui-bg-elevated`, and `--ui-border` map cleanly under `html.ferry-glass` without breaking Nuxt UI component internals.
4. **The Chromium / WebView2 `backdrop-filter` Nesting Rule (Review Focus #1)** — Diagram and CSS pattern explaining why a parent with `backdrop-filter` creates a backdrop root that prevents child `backdrop-filter` elements from blurring the ambient canvas, and how to structure sibling/portal glass layers instead.
5. **Accessibility Fallbacks (`prefers-reduced-transparency` & WCAG 2.2 AA Contrast Matrix)** — Exact `@media (prefers-reduced-transparency: reduce)` CSS block (setting `--ferry-glass-*-bg` to `0.97` opaque and `backdrop-filter: none`) plus a verified contrast ratio table for `--ui-text-highlighted`, `--ui-text-default`, and `--ui-text-muted` over every glass tier.

- [ ] **Step 2: Verify `02-styling-and-tokens.md` tokens and Review Focus coverage**

Run: `node -e "const fs = require('fs'); const s = fs.readFileSync('docs/design-system/02-styling-and-tokens.md', 'utf8'); for (const term of ['--ferry-caption-bg', '--ferry-glass-chrome-bg', '--ferry-glass-card-bg', '--ferry-glass-well-bg', '--ferry-glass-overlay-bg', 'prefers-reduced-transparency', 'backdrop-filter']) { if (!s.includes(term)) throw new Error('Missing: ' + term); } console.log('02-styling-and-tokens.md verified');"`
Expected: `02-styling-and-tokens.md verified`

- [ ] **Step 3: Commit Task 2**

```bash
git add docs/design-system/02-styling-and-tokens.md
git commit -m "docs(design): add glassmorphism CSS tokens and Light/Dark recipes"
```

---

### Task 3: Modern Typography System Document (`docs/design-system/03-typography-system.md`)

**Files:**
- Create: `docs/design-system/03-typography-system.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-11-18-glassmorphism-ui-research-design.md`, `src/renderer/src/assets/main.css`, `src/renderer/src/utils/terminalAppearance.ts`, `scripts/generate-third-party-licenses.mjs`
- Produces: Typography specification for `Plus Jakarta Sans Variable` + `Cascadia Code / JetBrains Mono Variable`, optical rules over blurred glass, type scale table, and offline `.woff2` bundling & license attribution blueprint.

- [ ] **Step 1: Author `docs/design-system/03-typography-system.md`**

Include the following required sections and exact specifications:
1. **Figma "33 Modern Fonts" Research & Selection Rationale** — Evaluation of top modern candidates from Figma's resource library (*Plus Jakarta Sans*, *Instrument Sans*, *Instrument Serif*, *Rethink Sans*, *Manrope*, *Inter*, *Space Mono*, *Xanh Mono*) and why **Plus Jakarta Sans** (UI/Display) + **Cascadia Code / JetBrains Mono** (Monospace) is the optimal pairing for Ferry's minimalist glassmorphism direction.
2. **Optical Physics of Type on Translucent Surfaces** — Why sub-pixel background blur requires open apertures, tall x-height, minimum font-weight `400` (`500` Medium for interactive controls/tabs, `600` SemiBold for headers), slight negative tracking (`-0.015em`) on headings, and strict `font-variant-numeric: tabular-nums` on SFTP file sizes, permissions, speeds, and timestamps.
3. **Type Scale & Token Mapping (`main.css`)** — Complete scale table (`--text-3xs` `10px` through `h1` `18px`), line heights, weights, and exact `@font-face` + `html.ferry-glass` `--font-sans` and `--font-mono` overrides:
   - `--font-sans`: `'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', -apple-system, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif`
   - `--font-mono`: `'Cascadia Code', 'JetBrains Mono Variable', 'JetBrains Mono', 'SF Mono', Consolas, monospace`
4. **Offline Local `.woff2` Asset Bundling & License Compliance** — Exact file paths (`src/renderer/src/assets/fonts/PlusJakartaSans-Variable.woff2` and `JetBrainsMono-Variable.woff2`), `font-display: block` (or `swap` with metric-compatible fallback), and how `scripts/generate-third-party-licenses.mjs` must include SIL Open Font License 1.1 notices for both bundled font families.
5. **Terminal Appearance Integration (`terminalAppearance.ts`)** — How bundling `JetBrains Mono Variable` guarantees that the `'jetbrains'` font option in `TerminalAppearanceSettings.vue` works out-of-the-box on every Windows machine without requiring manual OS font installation.

- [ ] **Step 2: Verify `03-typography-system.md` completeness**

Run: `node -e "const fs = require('fs'); const s = fs.readFileSync('docs/design-system/03-typography-system.md', 'utf8'); for (const term of ['Plus Jakarta Sans', 'JetBrains Mono', 'Cascadia Code', 'tabular-nums', 'PlusJakartaSans-Variable.woff2', 'generate-third-party-licenses.mjs', 'OFL']) { if (!s.includes(term)) throw new Error('Missing: ' + term); } console.log('03-typography-system.md verified');"`
Expected: `03-typography-system.md verified`

- [ ] **Step 3: Commit Task 3**

```bash
git add docs/design-system/03-typography-system.md
git commit -m "docs(design): add modern typography system spec with Plus Jakarta Sans and JetBrains Mono"
```

---

### Task 4: Component Design Patterns, Feature Switch & Notification Blueprint (`docs/design-system/04-design-patterns-and-rollout.md`)

**Files:**
- Create: `docs/design-system/04-design-patterns-and-rollout.md`

**Interfaces:**
- Consumes: `docs/design-system/01-visual-direction.md`, `docs/design-system/02-styling-and-tokens.md`, `docs/design-system/03-typography-system.md`, `src/renderer/src/App.vue`, `src/renderer/src/stores/ui.store.ts`, `src/renderer/src/components/shell/SettingsDialog.vue`, `src/renderer/src/components/shell/SiteTabBar.vue`, `src/renderer/src/components/sessions/SessionManagerView.vue`, `src/renderer/src/components/files/FilePane.vue`, `src/renderer/src/components/shell/BottomDock.vue`
- Produces: Component-by-component glass styling blueprint, performance/a11y guardrails, and exact implementation spec for the Settings Feature Switch (`In Development`, `default: false`) and One-Time Discovery Toast.

- [ ] **Step 1: Author `docs/design-system/04-design-patterns-and-rollout.md`**

Include the following required sections and exact specifications:
1. **Component-by-Component Glass Pattern Catalog:**
   - **App Shell & Ambient Backdrop (`App.vue`):** Inserting `<div v-if="ui.glassUiEnabled" class="ferry-ambient-canvas" aria-hidden="true" />` behind the root flex column and switching the root wrapper from opaque `bg-default` to transparent when `ui.glassUiEnabled` is true.
   - **Top Chrome (`SiteTabBar.vue`) & Win11 Titlebar Sync:** Tier 1 glass header (`ferry-glass-chrome`), active tab pill with 1px top specular highlight, and `resolveCaptionColorRef()` reading `--ferry-caption-bg` so the Win11 native caption bar matches seamlessly.
   - **Session Manager (`SessionManagerView.vue`, `SiteRow.vue`, `SiteDetailsPanel.vue`):** Tier 2A Gałęziowski frosted cards (`ferry-glass-card`) floating over the exposed ambient mesh canvas; translucent search input and hover states on `SiteRow`.
   - **Connected Dual-Pane Workspace (`FilePane.vue`, `FileToolbar.vue`, `PathBreadcrumb.vue`, `FileList.vue`, `FileRow.vue`):** Tier 1 glass toolbars/breadcrumbs framing Tier 2B high-legibility content wells (`ferry-glass-well`); zero `backdrop-filter` on `FileRow.vue` virtualized items; translucent pill selection highlights (`bg-primary/15 ring-1 ring-primary/30`).
   - **Bottom / Right Dock (`BottomDock.vue`, `TransferQueue.vue`, `LogTailViewer.vue`, `TerminalView.vue`, `MonitorPanel.vue`):** Tier 1 dock tab bar, Tier 2B content wells for Transfers/Logs/Monitor, and preserving `TerminalView`'s WebGL canvas (with subtle `0.90` glass-well background on the default `Ferry` terminal theme only).
   - **Floating Overlays (`SettingsDialog.vue`, `CommandPalette.vue`, `HistoryDialog.vue`, `FileVisibilityPopover.vue`, `ContextMenu`, Toasts):** Tier 3 refractive glass (`ferry-glass-overlay`) with 1px specular border and soft modal backdrop (`bg-black/35 backdrop-blur-xs`).
2. **Settings Feature Switch Architecture (`ui.store.ts` & `SettingsDialog.vue`):**
   - Exact state keys (`GLASS_UI_KEY = 'ferry:ui:glassUi'`, `GLASS_PROMO_DISMISSED_KEY = 'ferry:ui:glassUiPromoDismissed'`), defaults (`false`), and actions (`initGlassUi()`, `setGlassUiEnabled(enabled: boolean)`, `dismissGlassUiPromo()`) in `ui.store.ts`.
   - Re-invoking `applyTheme(this.theme)` inside `setGlassUiEnabled` and `setAccentColor` so the Windows 11 native titlebar updates live.
   - Exact Vue template snippet for `SettingsDialog.vue` (top of the `Appearance` tab): a highlighted card/row titled **"Modern Glass UI"** with `<UBadge color="primary" variant="subtle" size="xs">In Development</UBadge>`, description *"Translucent frosted-glass surfaces, ambient mesh backdrop, and Plus Jakarta Sans typography."*, and a `<USwitch>` bound to `ui.glassUiEnabled`.
3. **One-Time User Discovery Notification (`App.vue`):**
   - Exact lifecycle & gating logic (Review Focus #3): Watch `[() => settingsStore.loaded, needsLegalConsent]` so the promo toast only triggers once `settingsStore.loaded === true && !needsLegalConsent.value && !ui.glassUiEnabled && !ui.glassUiPromoDismissed`.
   - Exact `toast.add({...})` payload with title `"New: Modern Glass UI (Preview)"`, description `"Experience Ferry's new minimalist translucent interface. Available now for testing in Settings → Appearance."`, icon `'i-lucide-sparkles'`, and actions `"Try Glass UI"` (enables `ui.setGlassUiEnabled(true)` + `ui.dismissGlassUiPromo()`) and `"Dismiss"` (calls `ui.dismissGlassUiPromo()`).
4. **Performance, Motion & Accessibility Guardrails Checklist:**
   - Virtualized lists (`FileList`, `TransferQueue`), `xterm.js` lifecycle (`v-show` preservation, never unmounting `TerminalView`), GPU layer promotion rules, `prefers-reduced-motion`, and `prefers-reduced-transparency`.

- [ ] **Step 2: Verify `04-design-patterns-and-rollout.md` completeness**

Run: `node -e "const fs = require('fs'); const s = fs.readFileSync('docs/design-system/04-design-patterns-and-rollout.md', 'utf8'); for (const term of ['ferry:ui:glassUi', 'ferry:ui:glassUiPromoDismissed', 'In Development', 'needsLegalConsent', 'Try Glass UI', 'TerminalView', 'FileRow']) { if (!s.includes(term)) throw new Error('Missing: ' + term); } console.log('04-design-patterns-and-rollout.md verified');"`
Expected: `04-design-patterns-and-rollout.md verified`

- [ ] **Step 3: Commit Task 4**

```bash
git add docs/design-system/04-design-patterns-and-rollout.md
git commit -m "docs(design): add component patterns, feature switch, and discovery toast spec"
```

---

### Task 5: Master Agent Entrypoint (`DESIGN.md`)

**Files:**
- Create: `DESIGN.md`

**Interfaces:**
- Consumes: `docs/design-system/01-visual-direction.md`, `docs/design-system/02-styling-and-tokens.md`, `docs/design-system/03-typography-system.md`, `docs/design-system/04-design-patterns-and-rollout.md`, `docs/motion-system.md`, `docs/superpowers/specs/2026-11-18-glassmorphism-ui-research-design.md`
- Produces: Root `DESIGN.md` index at repository root so any agent or developer immediately understands Ferry's dual-mode visual system (Classic vs. Modern Glass UI) and knows which sub-document to read for each task.

- [ ] **Step 1: Author `DESIGN.md` at repository root**

Include the following required sections:
1. **Overview & Design North Star** — Concise summary of Ferry's visual identity, the **Modern Minimalist Glassmorphism** redesign (Mikołaj Gałęziowski Dribbble reference + Figma *33 Modern Fonts* typography), and how it coexists safely behind the `glassUiEnabled` (`html.ferry-glass`, default `false`) feature switch.
2. **Documentation Map for Agents (When to Read Which Doc)** — Markdown table linking directly to:
   - [01-visual-direction.md](docs/design-system/01-visual-direction.md)
   - [02-styling-and-tokens.md](docs/design-system/02-styling-and-tokens.md)
   - [03-typography-system.md](docs/design-system/03-typography-system.md)
   - [04-design-patterns-and-rollout.md](docs/design-system/04-design-patterns-and-rollout.md)
   - [motion-system.md](docs/motion-system.md)
   - [2026-11-18-glassmorphism-ui-research-design.md](docs/superpowers/specs/2026-11-18-glassmorphism-ui-research-design.md)
3. **Golden Rules & Non-Negotiable Guardrails for Agents** — 10-point quick-reference checklist (`.ferry-glass` scoping, 3-Tier hierarchy, no nested `backdrop-filter`, zero per-row blur on virtualized lists, `TerminalView` never unmounts, `--ferry-caption-bg` opaque Win11 titlebar sync, `Plus Jakarta Sans` + `Cascadia Code / JetBrains Mono` with `tabular-nums`, `prefers-reduced-transparency` & `prefers-reduced-motion`, and WCAG 2.2 AA contrast floor).
4. **Quick Token & Class Cheat Sheet** — Summary table of the core CSS variables and utility classes so agents can verify token names at a glance.

- [ ] **Step 2: Verify `DESIGN.md` links and structure**

Run: `node -e "const fs = require('fs'); const s = fs.readFileSync('DESIGN.md', 'utf8'); for (const p of ['docs/design-system/01-visual-direction.md', 'docs/design-system/02-styling-and-tokens.md', 'docs/design-system/03-typography-system.md', 'docs/design-system/04-design-patterns-and-rollout.md', 'docs/motion-system.md']) { if (!s.includes(p)) throw new Error('Missing link: ' + p); if (!fs.existsSync(p)) throw new Error('Target file missing: ' + p); } console.log('DESIGN.md verified');"`
Expected: `DESIGN.md verified`

- [ ] **Step 3: Commit Task 5**

```bash
git add DESIGN.md
git commit -m "docs(design): add root DESIGN.md agent entrypoint and design system index"
```

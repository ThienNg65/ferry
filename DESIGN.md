# Ferry Design System & UI Architecture (`DESIGN.md`)

> **Master Entrypoint for AI Agents & Engineers:** Read this file before modifying any Vue component, CSS token, typography rule, or appearance setting in Ferry. It indexes the complete **Modern Minimalist Glassmorphism** design system and establishes non-negotiable architectural guardrails.

---

## 1. Overview & Design North Star

Ferry is a lightweight, high-precision SFTP, SSH, and live remote log-tailing desktop client built on **Neutralinojs (`WebView2`)**, **Vue 3.5**, **Nuxt UI v4.9**, and **Tailwind CSS v4.0**.

Ferry supports a dual-mode visual architecture controlled by a live user preference (`ui.glassUiEnabled` in [`src/renderer/src/stores/ui.store.ts`](src/renderer/src/stores/ui.store.ts)):
1. **Classic UI Mode (`glassUiEnabled: false`, Default):**
   - Solid opaque surfaces, system UI font stack (`Segoe UI Variable`), and 1px solid borders.
2. **Modern Glass UI Mode (`glassUiEnabled: true`, `html.ferry-glass` — *In Development Preview*):**
   - **Visual Philosophy:** Minimalist Glassmorphism inspired by [Mikołaj Gałęziowski's Dribbble explorations](https://dribbble.com/galeziowski)—combining multi-layered frosted glass (`backdrop-filter: blur() saturate()`), `1px` specular edge highlights, soft ambient shadows, and a static, accent-reactive **Ambient Mesh Canvas** (`.ferry-ambient-canvas`) with high-legibility **Content Wells** (`0.82–0.92` alpha) for dense data views.
   - **Motion & Interaction Philosophy:** Adapted from **[Arc UI (`uiarc.dev`)](https://uiarc.dev/docs/introduction)** for Ferry's Vue 3.5, Nuxt UI v4.9, and Glassmorphism architecture without altering our frosted-glass visual identity—establishing **cause-and-effect motion physics, critically damped spring transitions (`bounce: 0` on state), faster exits (`140ms`), concentric surface geometry, container-first responsive slots (`@container` / `ResizeObserver`), and pointer/keyboard modality discipline**.
   - **Typography:** **Plus Jakarta Sans Variable** (UI & Display) paired with **Cascadia Code / JetBrains Mono Variable** (Monospace), selected from [Figma's *33 Modern Fonts To Elevate Your Designs*](https://www.figma.com/resource-library/modern-fonts/) and bundled locally for 100% offline reliability.

---

## 2. Documentation Map for Agents (When to Read Which Document)

Always load the specific sub-document that matches your task rather than guessing token names or component patterns:

| Document | Scope & Contents | Read This When... |
| :--- | :--- | :--- |
| **[01 — Visual Direction & Philosophy](docs/design-system/01-visual-direction.md)** | Minimalist Glassmorphism philosophy, Mikołaj Gałęziowski case study, Light ("Frosted Quartz") vs. Dark ("Smoked Obsidian") physics, Static Ambient Mesh Canvas, 3-Tier Glass + Content Well hierarchy, and Arc UI complementary surface/restraint synthesis. | Designing new views, choosing surface elevation tiers, balancing shadows/accents, or adjusting Light/Dark visual balance. |
| **[02 — Styling, CSS Tokens & Recipes](docs/design-system/02-styling-and-tokens.md)** | Canonical CSS custom properties (`--ferry-glass-*`, `--ferry-caption-bg`, `--ferry-motion-*`), critically damped `linear()` spring curve, concentric corner radius scale, popup-anchor press & pointer-fine hover guards, Nuxt UI v4 portal overrides, Chromium `backdrop-filter` nesting rules, and `@media (prefers-reduced-transparency: reduce)` fallbacks. | Editing `src/renderer/src/assets/main.css`, writing glass CSS classes, tuning motion/focus tokens, or verifying WCAG 2.2 AA/AAA contrast. |
| **[03 — Modern Typography System](docs/design-system/03-typography-system.md)** | Figma *33 Modern Fonts* evaluation, optical rules over blurred backdrops (`font-weight >= 400`, `400`/`500`/`600` halation restraint, `tabular-nums`, sentence case, `text-wrap`), type scale table, offline `.woff2` bundling, OFL-1.1 license script integration, and `terminalAppearance.ts` integration. | Touching fonts, text sizes, weight hierarchy, numeric columns (`FileRow`, `TransferQueue`, `MonitorPanel`), or terminal font settings. |
| **[04 — Design Patterns & Rollout Spec](docs/design-system/04-design-patterns-and-rollout.md)** | Component-by-component mapping (`App.vue`, `SiteTabBar`, `SessionManagerView`, `FilePane`, `BottomDock`, modals), virtualized list & `xterm.js` guardrails, `@container` responsive slot breakpoints, pointer/touch/keyboard modality rules, Arc UI micro-interaction mapping, `SettingsDialog.vue` feature switch (`In Development`), and the one-time discovery toast. | Implementing or modifying Vue components, resizable pane layouts, `ui.store.ts`, `SettingsDialog.vue`, or `App.vue`. |
| **[Motion System](docs/motion-system.md)** | Shared motion philosophy (cause-and-effect, `bounce: 0` state discipline, faster exits, interruptibility, popup-anchor press guard), complete duration/easing/`linear()` spring tokens, programmatic JS/WAAPI presets, Arc UI micro-interaction patterns, WebView2 glass compositor rules, and `prefers-reduced-motion` rules. | Adding or modifying transitions, dock animations, tab switches, destructive confirmation patterns, overlay entrances/exits, or folder navigation effects. |
| **[Design Specification](docs/superpowers/specs/2026-11-18-glassmorphism-ui-research-design.md)** | Approved architectural specification, goals/anti-goals, constraints, and builder rulings for the Glassmorphism UI redesign. | Reviewing project scope, rationale, or resolving design trade-offs. |
| **[Implementation Plan: Arc UI Motion & Responsive Polish](docs/superpowers/plans/2026-11-19-arc-ui-motion-and-responsive-polish.md)** | Step-by-step TDD implementation plan for `motionTokens.ts`, `main.css` spring/exit/modality tokens, tooltip warmup, directional dock transitions, `@container` slot rules, and `ConfirmDialog.vue` double-click guard. | Executing Phase 2 motion, micro-interaction, and container-responsive code changes in `src/renderer/`. |

---

## 3. Golden Rules & Non-Negotiable Guardrails for Agents

1. **Strict `.ferry-glass` Root Scoping (Zero Classic Regression):**
   - When `ui.glassUiEnabled` is `false` (default), `<html>` has no `.ferry-glass` class and Ferry must look and behave 100% identically to classic mode. Never leak glass styles or font overrides outside `html.ferry-glass`.
2. **Never Nest `backdrop-filter` Inside Another `backdrop-filter`:**
   - In Chromium/WebView2, any parent with `backdrop-filter`, `opacity < 1`, or `filter` creates a Backdrop Root that blocks child `backdrop-filter` elements from sampling `.ferry-ambient-canvas`. Keep `<main>` and layout wrappers transparent (`bg-transparent`) without `backdrop-filter`; apply blur only to leaf chrome, cards, and `<body>`-teleported overlays.
3. **Zero Per-Row Blur on Virtualized Lists (`FileRow.vue`, `TransferQueue.vue`):**
   - Never apply `backdrop-filter`, `filter`, or `box-shadow` to individual virtualized rows. Dense lists sit inside a Tier 2B `.ferry-glass-well` container (`0.82` Light / `0.78` Dark alpha) and use lightweight `bg-primary/14` / `hover:bg-muted/50` row states to maintain 60fps scrolling.
4. **Never Unmount `TerminalView.vue` or Break WebGL (`xterm.js`):**
   - Toggling `ui.glassUiEnabled` must only toggle `html.ferry-glass` and reactive classes—never re-key or unmount `BottomDock.vue` or `TerminalView.vue`. Keep `.xterm` free of `backdrop-filter`.
5. **Static Ambient Mesh Backdrop at Rest:**
   - `.ferry-ambient-canvas` must remain strictly static at rest (updating only on `theme` or `accentColor` changes). Never add infinite `@keyframes` animations behind `backdrop-filter` layers.
6. **Opaque `--ferry-caption-bg` for Windows 11 Native Titlebar Sync:**
   - `resolveCaptionColorRef()` in `ui.store.ts` requires a 100% opaque color (`alpha === 255`) to sync the native Windows 11 DWM titlebar (`INVOKE_CHANNELS.windowSyncTheme`). Always resolve `--ferry-caption-bg` (not translucent `--ferry-glass-chrome-bg`) and re-run `applyTheme()` when `glassUiEnabled`, `theme`, or `accentColor` changes.
7. **Offline-Only Local Variable Fonts (`.woff2`) & OFL-1.1 Licensing:**
   - Bundle `PlusJakartaSans-Variable.woff2` and `JetBrainsMono-Variable.woff2` locally under `src/renderer/src/assets/fonts/` and register their SIL OFL-1.1 licenses in `scripts/generate-third-party-licenses.mjs`. Never fetch fonts from external CDNs (`fonts.googleapis.com`).
8. **Typographic Legibility on Glass (`font-weight >= 400` & `tabular-nums`):**
   - Never use font weights below `400` on translucent surfaces. Always apply `tabular-nums` (`font-variant-numeric: tabular-nums`) to file sizes, dates, transfer speeds, port numbers, and resource metrics.
9. **Gate Discovery Toast Behind Legal Consent:**
   - The one-time `"Try Glass UI"` toast in `App.vue` must wait until `settingsStore.loaded && !needsLegalConsent.value && !ui.glassUiEnabled && !ui.glassUiPromoDismissed`.
10. **Honor OS Accessibility Preferences:**
    - Always maintain `@media (prefers-reduced-transparency: reduce)` (`>= 0.98` opaque fallback, `backdrop-filter: none`) and `@media (prefers-reduced-motion: reduce)` alongside WCAG 2.2 AA contrast ratios (>= 4.5:1 normal text, >= 7:1 in content wells).
11. **Cause-and-Effect Motion & Zero Overshoot on State (`bounce: 0`):**
    - State transitions (switches, dock height, drawers, progress bars, live counters, tab indicators) must use critically damped curves (`bounce: 0` / `--ferry-motion-ease-spring`) so they never overshoot into a false state. Exits (`--ferry-motion-exit: 140ms`) are always faster than entrances (`170ms–210ms`), and `filter: blur()` must never be animated on elements with `backdrop-filter`.
12. **Interruptibility, Popup-Anchor Press Guard & Keyboard Instantaneity:**
    - Never block user input for an animation. Suppress `:active` `scale()` on triggers with `[aria-haspopup]`, `[data-state="open"]`, or `[aria-expanded="true"]` so floating popovers never measure a shrunken anchor rect. Pointer hover glides smoothly, while repeated keyboard arrow navigation (`ArrowUp`/`ArrowDown` in `FileList`, `CommandPalette`, menus) updates focus/selection immediately without spring lag.
13. **Concentric Corner Radii & Container-First Responsive Slots:**
    - Nested rounded corners obey `innerRadius = max(0px, outerRadius - padding)`. Use container queries (`@container` / `ResizeObserver`) rather than viewport-only media queries for resizable panes (`FilePane`, `BottomDock`), and wrap hover-only effects in `@media (hover: hover) and (pointer: fine)`.

---

## 4. Quick Token & Utility Cheat Sheet

| Utility Class / Token | Elevation Tier | Blur & Saturation | Alpha (Light / Dark) | Primary Usage |
| :--- | :--- | :--- | :--- | :--- |
| `.ferry-ambient-canvas` | Layer 0 Backdrop | None (Static `oklch` Mesh) | `1.0` (Opaque Base) | Fixed backdrop behind `#app` in `App.vue` when `ui.glassUiEnabled` is `true`. |
| `--ferry-caption-bg` | Win11 Native Frame | None (DWM `COLORREF`) | `1.0` (`alpha === 255`) | Read by `resolveCaptionColorRef()` in `ui.store.ts` for seamless Win11 titlebar tinting. |
| `.ferry-glass-chrome` | Tier 1 Chrome | `blur(18px) saturate(180%)` | `0.68` / `0.62` | `SiteTabBar.vue`, `FileToolbar.vue`, `PathBreadcrumb.vue`, `BottomDock.vue` header. |
| `.ferry-glass-card` | Tier 2A Showcase Card | `blur(20px) saturate(180%)` | `0.68` / `0.60` | `SessionManagerView.vue` cards (`Sites`, `Quick Connect`, reconnect banner, `SiteDetailsPanel.vue`). |
| `.ferry-glass-well` | Tier 2B Content Well | Container tint only | `0.82` / `0.78` | `FileList.vue`, `LogTailViewer.vue`, `TransferQueue.vue`, `ActivityPanel.vue`, `MonitorPanel.vue`. |
| `.ferry-glass-overlay` | Tier 3 Floating Overlay | `blur(24px) saturate(180%)` | `0.78` / `0.72` | `SettingsDialog.vue`, `CommandPalette.vue`, `HistoryDialog.vue`, popovers, context menus, toasts. |
| `--ferry-skeleton-*` | Loading Skeleton Shimmer | None (Gradient Shimmer) | `0.11–0.22` / `0.18–0.34` | High-contrast `<USkeleton>` shimmer inside Tier 2A/2B/3 glass containers (`FilePreviewDialog`, `FileList`, `EditorDialog`). |
| `ferry:ui:glassUi` | `localStorage` Key | — | Default `'false'` | Persists `ui.glassUiEnabled` toggle in `ui.store.ts`. |
| `ferry:ui:glassUiPromoDismissed` | `localStorage` Key | — | Default `'false'` | Persists one-time discovery toast dismissal in `ui.store.ts`. |

### Motion & Interaction Tokens (`src/renderer/src/assets/main.css`)

| CSS Token | Value / Curve | Primary Role |
| :--- | :--- | :--- |
| `--ferry-motion-instant` | `100ms` | Immediate `:active` press scale, state snap. |
| `--ferry-motion-fast` | `120ms` | Opacity crossfades, hover tints, micro-feedback. |
| `--ferry-motion-exit` | `140ms` | Departing overlays, popovers, toasts, dock panels. |
| `--ferry-motion-standard` | `170ms` | Dock panel contents, tab underline indicators, inline form slides. |
| `--ferry-motion-panel` | `210ms` | `BottomDock` expand/collapse, `SiteDetailsPanel` slide-over, ambient mesh shift. |
| `--ferry-motion-considered` | `360ms` | Multi-stage reveals, checkmark draw, morph completion. |
| `--ferry-motion-spring` | `440ms` | Paired exclusively with `--ferry-motion-ease-spring`. |
| `--ferry-motion-ease-emphasized` | `cubic-bezier(0.16, 1, 0.3, 1)` | Panel entrances, active tab indicators, rising overlays. |
| `--ferry-motion-ease-standard` | `cubic-bezier(0.22, 1, 0.36, 1)` | Balanced general UI movement. |
| `--ferry-motion-ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Content settling, ambient mesh transitions. |
| `--ferry-motion-ease-exit` | `cubic-bezier(0.7, 0, 0.84, 0)` | Fast exit acceleration for departing layers. |
| `--ferry-motion-ease-spring` | `linear(0, 0.0213, 0.0739, ... 1)` | Critically damped CSS spring (`bounce: 0`), zero state overshoot. |

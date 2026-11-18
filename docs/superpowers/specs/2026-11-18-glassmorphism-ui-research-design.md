# Ferry Glassmorphism & Minimalist UI Redesign — Research & Documentation Spec

- **Date:** 2026-11-18
- **Status:** Draft for Approval
- **Scope:** Deep Research & Design System Documentation Suite (Pre-implementation Phase)

---

## 1. Intent and Why

Ferry is a high-performance, lightweight SFTP, SSH, and live log-tailing desktop client built on Neutralinojs (`WebView2`), Vue 3, Nuxt UI v4, and Tailwind CSS v4. While Ferry's current interface is functional and fast, the user wants to elevate its visual identity with a **Modern Minimalist Translucent (Glassmorphism)** design direction inspired by:

1. **Mikołaj Gałęziowski (`dribbble.com/galeziowski`):** Specifically his *Glassmorphism Big Sur Creative Cloud* and *Messenger* app redesigns—characterized by multi-layered frosted glass (`backdrop-filter: blur()`), delicate 1px specular borders catching light, soft ambient elevation shadows, and subtle vibrant mesh/aurora backdrops that give translucent panels depth without visual clutter.
2. **Figma's "33 Modern Fonts To Elevate Your Designs":** Specifically selecting **Plus Jakarta Sans** (UI & Display) paired with **Cascadia Code / JetBrains Mono** (Monospace) to bring geometric warmth, open apertures, and razor-sharp legibility on translucent surfaces.

Because a full visual redesign touches every surface of the application and requires strict discipline to preserve contrast (WCAG AA), 60fps virtualized scrolling, and `xterm.js` WebGL performance, this project is split into two phases:
- **Phase 1 (This Spec & Plan):** Conduct deep research and author a complete, agent-navigable Design System Documentation Suite (`DESIGN.md` + `docs/design-system/01..04`), including the full specification for the **Settings feature switch** (`In Development` badge, `default: false`) and the **one-time user discovery notification**.
- **Phase 2 (Future Implementation):** Implement the CSS tokens, bundled fonts, ambient canvas, component overrides, Settings switch, and notification banner according to the documentation produced in Phase 1.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Agent-First Entrypoint (`DESIGN.md`):** Create a root `DESIGN.md` file that acts as the single source of truth and navigation hub for AI agents and developers working on Ferry's UI.
- **Modular 4-Part Design System Suite (`docs/design-system/`):**
  1. `01-visual-direction.md`: Philosophy of Minimalist Glassmorphism, deep-dive analysis of Mikołaj Gałęziowski's visual techniques, Light vs. Dark mode material physics, and the in-app Ambient Mesh Canvas architecture.
  2. `02-styling-and-tokens.md`: Exact CSS custom properties (`--ferry-glass-*`), `oklch()` / `color-mix()` recipes, 3-tier blur & opacity scales, 1px directional specular borders, elevation shadows, and Nuxt UI v4 / Tailwind v4 integration rules.
  3. `03-typography-system.md`: Typography research from Figma's *33 Modern Fonts*, rationale and optical rules for **Plus Jakarta Sans** + **Cascadia Code / JetBrains Mono**, weight/size/line-height tokens, `tabular-nums` rules for SFTP file sizes/timestamps, and local `@font-face` bundling strategy.
  4. `04-design-patterns-and-rollout.md`: Component-by-component glass application map across Ferry (`App.vue`, `SiteTabBar`, `SessionManagerView`, `FilePane`, `BottomDock`, modals/popovers), strict performance & accessibility guardrails, and the exact technical spec for the **Settings Feature Switch** (`default: false`, `In Development` badge) + **One-Time User Discovery Toast**.
- **Actionable Precision:** Every document must contain concrete CSS snippets, token tables, Vue/Tailwind class patterns, and mermaid architecture diagrams so Phase 2 implementation requires zero guesswork.

### Non-Goals
- **No Production Code Changes in Phase 1:** This phase produces only documentation files (`DESIGN.md` and `docs/design-system/*.md`). No changes to `src/`, `package.json`, or `neutralino.config.json` happen during this phase.
- **No OS-Level Window Transparency (Mica/Acrylic) Required:** The core vision is **in-app glassmorphism** (translucent panels over an in-app ambient mesh/gradient backdrop inside the WebView2 viewport), ensuring 100% cross-platform and Windows 10/11 consistency without DWM compositor lag.

### Anti-Goals (What Would Make This a Failure)
- **Visual Noise Over Clarity:** Applying heavy blur or low-contrast translucency behind dense text (such as `FileRow` items, `LogTailViewer` streams, or `TerminalView` xterm canvas) where background bleed hurts readability.
- **Scroll Jank from Nested `backdrop-filter`:** Putting `backdrop-filter: blur()` on individual virtualized rows (`FileRow.vue`, `TransferQueue.vue`) or stacking 3+ active blur layers simultaneously.
- **Generic "Dribbble Fluff" Without Codebase Grounding:** Writing abstract design prose that ignores Ferry's actual Tailwind v4 `@theme` setup, Nuxt UI v4 CSS variables (`--ui-bg`, `--ui-border`, `--ui-color-primary-*`), or `ui.store.ts` state architecture.

---

## 3. Constraints

1. **Runtime & Stack:** Neutralinojs (`WebView2` on Windows) + Vue 3.5 + `@nuxt/ui` v4.9 + `@tailwindcss/vite` v4.0 (`src/renderer/src/assets/main.css`).
2. **Offline / Zero-Network Font Loading:** Ferry is a desktop SFTP client often used in restricted or air-gapped corporate networks (with SOCKS5/HTTP proxies). Fonts (`Plus Jakarta Sans` variable `.woff2` and `JetBrains Mono` / `Cascadia Code`) must be documented for local bundling (or zero-latency local fallback), never fetched at runtime from `fonts.googleapis.com`.
3. **Coexistence with Existing UI (`default: false`):** When the Glassmorphism feature switch is `false` (the default), Ferry must look and behave 100% identically to today's classic opaque UI. Toggling the switch activates the redesign instantaneously via a root `.ferry-glass` class on `document.documentElement` without remounting `TerminalView` or losing SSH session state.
4. **Motion & Accessibility Compliance:** Must integrate cleanly with `docs/motion-system.md` (`--ferry-motion-*` tokens), respect `@media (prefers-reduced-motion: reduce)`, respect `@media (prefers-reduced-transparency: reduce)`, and maintain WCAG 2.2 AA contrast (4.5:1 for normal text, 3:1 for UI components).

---

## 4. Approaches Considered

### Documentation Architecture
- **Approach A: Root `DESIGN.md` + Modular 4-Document Suite under `docs/design-system/` (Chosen)**
  - *Structure:* `DESIGN.md` at repo root serves as the executive summary, rulebook, and agent index linking to `01-visual-direction.md`, `02-styling-and-tokens.md`, `03-typography-system.md`, and `04-design-patterns-and-rollout.md`.
  - *Trade-off:* Clean separation by domain (philosophy vs. CSS tokens vs. typography vs. component patterns & feature flag); agents can load only the doc relevant to their task.
- **Approach B: Single Monolithic `docs/glassmorphism-design.md`**
  - *Trade-off:* Simpler file count, but harder for agents to scan selectively and mixes high-level visual philosophy with low-level component specs.

### Typography Selection (from Figma's *33 Modern Fonts*)
- **Pairing 1: `Plus Jakarta Sans` (UI/Display) + `Cascadia Code` / `JetBrains Mono` (Monospace) (Chosen)**
  - *Why:* `Plus Jakarta Sans` combines contemporary geometric warmth with tall x-height and open counters that stay crisp on blurred glass surfaces, matching Mikołaj Gałęziowski's modern desktop concepts. Paired with `Cascadia Code` / `JetBrains Mono` for paths, permissions, logs, and terminal.
- **Pairing 2: `Instrument Sans` + `Instrument Serif` + Monospace**
  - *Trade-off:* High editorial flair, but serif headers are less native to a utilitarian daily-driver SFTP/SSH tool.
- **Pairing 3: `Rethink Sans` + Monospace**
  - *Trade-off:* Very clean neo-grotesque, but less distinctive in display headers than `Plus Jakarta Sans`.
  - *(Note: `03-typography-system.md` will document the broader Figma 33 Modern Fonts research and compare these top contenders while locking in `Plus Jakarta Sans` + `Cascadia Code / JetBrains Mono` as Ferry's specification).*

---

## 5. Core Design Decisions Locked In

1. **In-App Glassmorphism Architecture:**
   - Activated by toggling `.ferry-glass` on `<html>` (`document.documentElement`).
   - **Ambient Mesh Backdrop (*Builder Call: Strictly Static at Rest*):** Renders a static, zero-idle-CPU/GPU **Ambient Mesh Backdrop** behind the app shell using multi-stop radial/conic `oklch()` gradients anchored to `var(--ui-color-primary-500)` and complementary ambient orbs. It updates smoothly only when `theme` or `accentColor` changes—never running continuous `@keyframes` drift loops behind `backdrop-filter` layers.
   - **3-Tier Glass Elevation + High-Legibility Content Wells (*Builder Call*):**
     - **Tier 1 — App Chrome (`--ferry-glass-chrome`):** `SiteTabBar`, `FileToolbar`, `PathBreadcrumb`, `BottomDock` tab bar, collapsed Local rail, and status bars (`backdrop-filter: blur(16px) saturate(160%)`, `0.68–0.78` alpha tint, 1px specular border).
     - **Tier 2 — Workspace Cards & Framed Panels (`--ferry-glass-card` / `--ferry-glass-well`):**
       - *Session Manager Cards (`Sites`, `Quick Connect`, `SiteDetailsPanel`):* Full Gałęziowski frosted cards (`blur(16px) saturate(170%)`, `0.65–0.78` alpha tint, 1px specular top/outer border, soft ambient drop shadow) floating directly over the ambient mesh canvas.
       - *Connected Content Wells (`FileList` viewport, `LogTailViewer` stream, `MonitorPanel` tables):* High-legibility translucent wells (`0.86–0.92` alpha in Light, `0.82–0.88` alpha in Dark, with container-level blur or tint-only so virtualized rows scroll at 60fps with zero per-row `backdrop-filter` and >= 7:1 WCAG AAA text contrast).
       - *Terminal (`TerminalView`) & Code Editor (`EditorDialog`):* Preserve their user-selected terminal/editor color scheme (`terminalAppearance.ts` / One Dark); when using the default `Ferry` terminal scheme under `.ferry-glass`, apply a subtle `0.90` dark/light glass-well tint while keeping custom schemes (Dracula, Catppuccin, etc.) untouched.
     - **Tier 3 — Floating Overlays (`--ferry-glass-overlay`):** `SettingsDialog`, `CommandPalette`, `HistoryDialog`, `FileVisibilityPopover`, `ContextMenu`, Toasts (`blur(24px) saturate(180%)`, luminous 1px inner-highlight border, deep ambient shadow).
   - **Windows 11 Native Titlebar Seam (`resolveCaptionColorRef` — *Builder Call*):**
     - Introduce a dedicated opaque CSS token `--ferry-caption-bg` (computed by mixing the top-edge ambient mesh tint with the base theme surface at 100% opacity, `alpha === 255`).
     - `resolveCaptionColorRef()` in `ui.store.ts` reads `--ferry-caption-bg` (falling back to `--ui-bg-muted`), and `applyTheme()` is re-invoked whenever `glassUiEnabled`, `theme`, or `accentColor` changes so the native Windows 11 caption bar blends seamlessly into the top edge of `SiteTabBar`.
2. **Specular Edge Lighting ("Gałęziowski Signature"):**
   - Glass cards and overlays use a 1px translucent border (`rgba(255, 255, 255, 0.22)` in Dark, `rgba(255, 255, 255, 0.65)` outer + `rgba(15, 23, 42, 0.08)` subtle definition in Light) paired with an inset top-edge specular highlight (`inset 0 1px 0 0 rgba(255, 255, 255, 0.25)`).
3. **Typography System (`Plus Jakarta Sans` + `Cascadia Code / JetBrains Mono` — *Builder Call on Bundling*):**
   - **Bundled Fonts:** Bundle both `Plus Jakarta Sans Variable` (`PlusJakartaSans-Variable.woff2`, OFL-1.1) and `JetBrains Mono Variable` (`JetBrainsMono-Variable.woff2`, OFL-1.1) locally under `src/renderer/src/assets/fonts/` (and register their OFL-1.1 notices in `scripts/generate-third-party-licenses.mjs`), guaranteeing identical rendering across Windows 10 and 11 offline.
   - `--font-sans`: `'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', -apple-system, 'Segoe UI Variable', sans-serif` (scoped under `.ferry-glass` so the classic UI keeps its system font stack until switched on).
   - `--font-mono`: `'Cascadia Code', 'JetBrains Mono Variable', 'SF Mono', Consolas, monospace` (uses Windows 11's native `Cascadia Code` first or `JetBrains Mono Variable` right beside it, and makes `JetBrains Mono` always available in Terminal settings).
   - Avoid weights below `400` on translucent surfaces; use `500` (Medium) and `600` (SemiBold) for labels and active states to prevent blur-bleed; enforce `font-variant-numeric: tabular-nums` on all file sizes, transfer speeds, ports, and timestamps.
4. **Settings Feature Switch & One-Time Discovery Notification:**
   - **State (`ui.store.ts`):**
     - `glassUiEnabled: boolean` (persisted in `localStorage` under `'ferry:ui:glassUi'`, default `false`).
     - `glassUiPromoDismissed: boolean` (persisted in `localStorage` under `'ferry:ui:glassUiPromoDismissed'`, default `false`).
   - **Settings UI (`SettingsDialog.vue` → Appearance tab):**
     - Placed at the top of the **Appearance** tab in a highlighted preview row: **"Modern Glass UI"** accompanied by a `<UBadge color="primary" variant="subtle" size="xs">In Development</UBadge>` badge, descriptive copy explaining the translucent minimalist redesign, and a `<USwitch>` bound to `ui.glassUiEnabled`.
   - **User Discovery Notification (`App.vue`):**
     - Triggered once after initial mount (once `needsLegalConsent` is false and `!ui.glassUiEnabled && !ui.glassUiPromoDismissed`).
     - Uses Nuxt UI's `useToast()` (`duration: 10000`, icon `i-lucide-sparkles`) with two actions:
       1. **"Try Glass UI"**: Calls `ui.setGlassUiEnabled(true)` and `ui.dismissGlassUiPromo()`, immediately transforming the interface and showing a confirmation toast with a quick "Open Settings" action if they want to switch back.
       2. **"Dismiss"** (or closing the toast): Calls `ui.dismissGlassUiPromo()` so the user is never nagged again.

---

## 6. What's Left to the Builder (Phase 1 Documentation Authoring)

- Exact prose, markdown formatting, comparison tables, and mermaid diagrams within each of the 5 markdown files (`DESIGN.md` and `docs/design-system/01..04`).
- Selecting the exact `oklch()` / `rgba()` alpha stops for Light and Dark themes in `02-styling-and-tokens.md` so all text tokens (`--ui-text-highlighted`, `--ui-text-default`, `--ui-text-muted`) pass WCAG 2.2 AA contrast ratios over the ambient mesh canvas.

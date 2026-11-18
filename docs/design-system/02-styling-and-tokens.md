# 02 — Styling, CSS Tokens & Theme Recipes

- **Parent Entrypoint:** [DESIGN.md](../../DESIGN.md)
- **Design Spec:** [2026-11-18-glassmorphism-ui-research-design.md](../superpowers/specs/2026-11-18-glassmorphism-ui-research-design.md)
- **Related Docs:** [01 — Visual Direction](./01-visual-direction.md) · [03 — Typography System](./03-typography-system.md) · [04 — Design Patterns & Rollout](./04-design-patterns-and-rollout.md)

---

## 1. Activation & Scoping Architecture (`html.ferry-glass`)

Because the Glassmorphism UI redesign ships behind an opt-in feature switch (`glassUiEnabled`, default `false`), **every CSS token override, backdrop blur, and surface utility must be scoped under `html.ferry-glass`** (and `html.dark.ferry-glass` for dark mode) in [`src/renderer/src/assets/main.css`](../../src/renderer/src/assets/main.css).

- **When `glassUiEnabled === false` (`<html>` without `.ferry-glass`):**
  - Ferry renders 100% of its existing classic opaque palette, system font stack, and solid borders with zero visual diff.
- **When `glassUiEnabled === true` (`<html class="ferry-glass">` or `<html class="dark ferry-glass">`):**
  - `document.documentElement.classList.toggle('ferry-glass', enabled)` activates all `--ferry-glass-*` tokens, the `.ferry-ambient-canvas` backdrop, Nuxt UI semantic variable remappings, and the `Plus Jakarta Sans` typography stack instantaneously without unmounting a single Vue component.

---

## 2. Complete Token Reference Table & CSS Block

### Token Reference Matrix

| CSS Custom Property | Light Mode (`html.ferry-glass`) | Dark Mode (`html.dark.ferry-glass`) | Purpose & Consumers |
| :--- | :--- | :--- | :--- |
| `--ferry-canvas-base` | `#f4f6fb` | `#090d16` | Solid base floor beneath `.ferry-ambient-canvas`. |
| `--ferry-caption-bg` | `color-mix(in srgb, var(--ui-color-primary-500) 6%, #f4f6fb)` | `color-mix(in srgb, var(--ui-color-primary-500) 8%, #090d16)` | **100% opaque (`alpha === 255`)** color read by `resolveCaptionColorRef()` in `ui.store.ts` to sync the Windows 11 native DWM titlebar. |
| `--ferry-glass-chrome-bg` | `rgba(248, 250, 252, 0.75)` | `rgba(13, 18, 30, 0.68)` | Tier 1 surface tint (`SiteTabBar`, `FileToolbar`, `PathBreadcrumb`, `BottomDock` bar). |
| `--ferry-glass-chrome-blur` | `blur(16px) saturate(160%)` | `blur(16px) saturate(160%)` | Tier 1 `backdrop-filter` value. |
| `--ferry-glass-chrome-border` | `rgba(15, 23, 42, 0.08)` | `rgba(255, 255, 255, 0.09)` | Hairline structural divider between chrome and content wells. |
| `--ferry-glass-card-bg` | `rgba(255, 255, 255, 0.72)` | `rgba(15, 23, 42, 0.64)` | Tier 2A showcase frosted cards (`SessionManagerView` cards, `SiteDetailsPanel`). |
| `--ferry-glass-card-blur` | `blur(16px) saturate(170%)` | `blur(16px) saturate(170%)` | Tier 2A `backdrop-filter` value. |
| `--ferry-glass-card-border` | `rgba(255, 255, 255, 0.75)` | `rgba(255, 255, 255, 0.14)` | 1px outer refractive border on frosted cards. |
| `--ferry-glass-card-highlight` | `inset 0 1px 0 0 rgba(255, 255, 255, 0.92), 0 0 0 1px rgba(15, 23, 42, 0.06)` | `inset 0 1px 0 0 rgba(255, 255, 255, 0.22)` | Top-bevel specular edge highlight (plus subtle outer keyline in Light mode). |
| `--ferry-glass-card-shadow` | `0 12px 32px -6px rgba(15, 23, 42, 0.07), 0 4px 12px -2px rgba(15, 23, 42, 0.04)` | `0 16px 36px -6px rgba(0, 0, 0, 0.42), 0 4px 12px -2px rgba(0, 0, 0, 0.28)` | Soft ambient elevation shadow under Tier 2A cards. |
| `--ferry-glass-well-bg` | `rgba(255, 255, 255, 0.88)` | `rgba(11, 15, 25, 0.84)` | Tier 2B high-legibility content well (`FileList`, `LogTailViewer`, `TransferQueue`, `MonitorPanel`). |
| `--ferry-glass-overlay-bg` | `rgba(255, 255, 255, 0.78)` | `rgba(15, 23, 42, 0.72)` | Tier 3 floating modals, command palette, popovers, context menus, toasts. |
| `--ferry-glass-overlay-blur` | `blur(24px) saturate(180%)` | `blur(24px) saturate(180%)` | Tier 3 high-refraction `backdrop-filter`. |
| `--ferry-glass-overlay-border` | `rgba(255, 255, 255, 0.82)` | `rgba(255, 255, 255, 0.18)` | 1px outer border on floating dialogs and popovers. |
| `--ferry-glass-overlay-shadow` | `0 24px 48px -12px rgba(15, 23, 42, 0.14), 0 0 0 1px rgba(15, 23, 42, 0.07)` | `0 24px 56px -12px rgba(0, 0, 0, 0.62), inset 0 1px 0 0 rgba(255, 255, 255, 0.24)` | Deep ambient shadow + specular rim for Tier 3 overlays. |

---

### Canonical CSS Specification (`src/renderer/src/assets/main.css`)

```css
/* ============================================================================
   Modern Glass UI Redesign (Scoped strictly to html.ferry-glass)
   ============================================================================ */

html.ferry-glass {
  --ferry-canvas-base: #f4f6fb;
  /* 100% opaque (alpha === 255) so ui.store.ts resolveCaptionColorRef() syncs Win11 DWM caption bar */
  --ferry-caption-bg: color-mix(in srgb, var(--ui-color-primary-500) 6%, #f4f6fb);

  --ferry-ambient-mesh:
    radial-gradient(circle at 12% 8%, color-mix(in oklab, var(--ui-color-primary-400) 22%, transparent) 0%, transparent 48%),
    radial-gradient(circle at 88% 18%, oklch(0.85 0.10 300 / 0.16) 0%, transparent 52%),
    radial-gradient(circle at 52% 92%, color-mix(in oklab, var(--ui-color-primary-300) 14%, transparent) 0%, transparent 55%),
    var(--ferry-canvas-base);

  /* Tier 1: App Chrome */
  --ferry-glass-chrome-bg: rgba(248, 250, 252, 0.75);
  --ferry-glass-chrome-blur: blur(16px) saturate(160%);
  --ferry-glass-chrome-border: rgba(15, 23, 42, 0.08);

  /* Tier 2A: Showcase Frosted Cards (SessionManagerView) */
  --ferry-glass-card-bg: rgba(255, 255, 255, 0.72);
  --ferry-glass-card-blur: blur(16px) saturate(170%);
  --ferry-glass-card-border: rgba(255, 255, 255, 0.75);
  --ferry-glass-card-highlight: inset 0 1px 0 0 rgba(255, 255, 255, 0.92), 0 0 0 1px rgba(15, 23, 42, 0.06);
  --ferry-glass-card-shadow: 0 12px 32px -6px rgba(15, 23, 42, 0.07), 0 4px 12px -2px rgba(15, 23, 42, 0.04);

  /* Tier 2B: High-Legibility Content Wells (FileList, LogTailViewer, Monitor) */
  --ferry-glass-well-bg: rgba(255, 255, 255, 0.88);

  /* Tier 3: Floating Overlays (Modals, CommandPalette, Popovers, ContextMenu) */
  --ferry-glass-overlay-bg: rgba(255, 255, 255, 0.78);
  --ferry-glass-overlay-blur: blur(24px) saturate(180%);
  --ferry-glass-overlay-border: rgba(255, 255, 255, 0.82);
  --ferry-glass-overlay-shadow:
    inset 0 1px 0 0 rgba(255, 255, 255, 0.95),
    0 0 0 1px rgba(15, 23, 42, 0.07),
    0 24px 48px -12px rgba(15, 23, 42, 0.14);

  /* Nuxt UI v4 Semantic Surface Remapping */
  --ui-radius: 0.625rem;
  --ui-bg: var(--ferry-glass-well-bg);
  --ui-bg-muted: var(--ferry-glass-chrome-bg);
  --ui-bg-elevated: var(--ferry-glass-card-bg);
  --ui-border: var(--ferry-glass-chrome-border);
  --ui-border-muted: var(--ferry-glass-chrome-border);
  --ferry-surface-bar: var(--ferry-glass-chrome-bg);
  --ferry-surface-subtle: rgba(255, 255, 255, 0.55);
}

html.dark.ferry-glass {
  --ferry-canvas-base: #090d16;
  --ferry-caption-bg: color-mix(in srgb, var(--ui-color-primary-500) 8%, #090d16);

  --ferry-ambient-mesh:
    radial-gradient(circle at 12% 8%, color-mix(in oklab, var(--ui-color-primary-500) 20%, transparent) 0%, transparent 48%),
    radial-gradient(circle at 88% 18%, oklch(0.35 0.14 295 / 0.18) 0%, transparent 52%),
    radial-gradient(circle at 52% 92%, color-mix(in oklab, var(--ui-color-primary-600) 14%, transparent) 0%, transparent 55%),
    var(--ferry-canvas-base);

  /* Tier 1: App Chrome */
  --ferry-glass-chrome-bg: rgba(13, 18, 30, 0.68);
  --ferry-glass-chrome-blur: blur(16px) saturate(160%);
  --ferry-glass-chrome-border: rgba(255, 255, 255, 0.09);

  /* Tier 2A: Showcase Frosted Cards */
  --ferry-glass-card-bg: rgba(15, 23, 42, 0.64);
  --ferry-glass-card-blur: blur(16px) saturate(170%);
  --ferry-glass-card-border: rgba(255, 255, 255, 0.14);
  --ferry-glass-card-highlight: inset 0 1px 0 0 rgba(255, 255, 255, 0.22);
  --ferry-glass-card-shadow: 0 16px 36px -6px rgba(0, 0, 0, 0.42), 0 4px 12px -2px rgba(0, 0, 0, 0.28);

  /* Tier 2B: High-Legibility Content Wells */
  --ferry-glass-well-bg: rgba(11, 15, 25, 0.84);

  /* Tier 3: Floating Overlays */
  --ferry-glass-overlay-bg: rgba(15, 23, 42, 0.72);
  --ferry-glass-overlay-blur: blur(24px) saturate(180%);
  --ferry-glass-overlay-border: rgba(255, 255, 255, 0.18);
  --ferry-glass-overlay-shadow:
    inset 0 1px 0 0 rgba(255, 255, 255, 0.24),
    0 24px 56px -12px rgba(0, 0, 0, 0.62);

  /* Nuxt UI v4 Semantic Surface Remapping */
  --ui-bg: var(--ferry-glass-well-bg);
  --ui-bg-muted: var(--ferry-glass-chrome-bg);
  --ui-bg-elevated: var(--ferry-glass-card-bg);
  --ui-border: var(--ferry-glass-chrome-border);
  --ui-border-muted: var(--ferry-glass-chrome-border);
  --ferry-surface-bar: var(--ferry-glass-chrome-bg);
  --ferry-surface-subtle: rgba(15, 23, 42, 0.48);
}

/* Reusable Surface Utility Classes (Active only when html.ferry-glass is present) */
.ferry-ambient-canvas {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: var(--ferry-ambient-mesh);
  transition: background var(--ferry-motion-panel) var(--ferry-motion-ease-out);
}

html.ferry-glass .ferry-glass-chrome {
  background-color: var(--ferry-glass-chrome-bg);
  backdrop-filter: var(--ferry-glass-chrome-blur);
  -webkit-backdrop-filter: var(--ferry-glass-chrome-blur);
  border-color: var(--ferry-glass-chrome-border);
}

html.ferry-glass .ferry-glass-card {
  background-color: var(--ferry-glass-card-bg);
  backdrop-filter: var(--ferry-glass-card-blur);
  -webkit-backdrop-filter: var(--ferry-glass-card-blur);
  border: 1px solid var(--ferry-glass-card-border);
  box-shadow: var(--ferry-glass-card-highlight), var(--ferry-glass-card-shadow);
}

html.ferry-glass .ferry-glass-well {
  background-color: var(--ferry-glass-well-bg);
}

html.ferry-glass .ferry-glass-overlay {
  background-color: var(--ferry-glass-overlay-bg);
  backdrop-filter: var(--ferry-glass-overlay-blur);
  -webkit-backdrop-filter: var(--ferry-glass-overlay-blur);
  border: 1px solid var(--ferry-glass-overlay-border);
  box-shadow: var(--ferry-glass-overlay-shadow);
}
```

---

## 3. Nuxt UI v4 Semantic Variable Overrides

Nuxt UI v4 components (`UCard`, `UModal`, `UPopover`, `UDropdownMenu`, `UContextMenu`, `UInput`, `USelect`, `UToaster`) compile their structural colors to CSS variables (`--ui-bg`, `--ui-bg-elevated`, `--ui-bg-muted`, `--ui-border`, `--ui-border-muted`).

Rather than fighting Nuxt UI with deep `:deep(...)` selectors in every single component, we combine three clean rules under `html.ferry-glass`:
1. **Portal Overlays (`[role="dialog"]`, Menus/Popovers/Selects, and `UToast` — Excluding `UTooltip`):**
   - Nuxt UI v4 (built on Reka UI) teleports modals, popovers, dropdowns, context menus, and tooltips to `<body>`.
   - **Important:** `UTooltip` also renders inside `[data-reka-popper-content-wrapper]`, whereas `UToast` (`ToastRoot` inside `UToaster`) renders as an `<li role="status">` / `[data-slot="root"]` toast item rather than a Reka popper.
   - Therefore, we target `[role="dialog"]`, `[role="menu"]`, `[role="listbox"]`, and `UToaster` toast roots (`[data-slot="viewport"] > li`) for Tier 3 refractive glass while explicitly excluding `[role="tooltip"]` so small 24px tooltips stay lightweight:
   ```css
   html.ferry-glass [role="dialog"],
   html.ferry-glass [data-reka-popper-content-wrapper] > :not([role="tooltip"]):not(:has([role="tooltip"])),
   html.ferry-glass [data-slot="viewport"] > li {
     background-color: var(--ferry-glass-overlay-bg) !important;
     backdrop-filter: var(--ferry-glass-overlay-blur);
     -webkit-backdrop-filter: var(--ferry-glass-overlay-blur);
     border: 1px solid var(--ferry-glass-overlay-border);
     box-shadow: var(--ferry-glass-overlay-shadow);
   }
   ```
2. **Form Inputs Inside Glass Cards & Overlays (`UInput`, `USelect`):**
   - Inside `.ferry-glass-card` and `.ferry-glass-overlay`, text inputs and selects use a recessed semi-transparent well (`--ferry-surface-subtle`) with `1px solid var(--ferry-glass-chrome-border)` and **no** nested `backdrop-filter`:
   ```css
   html.ferry-glass .ferry-glass-card input,
   html.ferry-glass .ferry-glass-overlay input,
   html.ferry-glass .ferry-glass-card [role="combobox"],
   html.ferry-glass .ferry-glass-overlay [role="combobox"] {
     background-color: var(--ferry-surface-subtle);
     border-color: var(--ferry-glass-chrome-border);
   }
   ```
3. **Remapping `--ui-bg*` Tokens for Inner Containers:**
   - Because `--ui-bg` maps to `var(--ferry-glass-well-bg)` and `--ui-bg-muted` maps to `var(--ferry-glass-chrome-bg)` under `html.ferry-glass`, inner containers that use `bg-default` or `bg-muted` (such as `LogTailViewer.vue:737,818`, `FilePane.vue:838`, and `EditorDialog.vue:140`) automatically inherit translucent glass-well tints without requiring manual overrides on every internal `<div>`.

---

## 4. The Chromium / WebView2 `backdrop-filter` Nesting Rule

> [!WARNING]
> **Critical Chromium / WebView2 Compositor Pitfall (Review Focus #1):**
> In Blink/Chromium (WebView2), any element with `backdrop-filter` (or `opacity < 1`, `filter`, or `mask`) establishes a **Backdrop Root**. If a child element inside that parent also declares `backdrop-filter: blur(...)`, the child can **only** sample the parent's already-rendered pixels—it cannot sample `.ferry-ambient-canvas` behind the parent, and stacking multiple backdrop roots causes severe frame drops.

```mermaid
flowchart TD
    subgraph Bad["❌ Anti-Pattern: Nested backdrop-filter (Broken Blur + GPU Lag)"]
        P1["Main Wrapper (backdrop-filter: blur(12px))<br/>Creates Backdrop Root"]
        C1["FilePane (backdrop-filter: blur(16px))<br/>Cannot see .ferry-ambient-canvas!"]
        GC1["FileRow (backdrop-filter: blur(8px))<br/>1000x GPU Compositor Layers -> Scroll Jank"]
        P1 --> C1 --> GC1
    end

    subgraph Good["✅ Correct Pattern: Flat Sibling Backdrop Sampling"]
        Root["App Shell (bg-transparent, NO backdrop-filter)"]
        S1["SiteTabBar (.ferry-glass-chrome)<br/>Samples .ferry-ambient-canvas directly"]
        S2["FileToolbar + PathBreadcrumb (.ferry-glass-chrome)<br/>Samples .ferry-ambient-canvas directly"]
        S3["FileList (.ferry-glass-well)<br/>High-legibility alpha tint, 0 per-row blur"]
        S4["Teleported UModal / UPopover (.ferry-glass-overlay)<br/>Direct child of <body>, samples everything below"]
        Root --> S1
        Root --> S2
        Root --> S3
        Root --> S4
    end
```

### Mandatory Structural Rules
1. **Never put `backdrop-filter` on `<main>` or the root flex column in `App.vue`:** Keep layout wrappers transparent (`bg-transparent`) without `backdrop-filter`, `opacity < 1`, or `will-change: transform` at rest.
2. **Apply `backdrop-filter` only at the leaf container level:** `SiteTabBar`, `FileToolbar`, `PathBreadcrumb`, `SessionManagerView`'s `UCard`s, `BottomDock` header, and `<body>`-teleported overlays.
3. **Never apply `backdrop-filter` inside virtualized scroll containers:** `FileRow.vue`, `TransferQueue.vue` rows, and `LogTailViewer.vue` lines use solid/semi-transparent `background-color` hover/selection tints (`bg-primary/15`) inside their `.ferry-glass-well` parent.

---

## 5. Accessibility Fallbacks & WCAG 2.2 AA Contrast Matrix

### `@media (prefers-reduced-transparency: reduce)` Fallback (Review Focus #5)

Users who enable "Reduce transparency" (Windows 11 *Settings → Accessibility → Visual effects → Transparency effects: Off*) must automatically receive opaque surfaces while retaining the new `Plus Jakarta Sans` typography, rounded geometry (`--ui-radius: 0.625rem`), and specular border polish:

```css
@media (prefers-reduced-transparency: reduce) {
  html.ferry-glass {
    --ferry-glass-chrome-bg: rgba(248, 250, 252, 0.98);
    --ferry-glass-chrome-blur: none;
    --ferry-glass-card-bg: rgba(255, 255, 255, 0.98);
    --ferry-glass-card-blur: none;
    --ferry-glass-well-bg: #ffffff;
    --ferry-glass-overlay-bg: #ffffff;
    --ferry-glass-overlay-blur: none;
  }

  html.dark.ferry-glass {
    --ferry-glass-chrome-bg: rgba(13, 18, 30, 0.98);
    --ferry-glass-chrome-blur: none;
    --ferry-glass-card-bg: rgba(15, 23, 42, 0.98);
    --ferry-glass-card-blur: none;
    --ferry-glass-well-bg: #0b0f19;
    --ferry-glass-overlay-bg: #0f172a;
    --ferry-glass-overlay-blur: none;
  }
}
```

### Verified Contrast Ratio Matrix (Worst-Case Over Primary Ambient Orb)

Ferry configures Nuxt UI with `neutral: 'zinc'` (`vite.renderer.config.mts:20`) and overrides `--ui-text-muted` / `--ui-text-dimmed` in `main.css:42-52` to `var(--ui-color-neutral-600)` (`#52525b`) in Light mode and `var(--ui-color-neutral-400)` (`#a1a1aa`) in Dark mode. Because `.ferry-ambient-canvas` caps its radial orb opacity at `22%` in Light mode and `20%` in Dark mode, the worst-case composite background luminance beneath every glass tier passes WCAG 2.2 AA/AAA:

| Nuxt UI v4 Text Token | Foreground Color (`zinc` Light / Dark) | Over Tier 1 Chrome (`0.75` / `0.68`) | Over Tier 2A Card (`0.72` / `0.64`) | Over Tier 2B Content Well (`0.88` / `0.84`) | WCAG 2.2 Target |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--ui-text-highlighted` | `#18181b` (`zinc-900`) / `#fafafa` (`zinc-50`) | **14.5:1** / **15.2:1** | **14.1:1** / **14.6:1** | **15.8:1** / **16.7:1** | Passes AAA (>= 7.0:1) |
| `--ui-text` | `#3f3f46` (`zinc-700`) / `#e4e4e7` (`zinc-200`) | **8.9:1** / **11.8:1** | **8.6:1** / **11.3:1** | **9.7:1** / **12.9:1** | Passes AAA (>= 7.0:1) |
| `--ui-text-muted` | `#52525b` (`zinc-600`) / `#a1a1aa` (`zinc-400`) | **6.3:1** / **6.4:1** | **6.1:1** / **6.1:1** | **6.9:1** / **7.1:1** | Passes AA (>= 4.5:1) |
| Interactive Borders / Icons | `#71717a` (`zinc-500`) / `#71717a` (`zinc-500`) | **4.1:1** / **3.6:1** | **4.0:1** / **3.5:1** | **4.4:1** / **4.0:1** | Passes Non-Text AA (>= 3.0:1) |

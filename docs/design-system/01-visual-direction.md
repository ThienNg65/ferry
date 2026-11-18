# 01 — Visual Direction & Minimalist Glassmorphism Philosophy

- **Parent Entrypoint:** [DESIGN.md](../../DESIGN.md)
- **Design Spec:** [2026-11-18-glassmorphism-ui-research-design.md](../superpowers/specs/2026-11-18-glassmorphism-ui-research-design.md)
- **Related Docs:** [02 — Styling & Tokens](./02-styling-and-tokens.md) · [03 — Typography System](./03-typography-system.md) · [04 — Design Patterns & Rollout](./04-design-patterns-and-rollout.md)

---

## 1. Executive Vision: Minimalist Glassmorphism for a Developer Utility

Ferry is a precision SFTP, SSH, and live remote log-tailing desktop client. Historically, developer tools have polarized into two extremes:
1. **Utilitarian Flat Grids:** Dense, opaque grey boxes with rigid 1px solid borders that feel heavy and dated.
2. **Conceptual Dribbble Showpieces:** Over-blurred, low-contrast translucent cards floating over chaotic neon wallpapers that look striking in a static screenshot but fail under 8 hours of daily terminal and file-management work.

Ferry's **Modern Minimalist Glassmorphism** direction synthesizes the best of both worlds:
- **Atmospheric Depth via Optical Translucency:** Floating chrome, session cards, and modal overlays behave like physical panes of precision-milled frosted glass (`backdrop-filter: blur() saturate()`), refracting a calm, colour-calibrated ambient canvas underneath.
- **Minimalist Restraint & Surgical Clarity:** Every border, shadow, and tint serves spatial hierarchy. Dense data viewports (`FileList`, `LogTailViewer`, `TerminalView`, `MonitorPanel`) sit inside high-legibility **Content Wells** (`0.82–0.92` alpha) framed by translucent chrome, ensuring WCAG 2.2 AA/AAA contrast and zero eye fatigue.
- **Opt-In Zero-Regression Rollout:** Controlled by the `glassUiEnabled` (`html.ferry-glass`, default `false`) feature switch in **Settings → Appearance**, allowing users to test and adopt the new visual language at their own pace without altering Ferry's classic mode.

---

## 2. Case Study: Mikołaj Gałęziowski (`dribbble.com/galeziowski`)

Our visual direction draws directly from **Mikołaj Gałęziowski's** landmark glassmorphism explorations on Dribbble—specifically his **Glassmorphism Big Sur Creative Cloud App Redesign** (Dark and Light variants), **Glassmorphism Big Sur Messenger App Redesign**, and **Smart Home / Onboarding** concepts.

### Deconstructing Gałęziowski's 4 Visual Pillars

| Visual Pillar | Gałęziowski's Technique | How Ferry Adapts It |
| :--- | :--- | :--- |
| **1. Multi-Layered Frosted Planes** | Separates the application shell into distinct optical planes using graduated blur radii (`12px` -> `16px` -> `24px`) and subtle opacity steps (`0.12`–`0.75`) so the user immediately perceives z-axis elevation without heavy drop-shadows. | Ferry defines a strict **3-Tier Glass Hierarchy**: Tier 1 App Chrome (`blur(16px)`), Tier 2 Workspace Cards & Framed Wells (`blur(12px–16px)`), and Tier 3 Floating Overlays (`blur(24px)`). |
| **2. 1px Specular Edge Refraction** | Real frosted glass catches light along its beveled top and outer edges. Gałęziowski outlines every translucent card with a razor-thin `1px` semi-transparent border (`rgba(255,255,255,0.22)` in dark, `rgba(255,255,255,0.65)` in light) plus a luminous top-inner highlight (`inset 0 1px 0 rgba(255,255,255,0.28)`). | Every `.ferry-glass-card` and `.ferry-glass-overlay` pairs a `1px solid var(--ferry-glass-*-border)` outer edge with `box-shadow: var(--ferry-glass-*-highlight), var(--ferry-glass-*-shadow)` to simulate top-down studio lighting. |
| **3. Diffused Chromatic Sub-Surface Backdrops** | Glass is invisible over a flat solid background. Gałęziowski places soft, out-of-focus radial mesh gradients behind the application shell so translucent panels pick up warm and cool chromatic tints as they overlap different regions of the canvas. | Ferry renders a dedicated, zero-idle-GPU `.ferry-ambient-canvas` behind `#app` using multi-stop `oklch()` radial gradients anchored to the user's chosen `accentColor` (`--ui-color-primary-500`) and complementary cool/warm ambient orbs. |
| **4. Soft Ambient Elevation Shadows** | Avoids muddy, high-opacity black shadows. Instead, uses wide, diffused ambient shadows (`0 12px 32px -4px rgba(0, 0, 0, 0.28)`) that anchor floating layers softly over the frosted plane below. | Tier 2 cards and Tier 3 modals use multi-layered ambient shadows tuned independently for Light mode (`rgba(15, 23, 42, 0.07)`) and Dark mode (`rgba(0, 0, 0, 0.42)`). |

### Key Restraint Lessons Applied to Ferry
While Gałęziowski's Dribbble shots sometimes use low-opacity (`0.15`–`0.25`) cards over saturated backgrounds for maximum showcase drama, a production SFTP client displaying thousands of filenames, permissions (`drwxr-xr-x`), and log lines requires a higher micro-tint floor:
- **Showcase Cards (`SessionManagerView`):** Can embrace lower opacity (`0.64` Dark / `0.72` Light) because the card layout is spacious and the ambient mesh shines through the surrounding canvas.
- **Dense Data Viewports (`FileList`, `LogTailViewer`):** Step up to **High-Legibility Content Wells** (`0.84` Dark / `0.88` Light) so background color shifts never reduce character contrast below 7:1 (WCAG AAA).

---

## 3. Material Physics: Light Mode ("Frosted Quartz") vs. Dark Mode ("Smoked Obsidian")

Translucent materials behave fundamentally differently in Light and Dark environments. Simply inverting background colors produces muddy grey glass in Light mode or washed-out milky panels in Dark mode.

| Material Property | Light Mode: "Frosted Quartz" (`html.ferry-glass`) | Dark Mode: "Smoked Obsidian" (`html.dark.ferry-glass`) | Optical Rationale |
| :--- | :--- | :--- | :--- |
| **Base Canvas (`--ferry-canvas-base`)** | `#f4f6fb` (`oklch(0.97 0.008 255)`) | `#090d16` (`oklch(0.15 0.02 260)`) | Cool porcelain base in Light prevents yellowing; deep midnight-slate in Dark gives rich depth behind smoked glass. |
| **Primary Ambient Orb** | `color-mix(in oklab, var(--ui-color-primary-400) 22%, transparent)` | `color-mix(in oklab, var(--ui-color-primary-500) 20%, transparent)` | Ties the entire glass atmosphere to the user's custom accent color preset or hex picker. |
| **Secondary Ambient Orb** | `oklch(0.85 0.10 300 / 0.16)` (Soft Lavender/Sky) | `oklch(0.35 0.14 295 / 0.18)` (Deep Indigo/Violet) | Provides subtle secondary chromatic refraction across the right pane (`Remote` / `Quick Connect`). |
| **Backdrop Saturation Boost** | `saturate(170%)` | `saturate(180%)` | Gaussian blur desaturates underlying colors; boosting saturation in `backdrop-filter` keeps refracted hues vibrant and crystalline. |
| **Card Surface Tint (`--ferry-glass-card-bg`)** | `rgba(255, 255, 255, 0.72)` | `rgba(15, 23, 42, 0.64)` | Warm white frost in Light; deep slate-tinted smoked glass in Dark. |
| **Content Well Tint (`--ferry-glass-well-bg`)** | `rgba(255, 255, 255, 0.88)` | `rgba(11, 15, 25, 0.84)` | High-legibility surface for virtualized file rows and log streams. |
| **Outer Specular Border (`1px`)** | `rgba(255, 255, 255, 0.75)` + `0 0 0 1px rgba(15, 23, 42, 0.06)` | `rgba(255, 255, 255, 0.14)` | Light mode needs both a bright inner glass rim and a hairline dark keyline to separate white glass from a light canvas. |
| **Top Inner Specular Highlight** | `inset 0 1px 0 0 rgba(255, 255, 255, 0.90)` | `inset 0 1px 0 0 rgba(255, 255, 255, 0.22)` | Simulates overhead light catching the top bevel of each card or dialog. |

---

## 4. The Static Ambient Mesh Canvas Architecture

Glassmorphism requires a non-uniform backdrop to refract. Ferry injects a single, fixed-position `.ferry-ambient-canvas` layer directly behind the application layout inside `App.vue` when `ui.glassUiEnabled` is `true`.

```mermaid
flowchart TD
    subgraph Viewport["WebView2 Viewport (html.ferry-glass)"]
        direction TB
        Canvas[".ferry-ambient-canvas<br/>position: fixed; inset: 0; z-index: 0;<br/>pointer-events: none;<br/>3 Radial/Conic oklch() Orbs + Base Surface"]
        Shell["App Shell (z-index: 10, bg-transparent)<br/>SiteTabBar + Main Workspace + BottomDock"]
        Modals["Teleported Overlays (z-index: 50)<br/>SettingsDialog, CommandPalette, Popovers, Toasts"]
    end
    Canvas -. "Refracted via backdrop-filter" .-> Shell
    Canvas -. "Refracted via backdrop-filter" .-> Modals
```

### Architectural Rules for `.ferry-ambient-canvas`
1. **Strictly Static at Rest (Zero Idle GPU Cost):**
   - Continuous `@keyframes` animations on a background layer underneath full-screen `backdrop-filter: blur()` surfaces force Chromium/WebView2 to invalidate and re-composite every blurred layer at 60Hz even when the app is completely idle.
   - Therefore, `.ferry-ambient-canvas` is **strictly static at rest**. It repaints only when the user toggles Light/Dark theme or picks a new `accentColor`.
2. **Accent-Reactive Chromatic Harmony:**
   - The top-left radial orb (`at 12% 8%`) derives directly from `var(--ui-color-primary-500)` via `color-mix(in oklab, ...)`. When the user clicks a preset or drags the HSV picker in **Settings → Appearance**, the ambient glow behind the glass shifts in real time.
3. **Seamless Windows 11 Native Titlebar Blending (`--ferry-caption-bg`):**
   - Because Ferry uses a native Windows titlebar (`borderless: false` in `neutralino.config.json`) colored via `DwmSetWindowAttribute(DWMWA_CAPTION_COLOR)` (`windowsWindow.ts`), the native titlebar can only paint a single opaque `0x00BBGGRR` color.
   - To prevent a harsh seam above `SiteTabBar`, the top edge of `.ferry-ambient-canvas` and `SiteTabBar` blends smoothly into `--ferry-caption-bg`—a 100% opaque color (`alpha === 255`) computed by mixing the base canvas with 6%–8% of `--ui-color-primary-500`.

---

## 5. The 3-Tier Glass + Content Well Hierarchy

To prevent visual chaos and avoid Chromium's nested `backdrop-filter` compositing trap, every surface in Ferry belongs to one of three explicit elevation tiers (or an unblurred child inside a tier):

```mermaid
flowchart LR
    subgraph T0["Layer 0: Backdrop"]
        A[".ferry-ambient-canvas<br/>(Static Mesh Gradient)"]
    end

    subgraph T1["Tier 1: App Chrome (--ferry-glass-chrome)"]
        B1["SiteTabBar.vue"]
        B2["FileToolbar.vue & PathBreadcrumb.vue"]
        B3["BottomDock.vue Header & Collapsed Rail"]
    end

    subgraph T2["Tier 2: Workspace Surfaces"]
        C1["Tier 2A: Frosted Cards (--ferry-glass-card)<br/>SessionManagerView: Sites, Quick Connect, SiteDetailsPanel"]
        C2["Tier 2B: Content Wells (--ferry-glass-well)<br/>FileList, LogTailViewer, TransferQueue, MonitorPanel"]
    end

    subgraph T3["Tier 3: Floating Overlays (--ferry-glass-overlay)"]
        D1["SettingsDialog, HistoryDialog, ShortcutsDialog"]
        D2["CommandPalette, FileVisibilityPopover, ContextMenu, Toasts"]
    end

    T0 --> T1
    T0 --> T2
    T0 --> T3
```

### Summary of Tiers

1. **Tier 1 — Structural App Chrome (`--ferry-glass-chrome`):**
   - **Components:** `SiteTabBar`, `FileToolbar`, `PathBreadcrumb`, `BottomDock` tab strip, collapsed Local pane rail, and pane status footers.
   - **Visuals:** `backdrop-filter: blur(16px) saturate(160%)`, moderate translucency (`0.75` Light / `0.68` Dark), `1px` hairline structural dividers (`--ferry-glass-chrome-border`).
2. **Tier 2A — Session Manager Frosted Cards (`--ferry-glass-card`):**
   - **Components:** `SessionManagerView` cards (`Sites` card, `Quick Connect` card, reconnect banner, `SiteDetailsPanel` slide-over).
   - **Visuals:** Full Gałęziowski showcase treatment (`backdrop-filter: blur(16px) saturate(170%)`, `0.72` Light / `0.64` Dark tint, `1px` specular border + top-inner highlight, soft ambient shadow).
3. **Tier 2B — Connected High-Legibility Content Wells (`--ferry-glass-well`):**
   - **Components:** `FileList` virtualized viewport, `LogTailViewer` log stream, `TransferQueue` list, `ActivityPanel`, `MonitorPanel` tables, and `OpenEditsPanel`.
   - **Visuals:** High-opacity translucent wells (`0.88` Light / `0.84` Dark) that let a whisper of the ambient warmth through while guaranteeing >= 7:1 text contrast and 60fps virtualized scrolling (zero `backdrop-filter` on individual rows).
4. **Tier 3 — Floating Overlays & Modals (`--ferry-glass-overlay`):**
   - **Components:** `SettingsDialog`, `CommandPalette`, `HistoryDialog`, `FilePreviewDialog`, `SyncDialog`, `CompareDialog`, `ChmodDialog`, `FileVisibilityPopover`, `ContextMenu`, `DropdownMenu`, and `UToaster` notifications.
   - **Visuals:** Highest refractive power (`backdrop-filter: blur(24px) saturate(180%)`), `0.78` Light / `0.72` Dark tint, luminous `1px` border + top specular edge, and deep elevation shadow.

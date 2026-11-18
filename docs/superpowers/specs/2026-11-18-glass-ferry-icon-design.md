# Approach B Design — Glassmorphism Ferry App Icon & Brand Integration

**Date:** 2026-11-18  
**Branch:** `fix/log-window-readiness`  
**Selected Approach:** **Approach B — Full Brand Replacement + Runtime Toggle Sync**

---

## 1. Intent & Scope

Redesign Ferry's app icon to align with the **Modern Minimalist Glassmorphism** design system (`html.ferry-glass` / `--ferry-ambient-mesh`) and surface it everywhere Ferry's icon or brand mark exists:

1. **Static Windows / Installer / Default Favicon Assets (`resources/` & `src/renderer/public/`):** Replace the existing flat-blue boat assets with the new Glassmorphism Ferry icon across all `.png` (`1024`, `60`, `40`, `20`) and `.ico` (`16`, `32`, `favicon.ico`, 7-resolution `icon.ico`) deliverables, preserving Win32 PE branding compatibility.
2. **Runtime Dynamic Favicon (`index.html` + `ui.store.ts`):** Dynamically swap `<link rel="icon">` whenever `ui.glassUiEnabled` toggles (`ferry-glass.svg` when enabled, `favicon-classic.ico` when disabled; `favicon.ico` defaults to the new Glass icon on disk).
3. **In-App `<FerryLogo />` Brand Component:** Introduce a crisp vector component (`src/renderer/src/components/shell/FerryLogo.vue`) that renders the Classic icon when `glassUiEnabled === false` and the Glassmorphism icon when `glassUiEnabled === true`, integrating it into:
   - `SiteTabBar.vue` (compact leading brand mark at left of tab bar)
   - `SessionManagerView.vue` (compact app identity header above the picker grid)
   - `SettingsDialog.vue` (`Updates & About` Ferry row + `Modern Glass UI` Appearance row)
   - `LegalConsentDialog.vue` (modal header brand mark)

---

## 2. Visual Design Specification

- **Preserved Silhouette:** Front-facing symmetrical ferry hull, upper bridge cabin with twin arched/rounded panes, central mast + navigation beacon light, and dual rhythmic horizon waves so Ferry stays immediately recognizable at `16×16` through `1024×1024`.
- **Glassmorphism Materiality:**
  - **Base Squircle:** Transparent exterior corners (`rx` continuous rounded squircle), deep atmospheric backdrop (`#0f172a` -> `#1e1b4b` -> `#0369a1`) layered with soft radial chromatic orbs (`#38bdf8` sky, `#818cf8` indigo, `#c084fc` violet) echoing `--ferry-ambient-mesh`, framed by a 1px translucent specular rim (`rgba(255,255,255,0.38)` top to `rgba(255,255,255,0.08)` bottom).
  - **Frosted Vessel & Cabin:** Multi-layer translucent white/ice-cyan frosted gradients (`0.78–0.94` alpha with subtle left/right bow facet contrast and inner specular top highlight) plus deep luminous indigo-tinted bridge windows.
  - **Translucent Wave Layers:** Overlapping frosted translucent wave ribbons with crisp bright specular upper crests along the waterline.
- **CSP & Offline Compliance:** Pure inline/bundled SVG + static `.png`/`.ico` files — zero remote URLs, zero external font/image requests.

---

## 3. Architecture & File Changes

1. **Master SVG & Asset Generation (`scripts/build-icons.mjs` or one-off generator script using headless Chromium + `resedit`):**
   - Author master vector sources `src/renderer/src/assets/ferry-glass.svg` and `src/renderer/src/assets/ferry-classic.svg`.
   - Preserve original classic favicon as `src/renderer/public/favicon-classic.ico`.
   - Render `ferry-glass.svg` into crisp transparent PNGs (`1024x1024`, `256x256`, `128x128`, `64x64`, `48x48`, `40x40`, `32x32`, `24x24`, `20x20`, `16x16`) and pack:
     - `resources/ferry.png` & `resources/1024x1024.png`
     - `resources/60x60.png`, `resources/40x40.png`, `resources/20x20.png`
     - `resources/16x16.ico`, `resources/32x32.ico`
     - `resources/favicon.ico` & `src/renderer/public/favicon.ico` (`16, 32, 48` 32bpp)
     - `resources/icon.ico` (`16, 24, 32, 48, 64, 128, 256` 32bpp — matching `pack-neutralino.mjs` & `smoke-neutralino-package.mjs`)
   - Copy `ferry-glass.svg` to `src/renderer/public/ferry-glass.svg` for instant high-DPI `<link rel="icon">` rendering.
2. **Dynamic Favicon & Component Integration:**
   - `src/renderer/src/stores/ui.store.ts`: Update `applyGlassUiClass(enabled)` to sync `<link rel="icon">` (`./ferry-glass.svg` `image/svg+xml` vs `./favicon-classic.ico` `image/x-icon`).
   - `src/renderer/src/components/shell/FerryLogo.vue`: Shared size-configurable SVG wrapper reacting cleanly to `ui.glassUiEnabled` (and optional `:variant="'glass' | 'classic' | 'auto'"` prop so Settings preview/icons remain explicit if needed).
   - Wire `<FerryLogo />` into `SiteTabBar.vue`, `SessionManagerView.vue`, `SettingsDialog.vue`, and `LegalConsentDialog.vue`.

---

## 4. Verification Plan

- Unit tests (`GlassUi.test.ts` / `ui.store.test.ts`): verify `<link rel="icon">` updates when toggling `setGlassUiEnabled(true/false)` and `deleteAllLocalData()`, and verify `<FerryLogo />` switches between Classic and Glass variants.
- Packaging & Windows Desktop Verification: `npm run typecheck`, `npm test`, `npm run package` (verifying `pack-neutralino.mjs` & `smoke-neutralino-package.mjs`), and `node test-env/scripts/verify-windows-desktop.mjs` (`peBranding` 7-resolution `.ico` match + `nsisInstall`).
- Visual Inspection: View rendered `1024x1024` / `60x60` / `16x16` Glass icon PNGs + live browser screenshots across `SiteTabBar`, `SessionManagerView`, `SettingsDialog`, and `LegalConsentDialog` in Light and Dark modes.

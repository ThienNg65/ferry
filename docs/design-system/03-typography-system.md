# 03 — Modern Typography System (`Plus Jakarta Sans` + `Cascadia Code / JetBrains Mono`)

- **Parent Entrypoint:** [DESIGN.md](../../DESIGN.md)
- **Design Spec:** [2026-11-18-glassmorphism-ui-research-design.md](../superpowers/specs/2026-11-18-glassmorphism-ui-research-design.md)
- **Related Docs:** [01 — Visual Direction](./01-visual-direction.md) · [02 — Styling & Tokens](./02-styling-and-tokens.md) · [04 — Design Patterns & Rollout](./04-design-patterns-and-rollout.md)

---

## 1. Figma "33 Modern Fonts" Research & Selection Rationale

To elevate Ferry's visual character alongside its Minimalist Glassmorphism surfaces, we surveyed the curated typefaces in [Figma's "33 Modern Fonts To Elevate Your Designs"](https://www.figma.com/resource-library/modern-fonts/) against the specific demands of an SFTP, SSH, and live log-tailing desktop application:
1. **High-Density Micro-Legibility (`10px`–`13px`):** File rows (`13px`), breadcrumb paths (`12px`), permission badges (`11px`), and dock counters (`10px`) must remain crisp over translucent `backdrop-filter: blur()` panels.
2. **Modern Geometric Warmth:** Avoid sterile default OS grotesque fonts while keeping the interface grounded as a serious engineering tool.
3. **Variable Font Axes (`wght` 400–700) & Open-Source Desktop Licensing (SIL OFL-1.1):** Must bundle cleanly as local `.woff2` variable font files with zero external network calls.

### Comparative Evaluation of Top Candidates from Figma's List

| Font Family | Category | Strengths on Glass Surfaces | Trade-Offs for Ferry | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Plus Jakarta Sans** | Geometric / Humanist Sans (Variable) | Tall x-height, generous open counters, subtle ink-trap geometry in weights `600`–`700`, and warm contemporary proportions that closely match Mikołaj Gałęziowski's Big Sur UI concepts. | Needs `font-variant-numeric: tabular-nums` explicitly set for numeric columns. | **Selected — Primary UI & Display (`--font-sans`)** |
| **Instrument Sans + Instrument Serif** | Neo-Grotesque + Editorial Serif | High-fashion studio contrast when pairing Sans UI with Serif hero headers. | Serif headers feel less native inside a utilitarian daily-driver SFTP/SSH workspace. | Documented as Alternative Editorial Concept |
| **Rethink Sans** | Adaptive Neo-Grotesque (Variable) | Ultra-clean apertures and compact width for dense data tables. | Less distinctive character in card headers and onboarding views than `Plus Jakarta Sans`. | Runner-up UI Sans |
| **Manrope** | Semi-Condensed Geometric Sans | Crisp numerals and modern tech personality. | Slightly narrow letterforms at `11px` (`--text-2xs`). | Not selected |
| **Cascadia Code + JetBrains Mono** | Technical Monospace (Variable) | Tall x-height, unmistakable `0`/`O` and `1`/`l`/`I` distinction, built specifically for terminals, file permissions (`rwxr-xr-x`), and log streams. | `JetBrains Mono` is not pre-installed on Windows; requires local `.woff2` bundling. | **Selected — Primary Monospace (`--font-mono`)** |

---

## 2. Optical Physics of Type on Translucent Surfaces

Rendering text over a `backdrop-filter: blur()` surface introduces subtle luminance gradients behind glyphs. Without typographic compensation, thin strokes appear to "bleed" or shimmer against the refracted background.

### 4 Mandatory Optical Rules Under `html.ferry-glass`

1. **No Sub-400 Weights (`font-weight >= 400`):**
   - Never use `font-light` (`300`) or `font-thin` (`100`–`200`) on translucent surfaces.
   - Body copy and file row names use `450`–`500` optical weight where appropriate (`400` Regular for standard rows, `500` Medium for active tabs, selected rows, and buttons, `600` SemiBold for card/modal titles).
2. **Tightened Display Tracking, Open Micro Tracking:**
   - Card headers (`16px`–`18px`, weight `600`): `letter-spacing: -0.015em` for a tight, crafted studio look.
   - Micro badges & uppercase section headers (`10px`–`11px`, weight `600`): `letter-spacing: 0.03em` to prevent glyph crowding over blurred backdrops.
3. **Mandatory Tabular Numerals (`tabular-nums`) for Dynamic & Columnar Data:**
   - `Plus Jakarta Sans` defaults to proportional numerals in running prose.
   - Every numeric column or live counter—file sizes (`FileRow.vue`), modified timestamps (`FileRow.vue`), transfer speeds/percentages (`TransferQueue.vue`), port numbers (`SessionManagerView.vue`), and CPU/RAM metrics (`MonitorPanel.vue`)—**must** apply `tabular-nums` (`font-variant-numeric: tabular-nums`) so digits align vertically and never jitter during live updates.
4. **Subpixel Antialiasing & OpenType Stylistic Sets:**
   - Enable `font-feature-settings: "ss01"` scoped strictly to `--font-sans` elements (never globally on `html.ferry-glass` where it would bleed into `JetBrains Mono`'s character variants) for clean single-story `a` and disambiguated `I`/`l` legibility in filenames.

---

## 3. Type Scale & Token Mapping (`main.css`)

Ferry's existing custom font-size tokens in [`src/renderer/src/assets/main.css`](../../src/renderer/src/assets/main.css) (`--text-row`, `--text-meta`, `--text-2xs`, `--text-3xs`) are preserved so layout density (`comfortable` vs. `compact`) never shifts when toggling `glassUiEnabled`.

### Typography Scale Matrix

| Token / Role | Size (`rem` / `px`) | Line Height | Font Family | Weight | Tracking & Features | Primary Consumers |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **View / Card Title (`text-lg` / `text-base`)** | `1.125rem` (`18px`) / `1rem` (`16px`) | `1.5rem` (`24px`) | `--font-sans` (`Plus Jakarta Sans`) | `600` (SemiBold) | `-0.015em` | `SessionManagerView` ("Sites", "Quick Connect"), `SettingsDialog` section headers |
| **Dialog / Section Header (`text-sm`)** | `0.875rem` (`14px`) | `1.25rem` (`20px`) | `--font-sans` (`Plus Jakarta Sans`) | `600` (SemiBold) | `-0.01em` | Modal titles, `SiteDetailsPanel` title, empty-state headers |
| **File Row & Primary UI (`--text-row`)** | `0.8125rem` (`13px`) | `1.125rem` (`18px`) | `--font-sans` (`Plus Jakarta Sans`) | `400` / `500` (Selected) | `0em`, `tabular-nums` on size/date | `FileRow.vue` filenames, `SiteRow.vue` names, form inputs |
| **Chrome & Controls (`--text-meta` / `text-xs`)** | `0.75rem` (`12px`) | `1rem` (`16px`) | `--font-sans` (`Plus Jakarta Sans`) | `500` (Medium) | `0em` | `SiteTabBar` tabs, `BottomDock` tabs, `FileToolbar` buttons, `PathBreadcrumb` |
| **Secondary Metadata (`--text-2xs`)** | `0.6875rem` (`11px`) | `1rem` (`16px`) | `--font-sans` or `--font-mono` | `400` / `500` | `0.01em`, `tabular-nums` | Host labels (`user@host:22`), transfer speeds, keyboard `<kbd>` hints |
| **Micro Badges (`--text-3xs`)** | `0.625rem` (`10px`) | `0.875rem` (`14px`) | `--font-mono` (`Cascadia / JetBrains`) | `600` (SemiBold) | `0.02em`, `tabular-nums` | Dock unread counters, environment pills (`PROD`/`STAGE`), `Ctrl+\`` hints |
| **Log Stream & Terminal** | User-configurable (`13px` default) | `1.35` default | `--font-mono` (`Cascadia / JetBrains`) | `400` / `600` (Matches) | `tabular-nums`, ligatures optional | `LogTailViewer.vue`, `TerminalView.vue`, `ChmodDialog` octal/rwx |

---

### Exact CSS Specification for `src/renderer/src/assets/main.css`

```css
/* Local Variable Font Declarations (Zero external network requests) */
@font-face {
  font-family: 'Plus Jakarta Sans Variable';
  font-style: normal;
  font-weight: 400 700;
  font-display: block;
  src: url('./fonts/PlusJakartaSans-Variable.woff2') format('woff2-variations');
}

@font-face {
  font-family: 'JetBrains Mono Variable';
  font-style: normal;
  font-weight: 400 700;
  font-display: block;
  src: url('./fonts/JetBrainsMono-Variable.woff2') format('woff2-variations');
}

/* Activate modern font stack only when Glass UI feature switch is enabled */
html.ferry-glass {
  --font-sans: 'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', -apple-system, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'Cascadia Code', 'JetBrains Mono Variable', 'JetBrains Mono', 'SF Mono', Consolas, monospace;
}

/* Enforce tabular numerals on all file metadata, transfer counters, and monitor tables */
html.ferry-glass .tabular-nums,
html.ferry-glass [data-numeric='true'] {
  font-variant-numeric: tabular-nums;
}
```

---

## 4. Offline Local `.woff2` Asset Bundling & License Compliance

### Why Local Bundling is Non-Negotiable
Ferry is an SSH/SFTP desktop tool frequently operated inside corporate VPNs, bastion-jumped subnets, or air-gapped environments where outbound HTTPS requests to `fonts.googleapis.com` or `fonts.gstatic.com` will time out or violate strict CSP/privacy guarantees (`PRIVACY.md` explicitly promises zero external network tracking or third-party asset fetches).

### Asset Paths & Size Budget
- `src/renderer/src/assets/fonts/PlusJakartaSans-Variable.woff2` (Latin + Latin-Ext subset, `wght` 400–700): **~34 KB**
- `src/renderer/src/assets/fonts/JetBrainsMono-Variable.woff2` (Latin + Box Drawing / Technical subset, `wght` 400–700): **~42 KB**
- **Total Installer Delta:** **~76 KB** (< 0.35% of Ferry's 22.25 MB Neutralino NSIS installer).
- Using `font-display: block` on local `file://` / Neutralino `http://127.0.0.1` resources resolves in `< 3 ms` with zero Flash of Unstyled Text (FOUT).

### License Attribution (`scripts/generate-third-party-licenses.mjs`)
Both **Plus Jakarta Sans** (designed by Tokotype) and **JetBrains Mono** (designed by JetBrains) are licensed under the **SIL Open Font License 1.1 (OFL-1.1)**.
During Phase 2 implementation, [`scripts/generate-third-party-licenses.mjs`](../../scripts/generate-third-party-licenses.mjs) (including its font-disclaimer comment on line 130) must be updated to append the OFL-1.1 copyright and license blocks for both bundled fonts into `THIRD_PARTY_LICENSES.txt` so the in-app **Settings → Privacy & Legal → Licenses** viewer remains 100% compliant.

---

## 5. Terminal Appearance Integration (`terminalAppearance.ts`)

Today, [`src/renderer/src/utils/terminalAppearance.ts`](../../src/renderer/src/utils/terminalAppearance.ts) includes a `'jetbrains-mono'` font option (`family: 'JetBrains Mono'`) that relies on `fontInstalled.ts` (`isFontInstalled('JetBrains Mono')` in `TerminalAppearanceSettings.vue:42`) to check whether the user has manually installed JetBrains Mono in Windows.

By bundling `JetBrainsMono-Variable.woff2` in the renderer:
1. Updating the `'jetbrains-mono'` font stack in `terminalAppearance.ts` to `'JetBrains Mono Variable', 'JetBrains Mono', monospace` and treating `'jetbrains-mono'` as a bundled built-in font in `TerminalAppearanceSettings.vue` (bypassing `isFontInstalled`, which only detects OS-installed fonts on a synchronous 2D canvas) guarantees every user can select **JetBrains Mono** in **Settings → Terminal** without installing external system fonts.
2. When `glassUiEnabled` is `true`, all monospace UI elements outside the terminal (`LogTailViewer`, `PathBreadcrumb` raw inputs, `ChmodDialog` octal codes, and `KnownHosts` SHA-256 fingerprints) automatically render in crisp `Cascadia Code` (Windows 11) or bundled `JetBrains Mono Variable` (Windows 10 fallback).

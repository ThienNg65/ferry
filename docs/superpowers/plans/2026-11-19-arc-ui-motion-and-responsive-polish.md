# Arc UI Motion, Micro-Interactions & Responsive Slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Arc UI-inspired motion token system (`--ferry-motion-*`, critically damped CSS `linear()` spring curve with `bounce: 0`, faster `140ms` exits), micro-interaction safeguards (popup-anchor press guard, `300ms` sibling tooltip warmup, `280ms` destructive pointer double-click guard, directional dock panel transitions), and container-first responsive slot rules (`@container`, overflow edge masks, `touch-action` discipline) across Ferry's Vue 3.5 / Nuxt UI v4.9 renderer while strictly preserving Minimalist Glassmorphism (`html.ferry-glass`) and Classic UI (`glassUiEnabled: false`).

**Architecture:** A typed JS/WAAPI motion constant module (`src/renderer/src/utils/motionTokens.ts`) and expanded CSS custom properties in `src/renderer/src/assets/main.css` supply unified durations, asymmetric enter/exit curves, critically damped `linear()` springs, concentric corner radii, and modality-clean focus/hover guards. Shell, file-explorer, session-manager, and destructive confirmation components consume these primitives without altering `.ferry-glass-*` surface blurs or unmounting `TerminalView.vue`.

**Tech Stack:** Vue 3.5, TypeScript, Nuxt UI v4.9 (Reka UI `TooltipProvider`), Tailwind CSS v4.0 (`@container`), CSS Custom Properties (`linear()`, `@starting-style`), Web Animations API, Vitest (`happy-dom`).

**Specs:**
- [DESIGN.md](../../../DESIGN.md)
- [docs/motion-system.md](../../motion-system.md)
- [01 — Visual Direction](../../design-system/01-visual-direction.md)
- [02 — Styling & Tokens](../../design-system/02-styling-and-tokens.md)
- [03 — Typography System](../../design-system/03-typography-system.md)
- [04 — Design Patterns & Rollout](../../design-system/04-design-patterns-and-rollout.md)

## Global Constraints

- **Zero Classic or Glass Regression:** Keep all existing `.ferry-glass-*` surface blurs, opacities, and Nuxt UI portal selectors intact, and keep Classic mode (`glassUiEnabled: false`) visually unchanged aside from shared interaction motion and accessibility guards.
- **No `filter: blur()` on Glass Surfaces:** Never animate `filter: blur()` on or inside any element with `backdrop-filter: blur()` (prevents Chromium Backdrop Root glitches). Use `opacity` + `transform` only.
- **Never Unmount `TerminalView.vue` or Animate Virtualized Rows:** Preserve `v-show` on `BottomDock` / `TerminalView` (and skip exit fade when switching to Terminal/Log Tail), and keep zero transitions on individual virtualized rows (`FileRow.vue`, `TransferQueue.vue`, `LogTailViewer.vue`).
- **Destructive `280ms` Guard Compatibility:** In `ConfirmDialog.vue`, guard only real pointer double-clicks (`event instanceof MouseEvent && event.detail > 0 && performance.now() - openedAt < 280`) so keyboard activation (`Enter` / `Space`, where `detail === 0`) and synthetic unit tests remain instant.
- **NPM Registry Rule:** Always pass `--registry=https://registry.npmjs.org` if invoking `npx` / `npm` for public packages.

## Review Focus

1. **Chromium `backdrop-filter` & `@starting-style` Portal Safety:** Tier 3 portal rules (`[role="dialog"]`, `[data-reka-popper-content-wrapper]`, `[data-slot="viewport"] > li`) in `main.css` must keep `backdrop-filter: var(--ferry-glass-overlay-blur)` intact while adding `@starting-style` opacity/transform entrances—never add `filter: blur()` or `will-change` permanently at rest.
2. **Popup-Anchor Press Guard (`aria-haspopup` / `data-state="open"` / `aria-expanded="true"`):** Buttons that open popovers, dropdowns, or context menus must suppress `:active` `scale()` so Reka UI / Floating UI never measures a shrunken trigger rect.
3. **Keyboard Arrow Instantaneity & Terminal Focus:** Directional slide offsets on `.dock-panel` must never apply to `TerminalView` or `LogTailViewer`, and `:focus:not(:focus-visible)` must remove lingering pointer focus rings without hiding `:focus-visible` keyboard outlines.
4. **Destructive Double-Click Guard Precision:** `ConfirmDialog.vue` must ignore rapid pointer clicks (`event.detail > 0`) within `280ms` of dialog mount **only** when `destructive` is `true`, while allowing keyboard `Enter`/`Space` and all non-destructive confirmations immediately.

---

### Task 1: Canonical Motion Tokens, Critically Damped `linear()` Spring, Asymmetric Exit Curves & Modality Guards

**Files:**
- Create: `src/renderer/src/utils/motionTokens.ts`
- Test: `src/renderer/src/utils/__tests__/motionTokens.test.ts`
- Modify: `src/renderer/src/assets/main.css`
- Modify: `src/renderer/src/components/files/FileList.vue`

**Interfaces:**
- Produces (`src/renderer/src/utils/motionTokens.ts`):
  - `export const FERRY_MOTION_TOKENS` (`duration: { instant: 100, fast: 120, exit: 140, standard: 170, panel: 210, considered: 360, spring: 440 }`, `ease: { emphasized, standard, out, exit, inOut, spring }`, `stagger: { char: 16, item: 35, word: 40, line: 80, maxTotal: 250 }`)
  - `export function prefersReducedMotion(): boolean`
  - `export function computeCappedStaggerDelay(index: number, stepMs?: number, maxTotalMs?: number): number`
- Consumes (`FileList.vue`): `FERRY_MOTION_TOKENS.duration.standard`, `FERRY_MOTION_TOKENS.ease.out`, and `prefersReducedMotion()` inside the directory navigation WAAPI watcher.

- [ ] **Step 1: Write failing unit tests in `src/renderer/src/utils/__tests__/motionTokens.test.ts`**

Cover:
1. `FERRY_MOTION_TOKENS.duration` matches canonical ms values (`instant: 100`, `fast: 120`, `exit: 140`, `standard: 170`, `panel: 210`, `considered: 360`, `spring: 440`) and `exit < standard`.
2. `FERRY_MOTION_TOKENS.ease` exposes valid CSS timing strings for `emphasized`, `standard`, `out`, `exit`, `inOut`, and `spring` (`linear(0, ... 1)`).
3. `computeCappedStaggerDelay(index, stepMs, maxTotalMs)` returns `0` for `index <= 0`, scales linearly for small counts (`index * stepMs`), clamps at `maxTotalMs` (`250ms` default), and returns `0` when `prefersReducedMotion()` is `true`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/utils/__tests__/motionTokens.test.ts`
Expected: FAIL because `motionTokens.ts` does not exist yet.

- [ ] **Step 3: Implement `src/renderer/src/utils/motionTokens.ts` and update `FileList.vue`**

1. Create `src/renderer/src/utils/motionTokens.ts` with `FERRY_MOTION_TOKENS`, `prefersReducedMotion()`, and `computeCappedStaggerDelay()`.
2. Update `src/renderer/src/components/files/FileList.vue` (`lines 66–76`) to use `prefersReducedMotion()`, `FERRY_MOTION_TOKENS.duration.standard`, and `FERRY_MOTION_TOKENS.ease.out` instead of hardcoded `'170'` / `'cubic-bezier(0.2, 0.8, 0.2, 1)'` / inline `matchMedia`.

- [ ] **Step 4: Update `src/renderer/src/assets/main.css`**

Apply these scoped updates while preserving every existing `.ferry-glass-*` and scrollbar rule:
1. Add `--ferry-motion-instant: 100ms`, `--ferry-motion-exit: 140ms`, `--ferry-motion-considered: 360ms`, `--ferry-motion-spring: 440ms`, `--ferry-motion-ease-standard: cubic-bezier(0.22, 1, 0.36, 1)`, `--ferry-motion-ease-exit: cubic-bezier(0.7, 0, 0.84, 0)`, `--ferry-motion-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)`, and the 37-point `--ferry-motion-ease-spring: linear(...)` in `:root`.
2. Add concentric radius tokens under `html.ferry-glass`:
   - `--ferry-radius-card: 0.75rem;`
   - `--ferry-radius-overlay: 0.75rem;`
   - `--ferry-radius-inner: 0.5rem;`
   - `--ferry-radius-badge: 0.375rem;`
3. Separate `*-enter-active` and `*-leave-active` rules for `.fade`, `.slide-right`, `.slide-down`, `.slide-up`, `.dock-fade`, `.dock-panel`, and `.site-tab` so exits use `var(--ferry-motion-exit) var(--ferry-motion-ease-exit)`, `.slide-up-enter-active` and `.site-tab-move` use `var(--ferry-motion-spring) var(--ferry-motion-ease-spring)` (`bounce: 0`), and `.dock-panel-enter-from` uses `transform: translate3d(var(--ferry-dock-slide-x, 0px), 6px, 0)`.
4. Add modality-clean focus suppression and popup-anchor press guards:
   - `:focus:not(:focus-visible) { outline: none; }`
   - `.ferry-dock-tab:active:not(:disabled):not([aria-haspopup]):not([data-state='open']):not([aria-expanded='true']), .ferry-pressable:active:not(:disabled):not([aria-haspopup]):not([data-state='open']):not([aria-expanded='true']) { transform: scale(0.975); }`
5. Wrap `.ferry-glass-inactive-tab:hover` and `.ferry-site-row:hover` in `@media (hover: hover) and (pointer: fine)` to prevent sticky touch hover states.
6. Add `@starting-style` entrance (`opacity: 0; transform: translateY(4px) scale(0.97)`) and `transition: opacity var(--ferry-motion-fast) var(--ferry-motion-ease-emphasized), transform var(--ferry-motion-spring) var(--ferry-motion-ease-spring)` on Tier 3 teleported glass dialogs/popovers (`html.ferry-glass [role="dialog"]` and `html.ferry-glass [data-reka-popper-content-wrapper] > :not([role="tooltip"]):not(:has([role="tooltip"]))`).

- [ ] **Step 5: Run tests to verify Task 1 passes**

Run: `npx vitest run src/renderer/src/utils/__tests__/motionTokens.test.ts src/renderer/src/components/files/__tests__/FileList.test.ts` (and verify any `FileList` test path if named differently under `src/renderer/src/`).
Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/renderer/src/utils/motionTokens.ts src/renderer/src/utils/__tests__/motionTokens.test.ts src/renderer/src/assets/main.css src/renderer/src/components/files/FileList.vue
git commit -m "feat(ui): add Arc UI motion tokens, linear() spring curve, and modality guards"
```

---

### Task 2: Shell & Navigation Motion Polish — Tooltip Warmup, Overflow Edge Masks & Directional Dock Panels

**Files:**
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/components/shell/SiteTabBar.vue`
- Modify: `src/renderer/src/components/shell/BottomDock.vue`
- Modify: `src/renderer/src/components/shell/__tests__/GlassUi.test.ts`

**Interfaces:**
- `App.vue`: Passes `:tooltip="{ delayDuration: 250, skipDelayDuration: 300 }"` to `<UApp>` and `touch-none select-none` on the vertical pane splitter.
- `SiteTabBar.vue`: Uses `.ferry-scroll-fade-x scrollbar-none touch-pan-x` + horizontal wheel scrolling (`onTabStripWheel`) on `<nav>`, and animates the active bottom pill indicator via `transform` (`scale-x-100` vs `scale-x-75 opacity-80`) using `--ferry-motion-standard` and `--ferry-motion-ease-emphasized`.
- `BottomDock.vue`: Tracks logical tab index transitions across `dockTabs` to bind `--ferry-dock-slide-x` (`8px` / `-8px`) on the non-terminal/non-tail panel container and applies `ferry-scroll-fade-x touch-pan-x` to both the dock tab strip and log-tail tab strip.

- [ ] **Step 1: Add assertions in `src/renderer/src/components/shell/__tests__/GlassUi.test.ts`**

Add focused test cases verifying:
1. `SiteTabBar.vue` renders `.ferry-scroll-fade-x` and `touch-pan-x` on the `<nav>` tab container, and updates active bottom indicator transform class (`scale-x-100` vs `scale-x-75`) when switching tabs.
2. `App.vue` configures `<UApp>` with tooltip warmup props (`delayDuration: 250`, `skipDelayDuration: 300`).

- [ ] **Step 2: Run `GlassUi.test.ts` to verify new assertions fail first**

Run: `npx vitest run src/renderer/src/components/shell/__tests__/GlassUi.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement updates in `App.vue`, `SiteTabBar.vue`, and `BottomDock.vue`**

1. **`src/renderer/src/App.vue`**:
   - Pass `:tooltip="{ delayDuration: 250, skipDelayDuration: 300 }"` on `<UApp>` (supported natively by Nuxt UI's `TooltipProvider`).
   - Add `touch-none select-none` to the pane resizer handle (`role="separator"`).
2. **`src/renderer/src/components/shell/SiteTabBar.vue`**:
   - Add `ferry-scroll-fade-x scrollbar-none touch-pan-x` and `@wheel="onTabStripWheel"` to `<nav aria-label="Open connections">`.
   - Update the bottom active indicator `<span>` inside each `.ferry-site-tab` (lines 217–222) to animate with `transition-all duration-[var(--ferry-motion-standard)] ease-[var(--ferry-motion-ease-emphasized)]` (`scale-x-100` when active, `scale-x-75 opacity-80` when inactive).
   - Add `ferry-pressable` to interactive non-popup action buttons (`New tab`, theme toggle, settings, history, local pane toggle) while keeping `UDropdownMenu` / `ContextMenu` triggers free of press shrink.
3. **`src/renderer/src/components/shell/BottomDock.vue`**:
   - Watch `tab` transitions against `dockTabs` index order (`dockSlideX = ref(0)` -> `nextIdx > prevIdx ? 8 : -8`) so `.dock-panel` slides directionally across `transfers`, `activity`, `monitor`, and `edits` (never affecting `terminal` or `tail`, which remain `v-show`).
   - Bind `:style="{ '--ferry-dock-slide-x': `${dockSlideX}px` }"` on the `.ferry-glass-well` / dock panel container.
   - Add `touch-pan-x` alongside `ferry-scroll-fade-x` on the dock tab strip (`line 350`) and `ferry-scroll-fade-x touch-pan-x` on the log-tail tab strip (`line 474`).

- [ ] **Step 4: Run `GlassUi.test.ts` and `UpdateUi.test.ts` to verify Task 2 passes**

Run: `npx vitest run src/renderer/src/components/shell/__tests__/GlassUi.test.ts src/renderer/src/components/shell/__tests__/UpdateUi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/renderer/src/App.vue src/renderer/src/components/shell/SiteTabBar.vue src/renderer/src/components/shell/BottomDock.vue src/renderer/src/components/shell/__tests__/GlassUi.test.ts
git commit -m "feat(ui): add tooltip warmup, overflow edge masks, and directional dock motion"
```

---

### Task 3: File Explorer, Session Manager & Destructive Confirmation Polish

**Files:**
- Modify: `src/renderer/src/components/files/PathBreadcrumb.vue`
- Modify: `src/renderer/src/components/files/FileToolbar.vue`
- Modify: `src/renderer/src/components/sessions/SessionManagerView.vue`
- Modify: `src/renderer/src/components/shell/ConfirmDialog.vue`
- Create: `src/renderer/src/components/shell/__tests__/ConfirmDialog.test.ts`

**Interfaces:**
- `PathBreadcrumb.vue`: Adds `ferry-scroll-fade-x touch-pan-x` when `!effectiveShorten` and raises the narrow auto-shorten container threshold to `stripWidth.value < 300`.
- `FileToolbar.vue`: Refines expanding search `<UInput>` transition to `duration-[var(--ferry-motion-standard)] ease-[var(--ferry-motion-ease-emphasized)]`.
- `SessionManagerView.vue`: Uses `@container` + `@[860px]:grid-cols-[1.2fr_1fr] @[860px]:items-start`, `name="slide-up" mode="out-in"` for the `SiteDetailsPanel` / `Quick Connect` swap, `text-balance` / `text-pretty` on empty-state copy, and `:aria-busy` on async buttons (`Connect`, `Reconnect`, `Save as site`).
- `ConfirmDialog.vue`: Records `const openedAt = performance.now()` on mount/open and guards `onConfirm(event?: Event)` on `destructive` actions when `event instanceof MouseEvent && event.detail > 0 && performance.now() - openedAt < 280`.

- [ ] **Step 1: Write failing unit tests in `src/renderer/src/components/shell/__tests__/ConfirmDialog.test.ts`**

Cover:
1. When `destructive: true`, a pointer click (`detail: 1`) occurring `< 280ms` after dialog mount does **not** invoke `action` or emit `close`.
2. After advancing timers by `280ms` (using `vi.useFakeTimers()`), clicking the confirm button invokes `action` and emits `close(true)`.
3. Keyboard activation (`detail: 0`) on a `destructive: true` confirm button succeeds immediately without waiting `280ms`.
4. Non-destructive confirmations (`destructive: false`) execute immediately regardless of elapsed time, and `aria-busy="true"` / `aria-disabled="true"` are applied while `action` is pending.

- [ ] **Step 2: Run `ConfirmDialog.test.ts` to verify it fails**

Run: `npx vitest run src/renderer/src/components/shell/__tests__/ConfirmDialog.test.ts`
Expected: FAIL because the `280ms` guard and `aria-busy` attributes are not yet implemented.

- [ ] **Step 3: Implement updates in `PathBreadcrumb.vue`, `FileToolbar.vue`, `SessionManagerView.vue`, and `ConfirmDialog.vue`**

1. **`src/renderer/src/components/files/PathBreadcrumb.vue`**:
   - Raise auto-collapse threshold in `effectiveShorten` from `stripWidth.value < 240` to `stripWidth.value < 300`.
   - Use `'overflow-hidden' : 'ferry-scroll-fade-x overflow-x-auto scrollbar-none touch-pan-x'` on the breadcrumb strip container.
2. **`src/renderer/src/components/files/FileToolbar.vue`**:
   - Update `<UInput>` width transition classes to `transition-[width] duration-[var(--ferry-motion-standard)] ease-[var(--ferry-motion-ease-emphasized)]`.
3. **`src/renderer/src/components/sessions/SessionManagerView.vue`**:
   - Add `@container` to the root scroll container (`line 584`) and replace `md:grid-cols-[1.2fr_1fr] md:items-start` (`line 656`) with `@[860px]:grid-cols-[1.2fr_1fr] @[860px]:items-start`.
   - Update `<Transition name="fade" mode="out-in">` around `SiteDetailsPanel` / `Quick Connect` (`line 815`) to `<Transition name="slide-up" mode="out-in">`.
   - Add `text-balance` to empty-state heading and `text-pretty` to empty-state description (`lines 717–720`).
   - Add `:aria-busy="sessions.connecting"` and `:aria-busy="savingQuickSite"` alongside `:loading` on async action buttons (`lines 633, 648, 939–957`).
4. **`src/renderer/src/components/shell/ConfirmDialog.vue`**:
   - Capture `const openedAt = performance.now()`.
   - Update `onConfirm(event?: Event)` so when `props.destructive && event instanceof MouseEvent && event.detail > 0 && performance.now() - openedAt < 280`, the click is safely ignored to prevent accidental double-click destruction.
   - Bind `:aria-busy="busy"` and `:aria-disabled="busy"` on the confirm `<UButton>` and pass `onConfirm($event)`.

- [ ] **Step 4: Run Task 3 tests and full renderer test + typecheck verification**

Run:
1. `npx vitest run src/renderer/src/components/shell/__tests__/ConfirmDialog.test.ts`
2. `npm run test` (or `npx vitest run`) and `npm run typecheck` (checking exact script names in `package.json` when executing).
Expected: PASS across all tests with zero TypeScript errors.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/renderer/src/components/files/PathBreadcrumb.vue src/renderer/src/components/files/FileToolbar.vue src/renderer/src/components/sessions/SessionManagerView.vue src/renderer/src/components/shell/ConfirmDialog.vue src/renderer/src/components/shell/__tests__/ConfirmDialog.test.ts
git commit -m "feat(ui): apply container breakpoints, breadcrumb masks, and destructive double-click guard"
```

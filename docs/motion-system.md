# Ferry motion system and micro-interactions

- Parent entrypoint: [DESIGN.md](../DESIGN.md)
- Related docs: [01: Visual direction](./design-system/01-visual-direction.md) · [02: Styling and tokens](./design-system/02-styling-and-tokens.md) · [03: Typography system](./design-system/03-typography-system.md) · [04: Design patterns and rollout](./design-system/04-design-patterns-and-rollout.md)

Motion makes state changes legible without delaying SSH/SFTP tasks. Ferry combines the restraint a daily-driver desktop utility needs with the motion approach of [Arc UI (`uiarc.dev`)](https://uiarc.dev/docs/motion): physical cause-and-effect, critically damped curves with zero state overshoot, full interruptibility, and GPU compositor safety across both Classic and Modern Glass modes.

---

## 1. Core motion principles (Arc UI and desktop guardrails)

1. Physical cause and effect, zero overshoot on state (`bounce: 0`):
   - Motion always originates from the user's trigger point (`transform-origin` matched to popper placement or click coordinate).
   - State-carrying transitions (switches, dock height, drawers, progress bars, live numeric counters, and active tab indicators) must use critically damped curves (`bounce: 0` / `--ferry-motion-ease-spring`) so they never bounce past and display a false state.
2. Exits are quicker than entrances:
   - Entrances invite focus (`--ferry-motion-standard: 170ms` to `--ferry-motion-panel: 210ms` using `--ferry-motion-ease-emphasized: cubic-bezier(0.16, 1, 0.3, 1)`).
   - Exits get out of the user's way promptly (`--ferry-motion-exit: 140ms` using `--ferry-motion-ease-exit: cubic-bezier(0.7, 0, 0.84, 0)`).
3. Full interruptibility (mid-flight reversal):
   - Animations must never lock input or snap awkwardly when toggled rapidly. Prefer interruptible CSS transitions (paired with `@starting-style` for newly mounted popovers) and FLIP/transform animations that reverse velocity cleanly mid-flight.
4. Pointer glide and keyboard immediacy:
   - Pointer clicks and hover highlights glide smoothly on springs and eased transitions.
   - Repeated keyboard navigation (holding `ArrowDown`/`ArrowUp` in `FileList`, `CommandPalette`, `SiteRow`, or dropdown menus) must update focus and selection immediately with zero trailing animation lag.
5. Popup-anchor press guard:
   - Buttons apply a subtle width-adaptive `:active` press scale, except when the button anchors a floating overlay (`[aria-haspopup]`, `[data-state="open"]`, `[aria-expanded="true"]`). Suppressing `:active` `scale()` on popup triggers prevents Reka UI / Floating UI from measuring a shrunken trigger rect when positioning menus and popovers.
6. Off-main-thread and zero-jank frame discipline:
   - Continuous pointer drags (pane splitters, `BottomDock` height resize, HSV color pickers) disable CSS transitions during drag frames (`!transition-none`) and avoid per-frame Vue component re-renders.
   - Any looping indicator (transfer shimmer, connection pulse) pauses when offscreen (`IntersectionObserver`) or when the window/tab is hidden (`document.hidden`).

---

## 2. Motion tokens

### CSS duration tokens (`src/renderer/src/assets/main.css`)

| Token | Value | Role and usage |
| :--- | :--- | :--- |
| `--ferry-motion-instant` | `100ms` | Immediate button press scale, active state snap (`duration.instant`). |
| `--ferry-motion-fast` | `120ms` | Micro-feedback, opacity fades, hover background tints (`fade-enter-active`). |
| `--ferry-motion-exit` | `140ms` | Popover, modal, toast, and dock panel exits (`duration.exit`). |
| `--ferry-motion-standard` | `170ms` | Dock panel contents, tab underline indicators, inline form slides. |
| `--ferry-motion-panel` | `210ms` | `BottomDock` expand/collapse, `SiteDetailsPanel` slide-over, ambient mesh shift. |
| `--ferry-motion-considered` | `360ms` | Deliberate multi-stage reveals, SVG checkmark stroke draw, morph completion. |
| `--ferry-motion-spring` | `440ms` | Paired exclusively with `--ferry-motion-ease-spring` for critically damped spring motion. |

### Easing curves

| Token | Definition | Usage |
| :--- | :--- | :--- |
| `--ferry-motion-ease-emphasized` | `cubic-bezier(0.16, 1, 0.3, 1)` | Panel entrances, active tab indicators, rising elements (Arc UI `--ease-enter`). |
| `--ferry-motion-ease-standard` | `cubic-bezier(0.22, 1, 0.36, 1)` | Balanced general UI movement (Arc UI `--ease-standard`). |
| `--ferry-motion-ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Content settling, ambient mesh transitions. |
| `--ferry-motion-ease-exit` | `cubic-bezier(0.7, 0, 0.84, 0)` | Fast exit acceleration for departing overlays and panels (Arc UI `--ease-exit`). |
| `--ferry-motion-ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Symmetric on-screen state shifts (Arc UI `--ease-in-out`). |
| `--ferry-motion-ease-spring` | `linear(0, 0.0213, 0.0739, ... 1)` | Critically damped spring curve (`bounce: 0`) for CSS transitions over `--ferry-motion-spring` (`440ms`). |

```css
/* Canonical critically damped CSS linear() spring curve (bounce: 0) */
--ferry-motion-ease-spring: linear(
  0, 0.0213, 0.0739, 0.1443, 0.2235, 0.305, 0.3849, 0.4606, 0.5305,
  0.594, 0.6508, 0.7011, 0.7452, 0.7836, 0.8168, 0.8454, 0.8699,
  0.8907, 0.9084, 0.9234, 0.9361, 0.9467, 0.9557, 0.9632, 0.9694,
  0.9747, 0.979, 0.9826, 0.9857, 0.9882, 0.9902, 0.992, 0.9934,
  0.9946, 0.9955, 0.9963, 1
);
```

### JS / WAAPI motion constants (`src/renderer/src/utils/motionTokens.ts`)

When driving Web Animations API (`element.animate()`) directly from TypeScript (such as `FileList.vue` directory navigation), import `FERRY_MOTION_TOKENS` and `prefersReducedMotion()` rather than duplicating timing literals.

- Current shipped constants: `FERRY_MOTION_TOKENS.duration` (`instant: 100`, `fast: 120`, `exit: 140`, `standard: 170`, `panel: 210`, `considered: 360`, `spring: 440`) and `FERRY_MOTION_TOKENS.ease` (`emphasized`, `standard`, `out`, `exit`, `inOut`, `spring`).
- Future Arc UI reference presets (not yet needed in code): `spring.responsive` (`{ stiffness: 520, damping: 44 }`), `spring.gentle` (`{ stiffness: 340, damping: 34 }`), `spring.snappy`/`smooth`/`morph` (`bounce: 0`), and capped stagger delays (`<= 250ms`).

---

## 3. Component motion patterns and Tier 3 portal timings

- Press scale and popup-anchor press guard (`.ferry-pressable`, `.ferry-dock-tab`):
  - Interactive non-popup buttons scale slightly on `:active` (`scale(0.975)` over `--ferry-motion-instant: 100ms`), suppressed automatically for disabled controls (`:disabled`, `[aria-disabled='true']`) and floating overlay anchors (`[aria-haspopup]`, `[data-state='open']`, `[aria-expanded='true']`).
- Destructive action safeguards (`ConfirmDialog.vue`):
  - Pointer clicks (`event.detail > 0`) on `destructive: true` confirmation buttons are ignored during the first `280ms` after `<UModal>` enters (`@enter="openedAt = performance.now()"`), preventing accidental double-click destruction while preserving instant keyboard (`Enter` / `Space`) confirmation.
  - *Future Arc UI reference recipe:* `Hold-to-Confirm` (`clip-path: inset(...)` dual-layer fill + spring rewind) or inline `Confirm-Morph` pills where inline confirmation replaces a modal.
- Teleported overlays, popovers, and sibling tooltip warmup:
  - `<UApp :tooltip="{ delayDuration: 250, skipDelayDuration: 300 }">` configures Reka UI's `250ms` initial tooltip delay and `300ms` sibling warmup window across adjacent toolbar icons.
  - Tier 3 teleported glass dialogs and poppers (`html.ferry-glass [role="dialog"]` and `[data-reka-popper-content-wrapper]`) override Nuxt UI's built-in `scale-in` / `scale-out` keyframe animations directly via `[data-state="open"]` (`--ferry-motion-standard` `170ms` + `--ferry-motion-ease-emphasized`) and `[data-state="closed"]` (`--ferry-motion-exit` `140ms` + `--ferry-motion-ease-exit`), ensuring Reka UI's `usePresence` `animationend` lifecycle unmounts cleanly without dual-animation snapping.
- Directional dock panels, active tab pills, and overflow edge masks:
  - `SiteTabBar.vue` and `BottomDock.vue` animate active tab indicators exclusively via `transform` (`scaleX` / `scale-x-100` vs `scale-x-75` or `scale-x-0`), never layout `width` or `left`, and engage `.ferry-scroll-fade-x` edge masks on horizontal overflow.
  - `BottomDock.vue` panel switches across `transfers`, `activity`, `monitor`, and `edits` pass directional `--ferry-dock-slide-x` (`±8px`) to `.dock-panel` (excluding `TerminalView` and `LogTailViewer`, which stay mounted via `v-show`).
- Glass loading skeleton shimmer (`--ferry-skeleton-*`):
  - Under `html.ferry-glass`, `<USkeleton>` overrides default `bg-elevated` with high-contrast `--ferry-skeleton-base` / `--ferry-skeleton-highlight` tokens and a `1.8s` shimmer (`ferry-skeleton-shimmer`), pausing under `@media (prefers-reduced-motion: reduce)`.

---

## 4. Desktop interactions and glass compositor guardrails

- Dock expand/collapse: Animate the shell's height only on deliberate toggle, not during pointer-resize or full-height/maximize. Dock panel content fades and translates a few pixels (`--ferry-motion-standard`).
- Terminal (`TerminalView.vue`): Never re-key or unmount `TerminalView`; it keeps `xterm.js` instances, WebGL context, and scrollback alive. Dock transitions must not interfere with terminal focus or fitting. Switching to Terminal skips the non-terminal exit fade so overlapping flex panes never squeeze xterm during its initial fit.
- Folder navigation: Animate the `FileList` scroll viewport via WAAPI after the directory actually loads (or displays cache). No animation for refresh, sort, selection, per-row rendering, or initial mount. Reset scroll to the top on directory navigation.
- Site tabs (`SiteTabBar.vue`): Entering/exiting tabs fade and settle; existing tabs use FLIP-style `TransitionGroup` move transforms (`.site-tab-move`). Departing tabs use `position: absolute; pointer-events: none` so remaining tabs glide into place.
- Inline folder creation / error feedback: Shared `slide-down` transition (`--ferry-motion-standard` + `--ferry-motion-ease-emphasized`), or `ResizeObserver`-backed height transitions (`bounce: 0`) where layout shifts follow inline validation.
- Dialogs / popovers: Prefer Nuxt UI / Reka UI's accessible transitions aligned with the `140ms` exit / `--ferry-motion-ease-spring` entrance tokens rather than stacking redundant wrapper animations on top.

> [!WARNING]
> Glass and motion compositor rule (`html.ferry-glass`):
> Never animate `filter: blur(...)` on or inside any container that uses `backdrop-filter: blur(...)`. In Chromium/WebView2, applying `filter` creates a Backdrop Root that breaks glass refraction of `.ferry-ambient-canvas`. Use `opacity` + `transform` only on translucent surfaces.

---

## 5. Performance and accessibility requirements

1. Prefer `opacity` and `transform`, especially over virtualized lists and high-frequency views.
2. Do not animate individual virtualized rows: `FileList` (`FileRow.vue`), `TransferQueue`, and `LogTailViewer` manage their own virtualized positions.
3. Avoid permanent `will-change` on lists or large surfaces; apply animation lifecycle hints only during active transitions.
4. Respect OS `prefers-reduced-motion: reduce`, including Web Animations API-driven navigation (`window.matchMedia('(prefers-reduced-motion: reduce)').matches`), collapsing travel, scale, blur, shake, springs, and loops while preserving fast opacity crossfades and final state clarity.
5. A `210ms` height transition is an intentional single layout animation for dock open/close. Drag-resize must remain immediate (`!transition-none`); never animate on every drag frame.
6. Do not block file operations, modify IPC or cache lifetimes, or delay perceived navigation just to finish an animation.
7. Keyboard focus, arrow navigation, drag selection, `xterm` typing/scrollback, and screen-reader roles must remain functional throughout motion.

---

## 6. Manual QA checks

- Open/close the dock with every tab, including Terminal; switch tabs repeatedly and confirm no stale content.
- Expand/collapse while dragging dock height; verify pointer resize tracks immediately and saves the final height.
- Maximize dock, collapse/restore, resize OS window, and ensure the terminal remains usable and fitted.
- Navigate local/remote folders by double click, breadcrumbs, back/forward/up, cached paths, and slow SSH; verify no stale rows flash.
- Open/close/reorder site tabs quickly; check tab-list keyboard controls, close focus, and confirm popup triggers do not shrink on `:active`.
- Test a directory containing thousands of entries; scroll, sort, rename, and select during and after navigation; confirm zero trailing lag on held `ArrowUp`/`ArrowDown`.
- Enable reduced motion in Windows settings; verify nonessential movement disappears.
- Exercise light and dark themes at normal and compact densities in both Classic (`glassUiEnabled: false`) and Modern Glass (`glassUiEnabled: true`) modes.

---

## 7. Follow-on polish

Validate in a packaged Windows build with performance recordings before adding more motion. Avoid transitions on continuously updating log lines, terminal output, per-process monitor charts, or transfer percentages: smoothness there comes from batching, `tabular-nums`, and low-cost painting.

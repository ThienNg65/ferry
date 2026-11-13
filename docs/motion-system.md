# Ferry motion system

Motion makes state changes legible without delaying SSH/SFTP tasks. The design is intentionally subtle and consistent across dark and light themes.

## Tokens

Defined in `src/renderer/src/assets/main.css`:

| Token | Duration | Use |
| --- | --- | --- |
| `--ferry-motion-fast` | 120 ms | Fade, button press, micro-feedback |
| `--ferry-motion-standard` | 170 ms | Dock contents, tabs, inline forms |
| `--ferry-motion-panel` | 210 ms | Dock opening/closing and side overlays |
| `--ferry-motion-ease-out` | cubic-bezier(0.2, 0.8, 0.2, 1) | Content settling |
| `--ferry-motion-ease-emphasized` | cubic-bezier(0.16, 1, 0.3, 1) | Panel entrance and active indicators |

## Interactions

- **Dock expand/collapse:** animate the shell's height only on deliberate toggle, not during pointer-resize or full-height/maximize. Dock panel content fades and translates a few pixels.
- **Terminal:** never re-key or unmount `TerminalView`; it keeps xterm instances and scrollback alive. Dock transitions must not interfere with terminal focus or fitting. Switching to Terminal skips the non-terminal exit fade so overlapping flex panes never squeeze xterm during its initial fit.
- **Folder navigation:** animate the `FileList` scroll viewport after the directory actually loads (or displays cache). No animation for refresh, sort, selection, per-row rendering, or initial mount. Reset scroll to the top on directory navigation.
- **Site tabs:** entering/exiting tabs fade and settle; existing tabs use FLIP-style `TransitionGroup` move transforms. Active underline uses transform.
- **Inline folder creation / error feedback:** shared `slide-down` transition.
- **Dialogs / popovers:** prefer Nuxt UI's existing accessible transitions rather than stacking another animation on top.

## Performance and accessibility requirements

1. Prefer opacity and transform, especially over virtualized lists and high-frequency views.
2. Do not animate individual virtualized rows: `FileList` and `TransferQueue` manage their own absolute row positions.
3. Avoid permanent `will-change` on lists or large surfaces; use animation lifecycle hints only.
4. Respect OS `prefers-reduced-motion: reduce`, including Web Animations API-driven navigation.
5. A 210 ms height transition is an intentional single layout animation for dock open/close. Drag-resize must remain immediate; no animation on every frame.
6. Do not block file operations, modify IPC or cache lifetimes, or delay perceived navigation just to finish an animation.
7. Keyboard focus, arrow navigation, drag selection, xterm typing/scrollback, and screen-reader roles must remain functional throughout motion.

## Manual QA matrix

- Open/close the dock with every tab, including Terminal; switch tabs repeatedly and confirm no stale content.
- Expand/collapse while dragging dock height; verify pointer resize tracks immediately and saves the final height.
- Maximize dock, collapse/restore, resize OS window, and ensure the terminal remains usable and fitted.
- Navigate local/remote folders by double click, breadcrumbs, back/forward/up, cached paths, and slow SSH; verify no stale rows flash.
- Open/close/reorder site tabs quickly; check tab-list keyboard controls and close focus.
- Test a directory containing thousands of entries; scroll, sort, rename, and select during and after navigation.
- Enable reduced motion in Windows settings; verify nonessential movement disappears.
- Exercise light and dark themes at normal and compact densities.

## Follow-on polish

Validate in a packaged Windows build with performance recordings before adding more motion. Avoid transitions on continuously updating log lines, terminal output, per-process monitor charts, or transfer percentages: smoothness there comes from batching and low-cost painting, not decorative animation.

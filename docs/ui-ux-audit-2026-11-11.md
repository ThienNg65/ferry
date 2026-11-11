# UI/UX audit: Ferry 0.17.0 (2026-11-11)

Source-level audit of `src/renderer/src` plus a driven-app feedback report. Contrast figures are computed from @nuxt/ui zinc defaults, not measured.

**Product:** dual-pane SFTP client for expert desktop users. Speed, keyboard flow and dense, scannable lists matter more than whitespace.
**Journeys:** connect to a site, browse, transfer (with conflicts), edit a remote file, delete or rename, recover from errors.

| Category | Score | Why |
|---|---|---|
| Visual Design | 7 | Coherent Nuxt UI system; dense and readable |
| Usability & Navigation | 5 | Delete, rename and edit could lose data |
| Interaction Quality | 5 | Commit-on-blur in 2 inputs; focus lost after context menu |
| Responsive Design | 5 | Name column collapsed at the minimum window with the default split |
| Accessibility | 4 | Splitter, rows, tabs and context menus not keyboard reachable; ~23 unnamed icon buttons; dimmed text 2.6:1 |
| Consistency & Design System | 6 | 42 arbitrary font sizes, ~55 raw palette classes, 3 duplicated formatters, ~10 copy-pasted confirm modals |
| Product Polish | 6 | Error toasts vanished in 4s; inactive-pane selection nearly invisible (1.27:1) |

Addressed in the P0/P1 PR: delete/rename/path-edit data loss, atomic and conflict-checked remote edits, plain-language errors and persistent error toasts, first-connect fingerprint prompt, narrow-pane layout, keyboard focus and selection visibility, richer transfer conflicts and F5, accessibility baseline.

Backlog (P2/P3): tab keyboard support, `useConfirm()` refactor and `FilePane.vue` split, transfer `.part` files with resume, hover-prefetch limits, typography tokens and raw-palette cleanup, ARIA grid for the file list, `~/.ssh/config` import.

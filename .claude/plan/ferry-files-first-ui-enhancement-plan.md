# Ferry: "Files first" UI enhancement plan

## Context
A customer reports Ferry's content is "hard to see and hard to focus on". The audit (`docs/ui-ux-audit-2026-11-10.md`) showed the cause is structural, not contrast:
- The bottom dock is open by default at ≥224px, which is ~45% of the window, even when empty.
- Six bordered chrome bands sit above the first file row.
- Nothing marks the active pane.
- Selection, zebra striping and hover are nearly the same strength.
- Many tiny uppercase labels compete with file names.

The user asked for a real design direction and enhancement plan, not just evidence, and **not** to lead with "more contrast / bigger font". The outcome: a default workspace where the file list owns the screen, one pane is unmistakably "where I am", and the selection is the loudest thing in the list.

## Design direction: "One lit pane"
**Subject:** an expert file-moving tool used for hours at a time, by people who think in "source pane → target pane". The memorable element (where the boldness goes) is **the active pane**: lit with a solid accent spine and an elevated address row. Everything else (title bar, tabs, the inactive pane, the dock) recedes into quiet, borderless surfaces. No new fonts, no gradients, no decoration. Boldness comes from contrast of *role*, not of colour.

**Tokens (all mapped onto existing @nuxt/ui semantic tokens so the accent engine and light/dark keep working):**
| Role | Light | Dark | Token |
|---|---|---|---|
| Canvas (file list) | `#FFFFFF` | `#18181B` | `bg-default` |
| Recessed chrome (title, tabs, dock strip, inactive address row) | `#F4F4F5` | `#1F1F23` | `bg-muted` |
| Lit surface (active address row) | `#FFFFFF` + spine | `#27272A` + spine | `bg-elevated` |
| Accent spine / selection bar | accent-600 | accent-400 | `--ui-primary` (user accent preset) |
| Selection fill (active pane) | accent @ 18% | accent @ 22% | `bg-primary/20` |
| Selection fill (inactive pane) | `#E4E4E7` | `#3F3F46` | `bg-accented` |

**Type (keep Segoe UI Variable; no new families):** one scale, three tiers, sentence case everywhere (no uppercase labels).
- Tier 1, file name: 13px/20 regular; folders medium.
- Tier 2, metadata, path segments, column headers: 12px/16, `text-muted`, `tabular-nums` for size and date.
- Tier 3, status line and badges: 11px/16, `text-muted`.
- Add `--text-2xs: 11px` and `--text-meta: 12px` in `@theme`; replace the bracket sizes we touch.

**Layout:**
```
Before (≈668px window)                After
┌ title ─────────────────────┐         ┌ title ─────────────────────┐
├ site tabs ─────────────────┤         ├ site tabs ─────────────────┤
├ LOCAL header ──┬ REMOTE ───┤         ┃▌~/proj › src   [⌕][↑⟳+⋯]│ ◦ /var/www  [⌕][↑⟳+⋯] │  ← one address row, lit = active
├ breadcrumb ────┼───────────┤         ├ Name        Size  Modified│ Name   Size  Modified  │
├ toolbar ───────┼───────────┤         │ ...                       │ ...                   │
├ column header ─┼───────────┤         │ ~14–16 rows               │                       │
│ 6 rows         │           │         │ ▌selected row (bar+fill)  │                       │
├ status ────────┴───────────┤         ├ status ───────────────────┴───────────────────────┤
├ dock tabs ─────────────────┤         └ Transfers·2  Activity  Log tail  Terminal …   ⌃ ┘   ← 36px strip, opens on demand
│ "No transfers yet" (224px) │
└────────────────────────────┘
```
Content is left-aligned. Grouping is done by surface, not borders: one hairline under the address row, one under the column header, none between title, tabs and address.

**Review against the brief:** the first draft added a mono font for paths and dates. I dropped it, because it is a template tell and paths are already readable in Segoe. I considered a coloured top bar on the active pane, but a left spine reads better in a side-by-side layout and doubles as a non-colour cue. Pill-shaped inset rows are removed for full-width rows, because rounded cards in a data grid read as the "SaaS card kit".

## Implementation (phased; each phase ships alone)
**Agreed scope for this round: Phases 1–2**, with the dock collapsed by default and opening itself when needed. Phase 3 stays planned for a follow-up round.

### Phase 1: Give the content its space back (S)
1. **The dock starts collapsed and opens on demand.** In `src/renderer/src/composables/useDockState.ts`, `collapsed = ref(true)`. In `components/shell/BottomDock.vue`, add a `watch` on the transfer queue's item count, calling the existing `openDock('transfers')` when it goes up while collapsed. Tail and terminal already call `openDock` (`FilePane.vue:324`, `CommandPalette.vue:91-94`). Keep `terminalEverShown` and the `v-show` terminal untouched (PROJECT_MAP Gotcha #9).
2. **The collapsed strip carries state.** Reuse the existing `UChip` pattern (`BottomDock.vue` tail tab) for an active transfer count on the Transfers tab, so state is visible without opening the dock.
3. **Row states ladder.** In `utils/rowStyle.ts`, remove the zebra class (return `''`; update `rowStyle.test.ts`). In `components/files/FileRow.vue`, remove `rounded-md` and the list's `px-1` inset (`FileList.vue`). The selected state becomes `bg-primary/20` plus a 2px inset left bar (`shadow-[inset_2px_0_0_var(--ui-primary)]`). Hover becomes `bg-elevated/60`.

### Phase 2: One lit pane (M)
4. **`activePane` state.** Add `activePane: 'local' | 'remote'` to `stores/ui.store.ts`; it is not persisted, because it is per-launch layout state. In `FilePane.vue`, set it on `@focusin` and `@pointerdown` on the root. The `Tab` key in `onKeydown` (when not in an input) switches panes and focuses the other root.
5. **Merge the three bars into one address row.** In `FilePane.vue`, delete the `h-8` LOCAL/REMOTE header (the host label already lives in the site tab title; the side icon moves to the row's start). Render `PathBreadcrumb` and `FileToolbar` in one `flex h-9` row:
   - `PathBreadcrumb` drops its own `border-b`/`px` wrapper and becomes `flex-1 min-w-0`.
   - `FileToolbar` drops its `border-b`. It keeps up, refresh, filter, the transfer-selected button and bookmarks inline, and moves new folder, sync and the permissions toggle into a `UDropdownMenu` "More" (⋯) button.
   - Keep `focusFilter()` exposed (used at `FilePane.vue:534`).
   - The active pane's row is `bg-elevated` with `shadow-[inset_3px_0_0_var(--ui-primary)]`; the inactive pane's row is `bg-muted`.
6. **The inactive pane recedes.** `FileRow` gets an `active` prop (from `ui.activePane === side`). The selected fill uses `bg-primary/20` when active and `bg-accented` when not (the Finder/Explorer unfocused-selection convention). Drop the root `focus-visible:ring-1 ring-primary/40`; the lit row replaces it.
7. **Errors inline.** Replace the `UAlert` in `FilePane.vue` with a one-line `text-error` strip under the address row, with the existing refresh action as "Retry". The list no longer jumps.

### Phase 3: Scan and calm (S–M)
8. **Column headers.** In `FileList.vue`, use sentence case, `text-meta text-muted`, no `uppercase tracking-wide`; the active sort column is `text-highlighted`. The `Permissions` label moves to sentence case too. The pane title is gone (step 5).
9. **Metadata.** In `FileRow.vue`, size and date get `tabular-nums text-meta text-muted` (one tier up from `text-dimmed`; that is a hierarchy change, not a contrast bump). The date column narrows from `w-40` to `w-32`, with a shorter `formatDate` variant in `utils/format.ts` (`Nov 10, 14:32`; same year shows no year). The full timestamp goes in a `title`. Add a test in `format.test.ts`.
10. **Title and tab bars merge visually.** In `TitleBar.vue` and `SiteTabBar.vue`, both use `bg-muted` with no `border-b` between them (one hairline under the tab bar only). The active site tab becomes `bg-default text-highlighted` (it "connects" to the canvas below) instead of a primary pill.
11. **Density pref.** Add `density: 'compact' | 'comfortable'` (persisted, `ferry:ui:density`) to `ui.store.ts` and a segmented control in `SettingsDialog.vue`. Rows are `py-0.5` (24px) vs `py-1.5` (32px). Update the virtualizer's `estimateSize` in `FileList.vue` to match.

### Out of scope (later)
- A separate keyboard cursor vs selection model.
- A contrast and type-size pass: measure with axe after phase 3, then adjust tokens only if still below WCAG AA.

## Critical files
- `src/renderer/src/composables/useDockState.ts`, `components/shell/BottomDock.vue`
- `src/renderer/src/components/files/FilePane.vue`, `FileToolbar.vue`, `PathBreadcrumb.vue`, `FileList.vue`, `FileRow.vue`
- `src/renderer/src/stores/ui.store.ts`, `utils/rowStyle.ts(+test)`, `utils/format.ts(+test)`
- `src/renderer/src/components/shell/TitleBar.vue`, `SiteTabBar.vue`, `SettingsDialog.vue`, `assets/main.css` (`@theme` text sizes)

## Verification
- `npm run typecheck` and `npm test`, with updated `rowStyle.test.ts` and new tests for the dock auto-open and `activePane`, density and the short date format.
- `npm run dev`, then connect to the Docker SFTP container (command in `RemoteShell.integration.test.ts` header) at 1366×768 / 125%:
  - Count visible rows before and after (target ≥14).
  - Start an upload: the dock opens on Transfers. Collapse it: the chip shows the count.
  - Click or Tab between panes: the spine moves, and the inactive selection turns grey.
  - Ctrl+F still focuses the filter. Every former toolbar action is reachable (inline or under ⋯).
  - Drag-drop in and out still works. The terminal survives a disconnect and reconnect (no remount).
  - Check light and dark, with the default and green accent presets.
- Screenshot before and after for the customer, and run axe on the connected view to confirm the focus and selection indicators reach ≥3:1.

# UI/UX Audit: Ferry, content visibility and focus (2026-11-10)

**Scope:** branch `perf/fast-ssh-remote-browsing` @ `3308808`, the connected workspace (dual file panes plus bottom dock) and the site picker. **Trigger:** customer feedback that the content is "hard to see and hard to focus on". **Design direction (inferred):** minimal, Apple-HIG-inspired, built on `@nuxt/ui` v4 tokens (`main.css`, PROJECT_MAP.md).
**Method:** source review of the shell, pane, list, row, dock and ui store, plus the rendered screenshots captured today by the agent-review round (`docs/agent-reviews/evidence/25_file_browser_connected.png`, `26_dock_activity.png`, `02_light_mode.png`; the window is about 1068×668 CSS px at 150% scale). Tags: **[Verified]** seen in a screenshot or measured · **[Source]** read in code · **[Design]** opinion.
This is an audit only. No source files were changed.

> **Ground rule set by the request:** do not solve this by raising contrast or font size first. Most of the "hard to see" feeling comes from **how space and emphasis are allocated**, not from colour or type values. Contrast and size are only addressed in P2, after the structure is fixed, because changing them on top of a noisy layout makes everything louder without making anything easier to focus on.

## 0. Product understanding
- **Purpose and users:** a WinSCP replacement for developers and ops people who move files, tail logs and run shells on remote servers, often for long sessions. These are expert, keyboard-heavy users. They value scannable density and a clear "where am I / what is selected" over generous whitespace.
- **Primary journeys:** 1) connect, then find a file in a deep remote tree; 2) select local files and upload them, then watch progress; 3) open a remote log and tail it while browsing; 4) use the terminal next to the file view; 5) failure paths: lost session, permission error, empty folder.
- **Constraints to preserve:** the dual-pane model, collapsible local pane, resizable dock and pane splitter, every dock tab, xterm instances that are never unmounted (the `v-show` rule in `App.vue`), drag-and-drop, the context menu, keyboard selection, the accent-colour engine and light/dark themes.

## 1. Executive summary
Ferry's visual system is clean and consistent at the component level. The focus problem is **structural**. In the default layout, the file list (the content users came for) gets only about **26% of the window height**. The bottom dock takes about **45%**, even when it only says "No transfers yet". The rest goes to **six stacked chrome bands**, each with its own border. On top of that, nothing tells the user which pane is active. Row metadata, zebra striping and selection sit at nearly the same visual weight, so the eye has no anchor. Fix the space allocation and the focus model first. Most of the "hard to see" complaint should go away without touching a single colour.
- **Strengths:** a coherent token-based theme; virtualised lists; good empty and filter states; a resizable and collapsible dock; a command palette; keyboard selection.
- **Weaknesses:** a chrome-heavy vertical stack; a dock that is always open; no active-pane indicator; flat emphasis between name, metadata, zebra and selection; many tiny uppercase labels competing as headings.
- **Top opportunities:** a content-first layout (collapse the empty dock and merge the pane chrome into one row); a strong active-pane and cursor model; a clear text hierarchy inside rows; an optional density setting.

### Best-practice framework applied
These are the principles that dense professional tools (Explorer/Finder, Total Commander/Far, VS Code, Transmit/ForkLift, JetBrains IDEs) converge on. The findings below are judged against them:
1. **Content-first space budget.** The primary content gets most of the pixels. Secondary panels are collapsed until they have something to show, or the user asks for them.
2. **One focus at a time.** In a multi-pane UI, exactly one region is visibly "active". The other recedes, and the keyboard cursor is distinct from the selection.
3. **Hierarchy by contrast of role, not by more lines.** Group with spacing and background (Gestalt proximity and common region) instead of a border between every band. Limit emphasis levels to about three: primary, secondary, tertiary.
4. **Scannability.** Aligned columns, tabular numerals, a strong primary column (Name), quieter but still legible metadata, and no decoration that competes with data, such as zebra striping as strong as the hover state.
5. **Progressive disclosure.** Rarely used controls go to menus or the palette, and hover-only actions are not the only path.
6. **User-controlled density.** Expert tools offer compact and comfortable modes instead of picking one size for everyone.
7. **Only then, legibility tuning:** contrast ratios and type scale (WCAG 2.2 AA: 4.5:1 text, 3:1 UI indicators).

## 2. UI/UX scorecard
| Category | Score | Justification |
|---|---|---|
| Visual Design | 6/10 | Clean and coherent, but the layout has no clear primary region: chrome and the dock outweigh the content. |
| Usability & Navigation | 5/10 | Only ~6 rows are visible by default, there is no active-pane cue, and the path, toolbar and header are split over three rows. |
| Interaction Quality | 6/10 | Good drag and keyboard support. Row actions appear only on hover, and selection is weak (`bg-primary/10`). |
| Responsive Design | 6/10 | Panes and dock resize. The 224px dock minimum and the stacked chrome punish small and laptop windows. |
| Accessibility | 5/10 | The pane focus ring is 1px at 40% opacity, metadata uses `text-dimmed` at 11–12px, and selection relies on colour alone. |
| Consistency & Design System | 7/10 | Tokens are used throughout. Mixed label casing (uppercase 11px headers vs title case) and many ad-hoc `text-[9–11px]` sizes. |
| Product Polish | 6/10 | Solid parts, but the overall feel is "many equal boxes" rather than "a tool focused on my files". |

## 3. Prioritised findings
| ID | Priority | Area | Finding | User impact | Recommendation | Effort |
|---|---|---|---|---|---|---|
| F1 | High | Layout | The bottom dock is open by default at ≥224px (~45% of the window) even when empty [Verified] | The file list shrinks to ~6 visible rows, and users scroll constantly | Collapse the dock by default and when its content is empty; auto-open it on the first transfer, tail or terminal | S |
| F2 | High | Layout | Six stacked chrome bands above the first row (title, site tabs, pane header, breadcrumb, toolbar, column header), each with a border [Verified] | About 180 CSS px of chrome, and the eye reads many equal horizontal lines before reaching any content | Merge the pane header, breadcrumb and toolbar into one address-bar row per pane | M |
| F3 | High | Focus | No visible active pane: both panes look identical, and focus is only a 1px `ring-primary/40` inset [Source] | Users cannot tell which pane the keyboard, paste or F-keys act on | Track `activePane`; give the active pane a stronger header/accent edge and slightly recede the inactive one | M |
| F4 | High | Hierarchy | Selection (`bg-primary/10`) is barely stronger than zebra (`bg-elevated/40`) and hover (`bg-muted`) [Source] | Selected files are hard to spot, especially in multi-select | Drop zebra (or make it much fainter), make selection clearly the strongest row state, and add a separate keyboard-cursor style | S |
| F5 | Medium | Hierarchy | Too many label tiers: uppercase 11px column headers, uppercase 12px pane titles, 11px status, 10px rail [Source] | Many small, loud labels compete with file names | Use one quiet header style in sentence case; demote the pane titles once F2 merges them | S |
| F6 | Medium | Scannability | Metadata (size, date) is right-aligned, `text-xs text-dimmed`, with non-tabular numbers and a 160px date column [Verified] | Columns are hard to scan and compare; the dates read as noise | `tabular-nums`, a shorter relative or ISO date format, keep size right-aligned; then tune colour in P2 | S |
| F7 | Medium | Feedback | The error alert pushes the list down and stays inside the pane as a large block [Verified] | Content jumps and the error dominates the pane | Show errors as a compact inline banner in the address-bar row with Retry/Reconnect | S |
| F8 | Medium | Interaction | Row Transfer/Delete buttons exist only on hover (`opacity-0`) [Source] | Not discoverable, and adds hover flicker while scanning | Keep them (they also work on focus) but rely on the toolbar or context menu for selection actions; consider showing them only on the selected row | S |
| F9 | Medium | Density | A single fixed density: rows ~28px with `rounded-md` pill rows inset from the edge [Verified] | Neither "see more files" users nor "larger targets" users are served | Add a Compact/Comfortable setting in `ui.store` (row height 24/32) | M |
| F10 | Low | Consistency | Ad-hoc `text-[9px]`(3) `text-[10px]`(11) `text-[11px]`(28) `text-[13px]`(2) sizes [Source] | Type scale drift | Define 2–3 named sizes in `@theme` and map them | S |
| F11 | Low (do last) | Legibility | `text-dimmed` metadata and the 40%-opacity focus ring probably fall below 4.5:1 and 3:1 [Source, not measured] | Low-vision users struggle | After F1–F9, measure and move metadata to `text-muted`; focus ring to full `ring-primary` | S |

## 4. Detailed review

### F1. The dock occupies about half the window while empty [Verified]
- **Location:** `stores/ui.store.ts:17` (`MIN_DOCK_HEIGHT = 224`), `composables/useDockState.ts:8` (`collapsed = ref(false)`), `components/shell/BottomDock.vue:84`.
- **Evidence:** in `evidence/25_file_browser_connected.png` the dock spans y 548→1003 of 1003 px and shows only "No transfers yet". The file list spans y 242→508, which is 6 rows.
- **User impact:** the main task (browsing files) gets a quarter of the screen. This is the single biggest cause of "hard to focus".
- **Recommendation:** default `collapsed = true`. Auto-expand (via the existing `openDock`) when a transfer starts, a tail opens or the terminal is requested, and keep the last user choice. Keep the 36px collapsed tab strip with counts or badges (for example "Transfers 3"), so state stays visible without the panel. Optionally lower the expanded minimum to about 160px.
- **Priority / Effort:** High / S

### F2. The chrome stack before content [Verified]
- **Location:** `App.vue:135-136`, `FilePane.vue` (header `h-8`, then `PathBreadcrumb`, then `FileToolbar`), `FileList.vue` column header.
- **Evidence:** six bands with six border lines before the first file row; the pane title ("LOCAL"/"REMOTE") repeats what the side and icon already say.
- **Recommendation:** one ~36px row per pane: `[side icon] [breadcrumb … flex] [filter] [⋯ overflow / core icons]`, with the host label moved into the site tab (it is already there). Use background tint for grouping instead of borders: one border under the address row, one under the column header. Net gain: about 60 CSS px, roughly 2–3 more rows, and far less line noise.
- **Priority / Effort:** High / M (touches `FilePane`, `PathBreadcrumb`, `FileToolbar`; keep every action reachable).

### F3. No active-pane model [Source]
- **Location:** `FilePane.vue` root (`tabindex="0"`, `focus-visible:ring-1 focus-visible:ring-primary/40`).
- **Evidence:** no store state for the active side; both panes render identical headers; the ring only appears on keyboard focus and is faint.
- **User impact:** in a dual-pane tool, "which side am I on" is the core orientation question (Total Commander and WinSCP both highlight the active panel's header and path).
- **Recommendation:** `activePane: 'local' | 'remote'` in `ui.store`, set on pointerdown or focus within a pane. Active: the address row uses `bg-elevated` plus a 2px `primary` top or left edge. Inactive: the list text steps down one tier, and selection turns grey (`bg-accented`) instead of primary, like Finder and Explorer when unfocused.
- **Priority / Effort:** High / M

### F4. Row states are not distinguishable [Source]
- **Location:** `FileRow.vue:4-10`, `utils/rowStyle.ts:3`.
- **Evidence:** idle-odd `bg-elevated/40`, hover `bg-muted`, selected `bg-primary/10`. The three are close in luminance, so selection does not pop, especially with green or low-saturation accent presets.
- **Recommendation:** remove zebra (the virtualised list already has row rhythm) or reduce it to about half its strength. Selected: `bg-primary/20` plus a 2px left accent bar, which also gives a non-colour cue. Keyboard cursor: a 1px `ring-primary` outline with no fill. Update `rowStyle.test.ts` accordingly.
- **Priority / Effort:** High / S

### Medium and Low (compact)
| ID | Location | Concrete change |
|---|---|---|
| F5 | `FileList.vue:4`, `FilePane.vue` header | Column headers: sentence case, `text-xs font-medium text-muted`, no tracking; the active sort column in `text-highlighted`. |
| F6 | `FileRow.vue` size/date spans | `tabular-nums`; date column `w-32` with a shorter format; consider relative dates for anything under 7 days, with the full date in a tooltip. |
| F7 | `FilePane.vue` `UAlert` | Inline `text-error` strip in the address row with Retry and Reconnect actions; the list keeps its position. |
| F8 | `FileRow.vue` action buttons | Show them on the selected row as well as on hover; never let hover-only be the only path (the context menu already covers it). |
| F9 | `ui.store.ts`, `FileRow.vue`, the virtualizer `estimateSize` | Add a `density` pref; also drop the `rounded-md` inset "pill" rows in Compact for full-width rows. |
| F10 | components (44 ad-hoc sizes) | `@theme { --text-2xs: 11px; }` and similar; replace the bracket sizes. |
| F11 | tokens | Measure with axe after the structural changes; adjust `text-dimmed`→`text-muted` for metadata and full-opacity focus rings. |

## 5. Proposed enhancements (before → after)
- **Default workspace.** Before: title, tabs, 3 pane bars, header, 6 rows, then a big empty dock. After: title, tabs, 1 address row, header, ~14–16 rows, then a 36px dock strip with badges.
- **Orientation.** Before: two identical panes. After: the active pane is visibly lit, and the inactive pane's selection turns grey; Tab switches panes.
- **Finding a file.** Before: scan names among zebra stripes and dimmed dates. After: bold-enough names on a plain background, aligned tabular metadata, and an unmistakable selection bar.
- **Errors.** Before: a large red block that pushes content. After: a one-line status in the address row with an action.

## 6. Implementation roadmap
**Quick wins** (high value, small effort): F1, F4, F5, F6.
### P0: Give the content its space back
**Findings:** F1, F4 · **Files:** `useDockState.ts`, `BottomDock.vue`, `ui.store.ts`, `FileRow.vue`, `rowStyle.ts(+test)` · **Approach:** collapse-by-default plus auto-open, and the row-state ladder · **Risks:** users expecting the dock open (persist their last choice); the terminal must still lazy-mount via `terminalEverShown` · **Effort:** S
### P1: Focus model and chrome consolidation
**Findings:** F2, F3, F5, F7 · **Files:** `FilePane.vue`, `PathBreadcrumb.vue`, `FileToolbar.vue`, `FileList.vue`, `ui.store.ts` · **Risks:** the toolbar's `ref` is used for filter focus (Ctrl+F); drag-drop targets on the pane root; keep every toolbar action reachable · **Effort:** M
### P2: Scannability, density and then legibility
**Findings:** F6, F8, F9, F10, F11 · **Approach:** type-scale tokens, density pref, contrast measurement and token tweaks last · **Effort:** M
**Larger changes (separate planning):** a full keyboard-cursor model (arrow keys move a cursor separately from the selection, Space toggles), and a side-by-side terminal or tail layout.

## 7. Validation strategy
| Improvement | Manual check | Automated check | Accessibility / visual check |
|---|---|---|---|
| Dock collapse (F1) | 1366×768 at 125%: count visible rows before/after; start a transfer, and the dock opens | vitest for `useDockState` default and auto-open | Screenshot before/after |
| Chrome merge (F2) | Every former toolbar action is reachable; Ctrl+F still focuses the filter | `npm run typecheck`, `npm test` | Keyboard-only pass through the address row |
| Active pane (F3) | Click and Tab between panes; the inactive selection turns grey | Unit test for `activePane` | Focus indicator ≥3:1 (axe) |
| Row states (F4) | Multi-select 5 files with each accent preset, light and dark | Updated `rowStyle.test.ts` | The selected state has a non-colour cue (left bar) |
| Legibility (F11) | — | — | axe contrast on `text-muted`/`text-dimmed` over `bg-default` and `bg-elevated` |

## 8. Regression protection
- xterm instances must never remount (the `v-show` in `App.vue`, PROJECT_MAP Gotcha #9). Dock changes must keep `TerminalView` mounted.
- Drag-and-drop (OS drop on the pane root, native drag-out on rows) and the drop-target highlight.
- Pane splitter and dock resize persist (`ferry:ui:*` localStorage keys).
- The context menu, F2 rename, Ctrl/Shift/Ctrl+A selection, sort headers, the filter (Ctrl+F) and bookmarks.
- The accent-colour engine: new states must use `primary` tokens so presets keep working.

## 9. Assumptions, untested flows and limitations
- I did not drive the Electron app myself. The rendered evidence is from today's agent-review screenshots, taken at 150% scale in dark theme with a lost-session error on the remote pane. There is no connected light-theme screenshot.
- Contrast ratios were not measured (F11 is flagged from tokens only).
- The customer quote is short. It is worth confirming with them whether "hard to see" means *finding things* (structure, which this report addresses first) or *reading text* (legibility). A 1-minute screen recording of their real window size would settle it.
- Screen size is assumed to be a laptop (≈1366–1536 CSS px wide at 125–150% scaling), which is where F1 and F2 hurt most.

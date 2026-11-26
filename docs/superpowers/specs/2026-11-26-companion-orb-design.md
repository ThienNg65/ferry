# Ferry Companion Orb (Aurora) Design

**Date:** 2026-11-26
**Branch:** `feat/ferry-companion-78`
**Replaces:** the ferry-hull avatar in `src/renderer/src/components/companion/CompanionAvatar.vue`
**Mockups:** `.superpowers/brainstorm/12799-1795624210/content/` (`aurora-states-v2.html`, `streaming-prod-options.html`)

## 1. Intent

The Companion gets a new face: a faceless glossy orb ("Aurora") whose mood comes from motion, glow and colour, not
expressions. The ferry icon stays the app's identity; the orb is the living companion shown in the top-bar trigger,
the panel header and the empty chat screen.

Why: the old hull avatar reads as a second app icon and carries little state. The orb should show at a glance what the
companion is doing (idle, listening, thinking, replying, failed) and whether you are on a production host, without
ever popping up uninvited.

Visual reference: Dribbble "Aetheris AI chat dashboard" (glossy sphere hero above the greeting), adapted to Ferry's
palette and design system (`DESIGN.md`).

## 2. Goals, non-goals, anti-goals

**Goals**
- One orb component used at all current avatar sites, with the six states below plus the "noticing" overlay.
- Readable at 16px (top bar), 20px (panel header) and 96px (empty chat hero).
- Follows `DESIGN.md`: static at rest, motion tokens, reduced-motion, works in Classic and Glass UI, light and dark.

**Non-goals (this phase)**
- Real token streaming from the AI provider. Replies still arrive in one IPC call (see 5.3).
- The other brief states: lag, disconnected, destructive-command guard. They need session/terminal signals and the
  command guard is its own project.
- Brief capabilities (Plot a Course, Steady the Helm, Captain's Log, harbor chart). Separate work.
- App icon changes (the mast-as-cross issue). Separate work.

**Anti-goals (failure even if it works)**
- The orb draws attention when nothing happened (Clippy effect). Idle must be ignorable.
- Red or amber used for anything other than "production" and "something failed".
- Measurable cost next to a live terminal (`xterm.js` WebGL) or idle GPU churn.
- Colour as the only signal: every state has a text label or tooltip.

## 3. Decisions taken

| Topic | Decision |
|---|---|
| Look | Aurora gloss sphere: deep radial body, blurred inner light drifting, bottom refraction ("caustic"), vignette, soft + sharp specular highlight, 1px rim light, breathing outer glow. |
| Colour | **Fixed brand blue**, not the user's accent. Keeps red/amber unambiguous with Red/Orange accents. Violet is the same hue as the glass ambient canvas secondary orb. Pink from the reference is dropped. |
| Streaming | **S1 Lift**: each revealed chunk lifts the inner light ~9 units (of 100) and brightens the glow, then it settles. |
| Production | **P1 Lower rim light**: thin `error`-red light along the bottom arc plus a ~26% warm tint of the body. Silhouette unchanged. |
| AI failure | `warning` amber, never red, so it cannot read as production. |
| Build | **Approach A**: one inline SVG + CSS Vue component. |
| Streaming source | **Option 2**: reveal the finished reply client-side in chunks; that reveal drives S1. |

### Palette (fixed)

| Role | Value |
|---|---|
| Body gradient (light to dark) | `#a9e6ff`, `#3a7ce8`, `#2a2f9c`, `#140f5c` |
| Inner light 1 (cyan) | `#5ee7ff` |
| Inner light 2 (violet) | `oklch(0.62 0.18 295)` |
| Inner light 3 (highlight) | `#c9ecff` |
| Glow | `#6f8cff` |
| Production rim | `var(--ui-error)` |
| Failure glow | `var(--ui-warning)` |
| Failure body | Tailwind zinc `#d4d4d8`, `#71717a`, `#3f3f46`, `#18181b` |

## 4. States

Primary state (exactly one at a time) plus two overlays that combine with any state.

| State | Inner light | Glow | Label (text, always present) |
|---|---|---|---|
| `idle` | Slow orbit (11s / 17s counter-rotating) | Dim breathe, 5s, 0.35 to 0.6 | "Companion" |
| `listening` | Orbit slows to 40s / 60s and settles 12 units down, toward the input | Steady 0.6 to 0.75, 3s | "Listening" |
| `thinking` | Fast orbit 2.4s / 3.6s | Quick pulse 1.1s, 0.4 to 0.9 | "Thinking" |
| `streaming` | S1 Lift per chunk, normal idle orbit between chunks | Bright on chunk (0.9), settles to 0.55 | "Replying" |
| `error` | Drained to zinc, motion stopped | Amber, slow 2.6s breathe | e.g. "Couldn't reach Gemini" (from `errorHint`) |

| Overlay | Visual | Label |
|---|---|---|
| `prod` | P1 lower rim light + warm tint; idle-style motion of the primary state continues | "<site name>, Production" |
| `noticing` | Small brand-blue dot at top-right (same as the current avatar's dot) | the notice title |

Transitions between states crossfade glow and inner-light parameters with existing motion tokens
(`--ferry-motion-standard` 170ms in, `--ferry-motion-exit` 140ms out, `--ferry-motion-ease-spring`, no overshoot).

### Size rules

| Size | Where | Rendering |
|---|---|---|
| 96px | Empty chat state in `CompanionPanel.vue` (currently 30px) | Full: blurred inner light, caustic, all motion |
| 20px | Panel header | Full layers, motion only while the panel is open |
| 16px | `CompanionTrigger.vue` top bar | No SVG blur filters, no inner motion. State shown by glow colour/strength, the prod rim arc (thicker stroke) and the noticing dot. Completely still in `idle` and `prod`. |

### Static at rest

Following `DESIGN.md` rule 5 and the brief's "pause when idle": all infinite animations run only when the orb is
visible **and** (the panel is open **or** the state is `thinking` / `streaming`). Animations stop when
`document.visibilityState === 'hidden'` or the window loses focus. The top-bar orb is therefore still almost all the time.

### Reduced motion and transparency

- `prefers-reduced-motion: reduce`: no orbit, no lift, no caustic shimmer. Glow opacity still changes per state
  (instant or short crossfade). The chunked reveal is skipped (full text at once).
- `prefers-reduced-transparency: reduce`: no change needed (the orb is opaque), but the glow drops to half strength.
- Classic UI (no `html.ferry-glass`): same orb; it is opaque and does not depend on the ambient canvas.

## 5. How it fits the code

### 5.1 Component

`CompanionAvatar.vue` is rewritten in place (same name and props, `state` and `size`), so `CompanionTrigger.vue` and
`CompanionPanel.vue` keep working. New props: `prod?: boolean`, `noticing?: boolean`.
SVG `viewBox="0 0 100 100"`, gradient/filter/clip ids made unique per instance (`useId()`).
State goes onto `data-companion-state`; per-state timings and opacities are CSS custom properties on that attribute.
No new dependencies. `aria-hidden="true"` stays on the orb; labels live in the surrounding UI (tooltip in the
trigger, text in the panel header).

### 5.2 Store state

`CompanionAvatarState` in `companion.store.ts` becomes
`'idle' | 'listening' | 'thinking' | 'streaming' | 'error'`.

| Old | New | Set where |
|---|---|---|
| `resting` | `idle` | default |
| `helping` | `thinking` | `requestAiChat`, `ensureReleasesLoaded` (unchanged call sites) |
| `talking` | `streaming` | during the chunked reveal (replaces `pulseTalking`'s 900ms timer) |
| `noticing` | overlay | `effectiveAvatarState` currently returns `noticing`; it becomes a separate `hasNotice` getter (notice present and not quiet mode) |
| new | `listening` | panel input focused and non-empty; `CompanionPanel.vue` calls a store action `setListening(boolean)` |
| new | `error` | `deliverAiOrLocalReply` when `aiErrorHint` is set; cleared on the next `ask` or when the panel closes |

`prod` overlay: a getter that is true when the active session tab's saved site has `environment === 'prod'`
(same lookup as `SiteTabBar.vue`'s `envBorder`). Precedence of primary state when several apply:
`thinking` > `streaming` > `error` > `listening` > `idle`.

### 5.3 Chunked reveal (option 2)

When an assistant message is pushed in `deliverAiOrLocalReply` (both AI and local replies), the panel reveals its
text 2 to 3 words per tick, with the tick interval chosen so the whole reveal lasts at most ~1.2s. Each tick fires the
S1 lift. Command cards, UI action cards and actions appear when the reveal finishes. The store keeps the full text from
the start; only the rendering is progressive.
Accessibility: the message container is `aria-busy="true"` during the reveal so screen readers announce the full text
once at the end. Reduced motion: no reveal. Leaving the chat view or a new message arriving completes the current reveal
instantly. This is a seam for real streaming later: the orb only needs "a chunk arrived" events.

## 6. Approaches considered

| | Approach | Trade-off | Outcome |
|---|---|---|---|
| A | Inline SVG + CSS component | Small, testable, no dependency; SVG blur cost must be checked | **Chosen** |
| B | Canvas / WebGL shader | Richer liquid light; much more code, competes with `xterm.js` WebGL contexts, harder reduced-motion | Rejected |
| C | Pre-rendered Lottie / video | Designer-tunable; cannot react per chunk, adds a dependency and asset per state | Rejected |

Streaming source: real provider streaming (bigger backend change, later), **client-side chunked reveal (chosen)**,
or no streaming state (drops a chosen state).

## 7. Verification

- Unit tests: state precedence and the `prod` / `noticing` overlays in `companion.store.ts`; the reveal chunker
  (chunk count, total duration cap, reduced-motion bypass, instant completion on interrupt).
- Update `src/renderer/src/utils/companionStress.test.ts:208` (`'talking'` becomes `'streaming'`).
- Component test: each `state` renders its `data-companion-state`; 16px renders no `<filter>` elements.
- Manual: all six states in light/dark, Classic/Glass, with reduced motion on; 16px legibility in the top bar.
- Performance: with an active terminal session running `top` or `tail -F`, compare renderer CPU/GPU with the panel
  closed (orb static) and open in `thinking`. Panel closed must show no measurable difference from the old avatar.
- `npm run typecheck` and `npm test` pass.

## 8. Left to the builder

- Exact SVG geometry and blur radii (start from the mockup files listed at the top).
- Whether the glow at 16px uses a CSS radial-gradient instead of an SVG filter.
- Light-mode tuning of glow strength (mockups were judged on dark backgrounds).
- Wording of state tooltips, following the label column above.

## 9. Calls made without explicit sign-off

- `noticing` kept as a small brand-blue dot overlay.
- `error` clears on the next question or when the panel closes.
- Hero size 96px in the empty chat state (was 30px).
- The chunked reveal applies to local (non-AI) replies too, so the orb behaves the same with AI off.

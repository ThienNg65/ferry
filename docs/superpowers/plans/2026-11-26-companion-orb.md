# Companion Orb (Aurora) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ferry-hull Companion avatar with the "Aurora" glossy orb: five primary states plus `prod`/`noticing` overlays, driven by a client-side chunked reveal of assistant replies.

**Architecture:** A pure reveal planner (`companionReveal.ts`) splits a reply into ≤20 timed chunks. `companion.store.ts` drops the stored `avatarState`/`pulseTalking` timer and derives the orb state from existing flags (`aiBusy`, `releasesLoading`) plus three new pieces of state (`reveal`, `aiErrorLabel`, `listening`). `CompanionAvatar.vue` is rewritten in place as one inline SVG + scoped CSS component whose per-state look lives in CSS custom properties on `data-companion-state`.

**Tech Stack:** Vue 3.5 (`<script setup>`, `useId()`), Pinia options store, Tailwind v4 / Nuxt UI v4, Vitest + happy-dom + `@vue/test-utils`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-26-companion-orb-design.md` (sections 3, 4, 6 are decided; section 9 calls stand).
Visual reference for SVG geometry: `.superpowers/brainstorm/12799-1795624210/content/aurora-states-v2.html` (function `orb()`) and `streaming-prod-options.html` (S1 `.lift`, P1 `rimArc`). Copy geometry, not code style; the spec's fixed palette overrides the mockups' `--acc` colours.

## Global Constraints

- No new dependencies. If `npm install` is ever needed: `npm install --registry=https://registry.npmjs.org`.
- Run `npm run typecheck` before every build; `npm test` for the suite; single file `npx vitest run <path>`.
- Conventional Commits; no AI attribution, `Co-Authored-By` or "Generated with" trailers. **Ask the user before every commit** (spec and handoff files are still uncommitted; ask whether the spec goes into the first commit).
- Never `git add` anything under `.superpowers/` (not gitignored). `.claude/PROJECT_MAP.md` is gitignored: edit it, don't try to commit it.
- Branch: `feat/ferry-companion-78`.
- Palette is fixed brand blue, never the accent: body `#a9e6ff`, `#3a7ce8`, `#2a2f9c`, `#140f5c`; inner lights `#5ee7ff`, `oklch(0.62 0.18 295)`, `#c9ecff`; glow `#6f8cff`; prod rim `var(--ui-error)`; failure glow `var(--ui-warning)`; failure body `#d4d4d8`, `#71717a`, `#3f3f46`, `#18181b`.
- Red only for production, amber only for failure. Every state has a text label or tooltip; the orb itself stays `aria-hidden="true"`.
- Motion tokens only (`--ferry-motion-standard` 170ms in, `--ferry-motion-exit` 140ms out, `--ferry-motion-ease-spring`), no overshoot. JS timings come from `FERRY_MOTION_TOKENS` / `prefersReducedMotion()` in `src/renderer/src/utils/motionTokens.ts`.
- Static at rest: infinite animations run only when the window is visible and focused **and** (the orb is `live`, i.e. inside the open panel, **or** state is `thinking`/`streaming`).
- 16px: no `<filter>` elements, no inner-light motion; completely still in `idle` (with or without `prod`).
- `prefers-reduced-motion: reduce`: no orbit, lift, caustic shimmer, no chunked reveal; glow opacity still changes per state. `prefers-reduced-transparency: reduce`: glow at half strength.

## Review Focus

1. **AI reply arrives while the panel is closed** (user closed it during `thinking`). Expected: the top-bar orb goes `thinking` → `streaming` for at most ~1.2s → `idle`; the stored message is complete when the panel reopens. Closing the panel mid-reveal completes it at once. Test in Task 2 (`reveals a local reply in chunks, then returns to idle`, run with the panel closed, and `completes the reveal when the panel closes`).
2. **Two replies in quick succession / user sends while a reveal runs.** Expected: the earlier message shows its full text and cards instantly; only the newest reveals. Test in Task 2 (`a new message completes the running reveal`).
3. **Very long reply (e.g. 1,500 words).** Expected: still ≤20 ticks, ≤1.2s total, final text identical to the stored text, whitespace and newlines (`whitespace-pre-line`) preserved. Test in Task 1 (`caps a long reply at 20 chunks` and `joins back to the exact text`).
4. **Window blurred or hidden while `thinking`.** Expected: orb animations stop; they resume on focus. Test in Task 3 (`stops animating when the window loses focus`).
5. **Several orbs mounted at once** (trigger, panel header, empty-state hero, notice bubble). Expected: gradient/filter/clip ids never collide, so each orb renders its own state colours. Test in Task 3 (`gives each instance unique defs ids`).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/renderer/src/utils/companionReveal.ts` | Create | Pure reveal planner: text → chunks + tick interval |
| `src/renderer/src/utils/companionReveal.test.ts` | Create | Planner unit tests |
| `src/renderer/src/stores/companion.store.ts` | Modify | State union, derived orb state/labels, reveal timer, listening, error |
| `src/renderer/src/stores/__tests__/companion.store.test.ts` | Modify | Precedence, overlays, reveal lifecycle, error clear |
| `src/renderer/src/utils/companionStress.test.ts` | Modify (line 208) | `'talking'` → `'streaming'` |
| `src/renderer/src/components/companion/CompanionAvatar.vue` | Rewrite | Aurora orb SVG + CSS |
| `src/renderer/src/components/companion/__tests__/CompanionAvatar.test.ts` | Create | Component tests |
| `src/renderer/src/components/companion/CompanionTrigger.vue` | Modify (~22, ~132, ~150) | Pass state/prod/noticing, tooltip label |
| `src/renderer/src/components/companion/CompanionPanel.vue` | Modify (~277, ~466, message list ~489, input ~958) | Header label, 96px hero, progressive text, `aria-busy`, listening |
| `src/renderer/src/components/companion/__tests__/CompanionPanel.test.ts` | Modify | Reveal rendering, listening, hero size |

---

### Task 1: Reveal planner util

**Files:**
- Create: `src/renderer/src/utils/companionReveal.ts`
- Test: `src/renderer/src/utils/companionReveal.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const REVEAL_TICK_MS = 60
  export const REVEAL_MAX_TOTAL_MS = 1200
  export interface RevealPlan { chunks: string[]; tickMs: number }
  export function planReveal(text: string, reducedMotion: boolean): RevealPlan | null
  ```
  `null` means "no reveal, show full text now" (reduced motion, empty/whitespace text, or a single chunk).

- [ ] **Step 1: Write the failing tests** in `companionReveal.test.ts` (plain node env, no DOM):

```ts
import { describe, expect, it } from 'vitest'
import { planReveal, REVEAL_MAX_TOTAL_MS, REVEAL_TICK_MS } from './companionReveal'

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

describe('planReveal', () => {
  it('groups 3 words per chunk for short replies', () => {
    const plan = planReveal(words(9), false)!
    expect(plan.chunks).toHaveLength(3)
    expect(plan.tickMs).toBe(REVEAL_TICK_MS)
  })

  it('caps a long reply at 20 chunks within the total duration', () => {
    const plan = planReveal(words(1500), false)!
    expect(plan.chunks.length).toBeLessThanOrEqual(REVEAL_MAX_TOTAL_MS / REVEAL_TICK_MS)
    expect(plan.chunks.length * plan.tickMs).toBeLessThanOrEqual(REVEAL_MAX_TOTAL_MS)
  })

  it('joins back to the exact text, keeping newlines and leading whitespace', () => {
    const text = '  First line here.\n\nSecond   paragraph with more words and a tail \n'
    expect(planReveal(text, false)!.chunks.join('')).toBe(text)
  })

  it('returns null under reduced motion', () => {
    expect(planReveal(words(30), true)).toBeNull()
  })

  it('returns null for empty text or a single chunk', () => {
    expect(planReveal('   ', false)).toBeNull()
    expect(planReveal('two words', false)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**
Run: `npx vitest run src/renderer/src/utils/companionReveal.test.ts`
Expected: FAIL, module `./companionReveal` not found.

- [ ] **Step 3: Implement `planReveal` in `companionReveal.ts`.**
Tokenise with `text.match(/\s*\S+\s*/g)` style matching so every character lands in some token (leading whitespace stays on the first token, trailing on the last). Words per chunk = `max(3, ceil(tokens / maxChunks))` where `maxChunks = floor(REVEAL_MAX_TOTAL_MS / REVEAL_TICK_MS)` (= 20). `tickMs` is always `REVEAL_TICK_MS`. Return `null` when `reducedMotion`, no tokens, or the result has fewer than 2 chunks.

- [ ] **Step 4: Run to verify pass** — same command, Expected: 5 passed.

- [ ] **Step 5: Commit (ask first)**
```bash
git add src/renderer/src/utils/companionReveal.ts src/renderer/src/utils/companionReveal.test.ts
git commit -m "feat(companion): add chunked reply reveal planner"
```

---

### Task 2: Store — orb state model and reveal lifecycle

**Files:**
- Modify: `src/renderer/src/stores/companion.store.ts` (type ~75, state ~230–300, getters ~306, `closePanel` ~460, `ensureReleasesLoaded` ~628, `pulseTalking` ~702, `requestAiChat` ~713, `pushMessage` ~757, `deliverAiOrLocalReply` ~768, `clearConversation` ~1167, `disposeTimers` ~1171, `reset` ~1182)
- Modify: `src/renderer/src/utils/companionStress.test.ts:208`
- Test: `src/renderer/src/stores/__tests__/companion.store.test.ts`

**Interfaces:**
- Consumes: `planReveal(text, reducedMotion)` from Task 1; `prefersReducedMotion()` from `utils/motionTokens.ts`; `useSitesStore` (`sites.store.ts`), `useSessionsStore().activeTab` (`{ siteId, label }`).
- Produces (used by Tasks 3–4):
  ```ts
  export type CompanionAvatarState = 'idle' | 'listening' | 'thinking' | 'streaming' | 'error'
  export interface CompanionReveal { messageId: string; chunks: string[]; shown: number }
  // state
  reveal: CompanionReveal | null
  revealTimer: ReturnType<typeof setInterval> | null
  aiErrorLabel: string | null      // e.g. "Couldn't reach Gemini"
  listening: boolean
  // getters
  effectiveAvatarState: CompanionAvatarState
  hasNotice: boolean               // notice !== null && !quietMode
  prodSiteLabel: string | null     // "<site name>, Production" or null
  isProd: boolean                  // prodSiteLabel !== null
  avatarLabel: string              // 'Companion' | 'Listening' | 'Thinking' | 'Replying' | aiErrorLabel
  // actions
  setListening(value: boolean): void
  startReveal(messageId: string, text: string): void
  finishReveal(): void
  pushMessage(msg): string         // now returns the new message id
  ```
- Removed: `avatarState` field, `talkingTimer`, `pulseTalking()`. Old values map: `resting`→`idle`, `helping`→`thinking`, `talking`→`streaming`, `noticing`→`hasNotice` overlay.

- [ ] **Step 1: Write the failing store tests** (new `describe('orb state')` block in `companion.store.test.ts`; file already uses happy-dom and fake timers):

```ts
describe('orb state', () => {
  it('defaults to idle', () => {
    expect(useCompanionStore().effectiveAvatarState).toBe('idle')
  })

  it('applies precedence thinking > streaming > error > listening > idle', () => {
    const s = useCompanionStore()
    s.$patch({ listening: true })
    expect(s.effectiveAvatarState).toBe('listening')
    s.$patch({ aiErrorLabel: "Couldn't reach Gemini" })
    expect(s.effectiveAvatarState).toBe('error')
    s.$patch({ reveal: { messageId: 'm', chunks: ['a ', 'b'], shown: 1 } })
    expect(s.effectiveAvatarState).toBe('streaming')
    s.$patch({ aiBusy: true })
    expect(s.effectiveAvatarState).toBe('thinking')
    s.$patch({ aiBusy: false, releasesLoading: true })
    expect(s.effectiveAvatarState).toBe('thinking')
  })

  it('keeps noticing as an overlay, hidden in quiet mode', () => {
    const s = useCompanionStore()
    s.$patch({ notice: { id: 'n', kind: 'greeting', title: 'Hi', body: '', ctaLabel: 'Open' } })
    expect(s.hasNotice).toBe(true)
    expect(s.effectiveAvatarState).toBe('idle')
    s.$patch({ quietMode: true })
    expect(s.hasNotice).toBe(false)
  })

  it('reports prod when the active tab site is production', () => {
    const sites = useSitesStore()
    sites.$patch({ sites: [{ id: 'site-1', name: 'prod-db-01', environment: 'prod' } as never] })
    const sessions = useSessionsStore()
    sessions.activeTab.siteId = 'site-1'
    const s = useCompanionStore()
    expect(s.isProd).toBe(true)
    expect(s.prodSiteLabel).toBe('prod-db-01, Production')
    sites.sites[0].environment = 'staging'
    expect(s.isProd).toBe(false)
  })

  it('reveals a local reply in chunks, then returns to idle', async () => {
    const s = useCompanionStore()
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    expect(s.effectiveAvatarState).toBe('streaming')
    expect(s.reveal?.shown).toBe(1)
    vi.advanceTimersByTime(2000)
    expect(s.reveal).toBeNull()
    expect(s.effectiveAvatarState).toBe('idle')
    expect(s.messages.at(-1)?.text).toBe('one two three four five six seven')
  })

  it('a new message completes the running reveal', async () => {
    const s = useCompanionStore()
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    s.pushMessage({ role: 'user', text: 'next' })
    expect(s.reveal).toBeNull()
  })

  it('completes the reveal when the panel closes or the conversation clears', async () => {
    const s = useCompanionStore()
    s.openPanel()
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    s.closePanel()
    expect(s.reveal).toBeNull()
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    s.clearConversation()
    expect(s.reveal).toBeNull()
  })

  it('skips the reveal under reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }) as MediaQueryList)
    const s = useCompanionStore()
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    expect(s.reveal).toBeNull()
    vi.unstubAllGlobals()
  })

  it('sets error on AI failure and clears it on the next reply and on close', async () => {
    const prevApi = (window as { api?: unknown }).api
    ;(window as { api?: unknown }).api = { invoke: vi.fn().mockRejectedValue(new Error('boom')) }
    const s = useCompanionStore()
    s.aiConfig = { provider: 'gemini', endpoint: 'x', model: 'm', hasApiKey: true }
    await s.deliverAiOrLocalReply({ aiPrompt: 'hi', errorPrefix: '', buildLocal: () => ({ text: 'local' }) })
    expect(s.aiErrorLabel).toBe("Couldn't reach Gemini")
    s.closePanel()
    expect(s.aiErrorLabel).toBeNull()
    ;(window as { api?: unknown }).api = prevApi
  })

  it('setListening toggles listening and closePanel clears it', () => {
    const s = useCompanionStore()
    s.setListening(true)
    expect(s.effectiveAvatarState).toBe('listening')
    s.closePanel()
    expect(s.listening).toBe(false)
  })
})
```
Imports to add: `useSitesStore` from `../sites.store` (and `useSessionsStore` is already imported). If the sites store's `sites` element type needs more fields, cast as shown.

- [ ] **Step 2: Update the stress test** `companionStress.test.ts:208`:
`expect(store.avatarState).toBe('talking')` → `expect(store.effectiveAvatarState).toBe('streaming')`, and add `expect(store.aiErrorLabel).toBe("Couldn't reach Gemini")` on the next line.

- [ ] **Step 3: Run to verify failure**
Run: `npx vitest run src/renderer/src/stores/__tests__/companion.store.test.ts src/renderer/src/utils/companionStress.test.ts`
Expected: FAIL (`listening`, `reveal`, `aiErrorLabel`, `hasNotice`, `isProd` undefined; `'resting'` ≠ `'idle'`).

- [ ] **Step 4: Implement in `companion.store.ts`**
  - Replace the type union; delete `avatarState`, `talkingTimer`, `pulseTalking()` and every `this.avatarState = …` line (in `closePanel`, `ensureReleasesLoaded`, `requestAiChat`, `reset`). `aiBusy` and `releasesLoading` already bracket the same work, so `thinking` derives from them.
  - `effectiveAvatarState`: `aiBusy || releasesLoading` → `thinking`; `reveal` → `streaming`; `aiErrorLabel` → `error`; `listening` → `listening`; else `idle`.
  - `prodSiteLabel`: active tab's `siteId` → `useSitesStore().sites.find(...)`; when `environment === 'prod'` return `` `${tab.label ?? site.name}, Production` `` (same lookup as `SiteTabBar.vue` `envBorder`).
  - `avatarLabel` map: idle `'Companion'`, listening `'Listening'`, thinking `'Thinking'`, streaming `'Replying'`, error `aiErrorLabel`.
  - `pushMessage`: call `this.finishReveal()` first, return the new id.
  - `startReveal(id, text)`: `finishReveal()`; `planReveal(text, prefersReducedMotion())`; on null return; set `reveal = { messageId: id, chunks, shown: 1 }` and a `setInterval(tickMs)` that increments `shown` and calls `finishReveal()` once `shown >= chunks.length`.
  - `finishReveal()`: clear interval, `reveal = null`. Call it from `closePanel`, `clearConversation`, `disposeTimers` (replacing the `talkingTimer` block).
  - `deliverAiOrLocalReply`: set `this.aiErrorLabel = null` at the top; after each `pushMessage` call `this.startReveal(id, text)` instead of `pulseTalking()`; when `aiErrorHint` is set, `this.aiErrorLabel = \`Couldn't reach ${PROVIDER_LABEL[this.aiConfig.provider]}\`` with `const PROVIDER_LABEL: Record<CompanionAiProvider, string> = { none: 'AI', gemini: 'Gemini', 'ferry-pro': 'Ferry Pro' }`.
  - `closePanel`: `finishReveal()`, `aiErrorLabel = null`, `listening = false`. `setListening(v)`: `this.listening = v`. `reset()`: reset the three new fields.
  - The reveal runs whether or not the panel is open (the stress test's store is never opened and must reach `'streaming'`); `closePanel` completing it is what keeps a closed panel quiet.

- [ ] **Step 5: Run to verify pass**
Run: `npx vitest run src/renderer/src/stores/__tests__/companion.store.test.ts src/renderer/src/utils/companionStress.test.ts`, then `npm run typecheck`.
Expected: all pass; typecheck will still fail in `CompanionAvatar.vue`, `CompanionTrigger.vue` and `CompanionPanel.vue` on the removed `'resting'`/`'noticing'` literals — those are fixed in Tasks 3–4. Any other typecheck error must be fixed now.

- [ ] **Step 6: Commit (ask first)** — commit together with Task 3 if the user prefers a green typecheck per commit.
```bash
git add src/renderer/src/stores/companion.store.ts src/renderer/src/stores/__tests__/companion.store.test.ts src/renderer/src/utils/companionStress.test.ts
git commit -m "feat(companion): derive orb state from store with chunked reveal"
```

---

### Task 3: `CompanionAvatar.vue` Aurora rewrite

**Files:**
- Rewrite: `src/renderer/src/components/companion/CompanionAvatar.vue`
- Test: `src/renderer/src/components/companion/__tests__/CompanionAvatar.test.ts`

**Interfaces:**
- Consumes: `CompanionAvatarState` (Task 2).
- Produces props (Task 4 uses them):
  ```ts
  state?: CompanionAvatarState   // default 'idle'
  size?: number                  // default 18
  prod?: boolean                 // default false
  noticing?: boolean             // default false
  chunk?: number                 // default 0; each change fires one S1 lift
  live?: boolean                 // default false; true inside the open panel
  ```
  `chunk` and `live` are additions beyond the spec's `prod`/`noticing`: the orb needs a per-chunk signal for S1 and a way to know it sits in the open panel for the static-at-rest rule.
- Root element: `<span aria-hidden="true" :data-companion-state="state" :data-animate="running" :data-orb-size="size < 24 ? 'small' : 'full'">`.

- [ ] **Step 1: Write the failing component tests** (`// @vitest-environment happy-dom`, `mount` from `@vue/test-utils`):

```ts
it.each(['idle', 'listening', 'thinking', 'streaming', 'error'] as const)('renders data-companion-state=%s', (state) => {
  const w = mount(CompanionAvatar, { props: { state, size: 20 } })
  expect(w.attributes('data-companion-state')).toBe(state)
  expect(w.attributes('aria-hidden')).toBe('true')
})

it('renders no SVG filters at 16px and filters at 96px', () => {
  expect(mount(CompanionAvatar, { props: { size: 16 } }).findAll('filter')).toHaveLength(0)
  expect(mount(CompanionAvatar, { props: { size: 96 } }).findAll('filter').length).toBeGreaterThan(0)
})

it('draws the prod rim arc and the noticing dot only when asked', () => {
  const plain = mount(CompanionAvatar, { props: { size: 20 } })
  expect(plain.find('[data-orb-prod]').exists()).toBe(false)
  expect(plain.find('[data-orb-notice]').exists()).toBe(false)
  const both = mount(CompanionAvatar, { props: { size: 16, prod: true, noticing: true } })
  expect(both.find('[data-orb-prod]').exists()).toBe(true)
  expect(both.find('[data-orb-notice]').exists()).toBe(true)
})

it('gives each instance unique defs ids', () => {
  const ids = [mount(CompanionAvatar, { props: { size: 96 } }), mount(CompanionAvatar, { props: { size: 96 } })]
    .flatMap((w) => w.findAll('[id]').map((n) => n.attributes('id')))
  expect(new Set(ids).size).toBe(ids.length)
})

it('is static at rest and animates while thinking or live', async () => {
  expect(mount(CompanionAvatar, { props: { state: 'idle' } }).attributes('data-animate')).toBe('false')
  expect(mount(CompanionAvatar, { props: { state: 'thinking' } }).attributes('data-animate')).toBe('true')
  expect(mount(CompanionAvatar, { props: { state: 'idle', live: true } }).attributes('data-animate')).toBe('true')
})

it('stops animating when the window loses focus', async () => {
  const w = mount(CompanionAvatar, { props: { state: 'thinking' } })
  window.dispatchEvent(new Event('blur'))
  await nextTick()
  expect(w.attributes('data-animate')).toBe('false')
  window.dispatchEvent(new Event('focus'))
  await nextTick()
  expect(w.attributes('data-animate')).toBe('true')
})

it('lifts once per chunk change', async () => {
  const w = mount(CompanionAvatar, { props: { state: 'streaming', size: 96, chunk: 1 } })
  await w.setProps({ chunk: 2 })
  expect(w.find('[data-orb-lift]').classes()).toContain('is-lifting')
})
```

- [ ] **Step 2: Run to verify failure**
Run: `npx vitest run src/renderer/src/components/companion/__tests__/CompanionAvatar.test.ts`
Expected: FAIL (old avatar: `resting` default, no filters, no data attributes).

- [ ] **Step 3: Rewrite `CompanionAvatar.vue`.** Layers in `viewBox="0 0 100 100"`, geometry from `aurora-states-v2.html` `orb()`:
  1. Glow: `<circle cx=50 cy=52 r=46>` fill `var(--orb-glow)`, full size blurred with `feGaussianBlur stdDeviation=9`; small size uses a `radialGradient` fill (glow colour → transparent) instead of a filter. Opacity `calc(var(--orb-glow-lo) * var(--orb-glow-scale))`, breathing to `--orb-glow-hi` over `--orb-glow-dur` when animating.
  2. Body: `<circle r=44>` with `radialGradient cx=38% cy=30% r=78%`, stops 0/.35/.75/1 bound to `--orb-b0..b3`.
  3. Full size only, clipped to `r=44`: a `<g data-orb-lift>` (S1) containing a `<g>` translated `0 12` when `listening` (transitioned), containing the `blur(9)` + `mix-blend-mode: screen` group of three inner lights: `(30,34,r20) --orb-l1` orbit1, `(70,62,r24) --orb-l2` orbit2, `(64,30,r11) --orb-l3` orbit1, opacity .85. Then caustic `<ellipse cx=54 cy=82 rx=24 ry=9>` fill `--orb-caustic` with `blur(4)`, then the vignette radialGradient (`cx=50% cy=45% r=55%`, transparent at .6 → `#020617` @ .55).
  4. Soft highlight `<ellipse cx=38 cy=27 rx=17 ry=10 opacity=.35>` with `blur(2)` (full only); sharp highlight `<ellipse cx=35 cy=25 rx=7 ry=3.6 opacity=.95 rotate(-25 35 25)>` (always).
  5. Rim `<circle r=43.4>` stroke = white linearGradient (`.9 → .05 @ .45 → .5`), width `size < 24 ? 3 : 1.2`.
  6. `prod`: `<path data-orb-prod d="M87.6,71.7 A43.4,43.4 0 0 1 12.4,71.7">` stroke `var(--ui-error)`, linecap round, width `small ? 5 : 1.6`, plus at full size a second blurred (`blur(2)`) copy at width 4; body/inner stops become `color-mix(in oklab, <stop> 74%, var(--ui-error))`.
  7. `noticing`: `<span data-orb-notice>` positioned top-right, the current avatar's dot classes (`absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-default`) but with background `#3a7ce8` (fixed brand blue, not `bg-primary`).
  - Ids: `const uid = useId()`; every `id`/`url(#…)` uses `` `${uid}-base` `` etc.
  - Per-state custom properties in a scoped `<style>` keyed on `[data-companion-state=…]` (orbit 1/2 durations, glow lo/hi/duration): idle 11s/17s, 5s, .35→.6; listening 40s/60s, 3s, .6→.75; thinking 2.4s/3.6s, 1.1s, .4→.9; streaming 11s/17s between chunks, 2s, .55 (bright .9 during a lift); error: no orbit, 2.6s, .3→.6, glow `var(--ui-warning)`, body/lights zinc stops. Transition `opacity`, `stop-color`, `fill` and the listening `transform` with `var(--ferry-motion-standard) var(--ferry-motion-ease-spring)`.
  - Animation gate: `running = windowActive && (live || state === 'thinking' || state === 'streaming')`. `windowActive` ref = `document.visibilityState === 'visible' && document.hasFocus()`, updated from `visibilitychange`, `focus`, `blur` listeners added `onMounted` / removed `onBeforeUnmount`. CSS: `[data-animate='false'] * { animation: none !important; }`. Small size: only the glow breathe may animate (no orbit, no caustic); in `idle` small is fully still by the same gate.
  - Lift: `watch(() => props.chunk, (n, o) => { if (n > o) { lifting = true; clearTimeout; setTimeout(() => lifting = false, FERRY_MOTION_TOKENS.duration.fast) } })`; `.is-lifting { transform: translateY(-9px); }` with `--ferry-motion-fast`/ease-out up, settle via `--ferry-motion-considered` + `--ferry-motion-ease-spring`; glow to .9 while lifting. Clear the timeout on unmount.
  - `@media (prefers-reduced-motion: reduce)`: no orbit/caustic/breathe animations, no lift transform (glow opacity still set per state). `@media (prefers-reduced-transparency: reduce)`: `--orb-glow-scale: .5` (default 1).
  - Keep `aria-hidden="true"`; no text inside.

- [ ] **Step 4: Run to verify pass**
Run: `npx vitest run src/renderer/src/components/companion/__tests__/CompanionAvatar.test.ts` — Expected: all pass.

- [ ] **Step 5: Commit (ask first)**
```bash
git add src/renderer/src/components/companion/CompanionAvatar.vue src/renderer/src/components/companion/__tests__/CompanionAvatar.test.ts
git commit -m "feat(companion): replace hull avatar with Aurora orb"
```

---

### Task 4: Wire trigger and panel

**Files:**
- Modify: `src/renderer/src/components/companion/CompanionTrigger.vue` (~22 tooltip, ~132, ~150)
- Modify: `src/renderer/src/components/companion/CompanionPanel.vue` (~22 refs, ~277 header, ~466 hero, ~489 message log, ~958 input)
- Test: `src/renderer/src/components/companion/__tests__/CompanionPanel.test.ts`

**Interfaces:**
- Consumes: store `effectiveAvatarState`, `avatarLabel`, `isProd`, `prodSiteLabel`, `hasNotice`, `reveal`, `setListening` (Task 2); avatar props `state`, `size`, `prod`, `noticing`, `chunk`, `live` (Task 3).

- [ ] **Step 1: Write the failing panel tests** (add to `CompanionPanel.test.ts`, reuse its `stubs`; use `vi.useFakeTimers()` for the reveal test):

```ts
it('renders the empty-state hero orb at 96px', () => {
  const s = useCompanionStore(); s.open = true
  const w = mount(CompanionPanel, { global: { stubs } })
  expect(w.find('[data-companion-hero] [data-companion-state]').attributes('style')).toContain('width: 96px')
})

it('reveals the reply progressively and shows cards only afterwards', async () => {
  vi.useFakeTimers()
  const s = useCompanionStore(); s.openPanel()
  const w = mount(CompanionPanel, { global: { stubs } })
  await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven', actions: [{ id: 'open-settings', label: 'Check AI Settings' }] }) })
  await nextTick()
  expect(w.find('[role="log"]').attributes('aria-busy')).toBe('true')
  expect(w.text()).not.toContain('seven')
  expect(w.text()).not.toContain('Check AI Settings')
  vi.advanceTimersByTime(2000); await nextTick()
  expect(w.find('[role="log"]').attributes('aria-busy')).toBe('false')
  expect(w.text()).toContain('one two three four five six seven')
  expect(w.text()).toContain('Check AI Settings')
  vi.useRealTimers()
})

it('sets listening while the focused input has text', async () => {
  const s = useCompanionStore(); s.openPanel()
  const w = mount(CompanionPanel, { global: { stubs } })
  const input = w.find('input[aria-label="Ask Ferry Companion"]')
  await input.trigger('focus'); await input.setValue('hel')
  expect(s.listening).toBe(true)
  await input.trigger('blur')
  expect(s.listening).toBe(false)
})

it('completes the reveal when leaving the chat view', async () => {
  vi.useFakeTimers()
  const s = useCompanionStore(); s.openPanel()
  mount(CompanionPanel, { global: { stubs } })
  await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
  s.activeView = 'snippets'; await nextTick()
  expect(s.reveal).toBeNull()
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run to verify failure**
Run: `npx vitest run src/renderer/src/components/companion/__tests__/CompanionPanel.test.ts`
Expected: the four new tests FAIL; existing ones still pass.

- [ ] **Step 3: `CompanionTrigger.vue`**
  - Line ~132: `<CompanionAvatar :state="companion.effectiveAvatarState" :size="16" :prod="companion.isProd" :noticing="companion.hasNotice" />` (16px never gets `live`/`chunk`).
  - Line ~150 (notice bubble): `<CompanionAvatar :size="16" noticing />`.
  - `tooltipText`: when closed, prefix the status: `[companion.effectiveAvatarState !== 'idle' ? companion.avatarLabel : null, companion.prodSiteLabel, 'Ferry Companion (Ctrl+Space)'].filter(Boolean).join(' · ')`; open stays `'Close Ferry Companion (Ctrl+Space)'`. `aria-label` already binds `tooltipText`, so the label reaches screen readers too.

- [ ] **Step 4: `CompanionPanel.vue`**
  - Header (~277): `<CompanionAvatar :state="companion.effectiveAvatarState" :size="20" :prod="companion.isProd" :chunk="companion.reveal?.shown ?? 0" live />`. Subtitle: `'Quiet Mode on'` when quiet; otherwise when state is `idle` and not prod, the existing tagline; otherwise `[state !== 'idle' ? avatarLabel : null, prodSiteLabel].filter(Boolean).join(' · ')`.
  - Hero (~466): remove the `rounded-full bg-primary/10 p-3 ring-1 …` wrapper, put `data-companion-hero` on a plain wrapper, `<CompanionAvatar :state="companion.effectiveAvatarState" :size="96" :prod="companion.isProd" live />`.
  - Message log (~489): `:aria-busy="companion.reveal !== null"` on the `role="log"` div. Add helpers `isRevealing(msg) = companion.reveal?.messageId === msg.id` and `displayText(msg) = isRevealing(msg) ? reveal.chunks.slice(0, reveal.shown).join('') : msg.text`; render `{{ displayText(msg) }}`; wrap root cause, command cards, UI action cards, release card, action chips and the feedback row in `<template v-if="!isRevealing(msg)">`.
  - `watch(() => companion.activeView, (v) => { if (v !== 'chat') companion.finishReveal() })` (extend the existing activeView watch at ~150).
  - Input (~958): `inputFocused` ref with `@focus`/`@blur`; `watch([inputFocused, draftInput], ([f, t]) => companion.setListening(f && t.trim() !== ''))`; `onBeforeUnmount(() => companion.setListening(false))`.

- [ ] **Step 5: Run to verify pass**
Run: `npx vitest run src/renderer/src/components/companion/` then `npm run typecheck` then `npm test`.
Expected: all pass, typecheck clean (no remaining `'resting'`/`'noticing'`/`'helping'`/`'talking'` literals: confirm with `rg "'(resting|helping|talking)'" src/renderer`; `'noticing'` should only remain as a prop name).

- [ ] **Step 6: Commit (ask first)**
```bash
git add src/renderer/src/components/companion/CompanionTrigger.vue src/renderer/src/components/companion/CompanionPanel.vue src/renderer/src/components/companion/__tests__/CompanionPanel.test.ts
git commit -m "feat(companion): show orb states, labels and progressive replies"
```

---

### Task 5: Manual verification (spec section 7) and docs

**Files:**
- Modify: `.claude/PROJECT_MAP.md` (local only, gitignored): add a Conventions line: orb state is derived (`effectiveAvatarState` from `aiBusy`/`releasesLoading`/`reveal`/`aiErrorLabel`/`listening`), never stored; replies reveal via `startReveal`, which is the seam for real streaming.

- [ ] **Step 1: Build and launch.** `npm run typecheck`, then `npm run dev`. Expected: app starts, no console errors from the companion components.
- [ ] **Step 2: State matrix.** For each of light/dark × Classic/Glass (Settings), check in the panel header (20px), empty-state hero (96px) and top bar (16px): idle (open panel), listening (type in the input), thinking (ask with AI configured, or open What's New with a cold cache), streaming (any reply), error (set an invalid Gemini key, ask), prod overlay (connect a site with environment Production; add it to any state), noticing (dismiss nothing after first run / trigger a transfer failure with the panel closed). Expected: labels/tooltips match the spec table; red appears only with prod, amber only in error; 16px orb is still in idle/prod and legible.
- [ ] **Step 3: Reduced motion / transparency.** Windows Settings → Accessibility → Visual effects → Animation effects off, Transparency effects off. Expected: no orbit, lift or caustic; replies appear at once; glow still changes per state and is visibly weaker with transparency off.
- [ ] **Step 4: Static-at-rest and focus.** With the panel closed and state idle, inspect the 16px orb in DevTools (Animations panel or `document.getAnimations().length` filtered to the orb root). Expected: 0 running. Open the panel, then Alt+Tab away. Expected: animations stop (`data-animate="false"`), resume on return.
- [ ] **Step 5: Performance next to a terminal.** Connect a site, open Terminal, run `top` (or `tail -F` on a busy log). Measure the Ferry WebView2 process CPU and GPU in Windows Task Manager (Details tab, add GPU column) for 60s each: (a) panel closed, (b) panel open and idle, (c) panel open while `thinking`. Repeat (a) on baseline commit `ffaa330` (old avatar), checked out in a separate worktree (`git worktree add ../ferry-baseline ffaa330`). Expected: (a) shows no measurable difference from the baseline; record (b)/(c) numbers in the PR description.
- [ ] **Step 6: Final gate.** `npm run typecheck` and `npm test`. Expected: both pass. Ask the user before the final commit or PR.

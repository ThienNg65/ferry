# Terminal Predictive Local Echo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Mosh-style zero-latency local typing echo inside Ferry's `@xterm/xterm` terminal over plain SSH, with a 100ms underline threshold, lossless buffer-reconciled rewind, automatic password/no-echo/alt-screen safety gates, and a Terminal Settings toggle.

**Architecture:** A pure TypeScript state machine (`TerminalEchoPredictor`) handles input classification, speculative ANSI rendering/rewinding, buffer-based server reconciliation, and password/no-echo gating without touching IPC or backend SSH code. `terminalStreams.store.ts` binds one predictor + 100ms underline timer per `TerminalInstance` around `term.onData` and `term.write`, while `ui.store.ts` and `TerminalAppearanceSettings.vue` persist and expose the user toggle.

**Tech Stack:** TypeScript, `@xterm/xterm` (`^5.5.0`) + `@xterm/addon-webgl` (`^0.18.0`), Vue 3, Pinia, Nuxt UI (`USwitch`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-terminal-predictive-echo-design.md`

## Global Constraints

- Zero new npm dependencies; pure TypeScript inside `src/renderer/src/`.
- Zero changes to `src/shared/contract.ts`, `TerminalManager.ts`, or `OutputBatcher.ts`.
- `SEND_CHANNELS.terminalInput` must still be sent immediately on every `term.onData` event with zero buffering.
- `FlowControl` ACK byte counting (`writeChunkWithAck`) must count only real `evt.data.length`, never speculative echo or rewind bytes.
- Works identically under both WebGL and DOM xterm renderers (uses standard SGR `\x1b[4m` / `\x1b[24m`, no DOM overlay).
- Never echo characters while a password/secret prompt is active (`paused_password` / `paused_noecho`).
- Commit messages must use Conventional Commits (`feat:`, `fix:`, `test:`) with zero AI attribution trailers.

## Review Focus

- **Wide/combining Unicode & emoji input (CJK, combining diacritics, emoji):** must not be predicted (and must flush active predictions) so cursor column math never drifts between 1-cell and 2-cell characters.
- **Multi-chunk `sudo` retry prompt (`"Sorry, try again.\r\n"` before `"[sudo] password for user: "`):** must stay paused across the intermediate newline chunk and never re-arm `'active'` until `silentProbe` confirms server echo resumed.
- **Overlapping `terminalData` chunks (`pendingServerWrites > 0`):** second chunk arriving while the first `term.write` callback hasn't fired must not emit a duplicate rewind or re-render predictions prematurely.
- **Terminal resize (`fitAndResize` / `onWindowResize`) while wrapped predictions are rendered:** must rewind/clear predictions before `fit.fit()` / `term.resize()` so `anchor` and `renderedPos` coordinates never go stale across changed `cols`.
- **Backspace at empty prompt (`confirmedLineChars === 0`) and Backspace over confirmed chars:** must refuse to locally erase the shell prompt, and must losslessly restore `erasedConfirmedChars` during rewind if server output arrives before remote `\b \b`.

---

## File Structure

- Create: `src/renderer/src/utils/terminalEchoPredictor.ts` — Pure state machine (`TerminalEchoPredictor`), cell/cursor snapshot interfaces, input classifier, ANSI render/rewind builder, buffer reconciliation, and password/no-echo/silent-probe logic.
- Create: `src/renderer/src/utils/terminalEchoPredictor.test.ts` — Unit tests covering all prediction, wrap, rewind, reconciliation, 100ms underline, and safety-gate paths.
- Modify: `src/renderer/src/stores/ui.store.ts` — Persist and expose `terminalPredictiveEcho` (default `true`, key `'ferry:ui:terminalPredictiveEcho'`) and `setTerminalPredictiveEcho(enabled)`.
- Modify: `src/renderer/src/stores/ui.store.test.ts` — Unit tests for default, restore, and persistence of `terminalPredictiveEcho`.
- Modify: `src/renderer/src/components/shell/TerminalAppearanceSettings.vue` — Add `SettingsRow` + `USwitch` for **Predictive local echo**.
- Modify: `src/renderer/src/stores/terminalStreams.store.ts` — Attach `TerminalEchoPredictor` + 100ms underline timer per `TerminalInstance`, wire `onData`, `terminalData`, `restart`, `resize`, `disposeForSession`, and `setPredictiveEcho`.
- Modify: `src/renderer/src/components/terminal/TerminalView.vue` — Flush/rewind predictions cleanly right before `inst.fit.fit()` in `fitAndResize` / `onWindowResize`.
- Modify: `src/renderer/src/stores/__tests__/terminalStreams.store.test.ts` — Extend mock `Terminal` with `buffer` + `onResize` and test live prediction, rewind, ACK accounting, and setting toggle.

---

### Task 1: `TerminalEchoPredictor` — Input Classification, Prediction Queue & ANSI Render/Rewind

**Files:**
- Create: `src/renderer/src/utils/terminalEchoPredictor.ts`
- Test: `src/renderer/src/utils/terminalEchoPredictor.test.ts`

**Interfaces:**
- Produces:
  - `export type PredictorMode = 'active' | 'paused_alt' | 'paused_password' | 'paused_noecho'`
  - `export interface CursorPos { absY: number; x: number }`
  - `export interface BufferSnapshot { type: 'normal' | 'alternate'; cols: number; cursor: CursorPos; getLineText(absY: number): string; getCellText(absY: number, x: number): string }`
  - `export interface PredictorSnapshot { mode: PredictorMode; pendingCount: number; underlined: boolean; predictionsRendered: boolean; pendingServerWrites: number }`
  - `export class TerminalEchoPredictor { constructor(nowFn?: () => number); getSnapshot(): PredictorSnapshot; onInput(data: string, buf: BufferSnapshot): { write: string; armUnderlineTimer: boolean; cancelUnderlineTimer: boolean }; applyUnderlineTimeout(cols: number): string; resetForFlush(buf: BufferSnapshot): string }`

- [ ] **Step 1: Write failing unit tests for input prediction, backspace, line wrap, 100ms underline, and wide-char/control flush**

Create `src/renderer/src/utils/terminalEchoPredictor.test.ts` with a minimal in-memory `FakeBuffer` helper (`cols = 80`, `type = 'normal'`, `lines: string[]`, `cursor: CursorPos`) and tests:
- `predicts_printable_ascii_without_underline_initially`: typing `'g'`, `'i'`, `'t'` at `(0, 10)` returns `write: 'g'`, `'i'`, `'t'`, `armUnderlineTimer: true` on first char, `pendingCount: 3`, `underlined: false`, `predictionsRendered: true`.
- `applies_underline_on_100ms_timeout_and_renders_subsequent_chars_underlined`: after `now` advances `100ms`, `applyUnderlineTimeout(80)` returns rewind + `'\x1b[4mgit\x1b[24m'` and sets `underlined: true`; subsequent `' '` returns `'\x1b[4m \x1b[24m'`.
- `wraps_correctly_across_cols_boundary_and_rewinds`: at `cols = 10`, cursor `(0, 8)`, typing `'abcd'` wraps to `(1, 2)`; `beforeServerWrite(10)` (or `resetForFlush`) rewinds 1 line up, clears row 1 (`\x1b[2K`), clears row 0 from col 9 (`\x1b[9G\x1b[K`), and parks cursor at `(0, 8)`.
- `backspace_pops_unconfirmed_char_and_rewinds_single_cell`: typing `'ab'` then `'\x7f'` leaves `'a'` pending and emits `'\b \b'` (and handles wrap-back from `x === 0` to previous row `cols - 1`).
- `backspace_at_empty_prompt_is_ignored`: at `confirmedLineChars === 0` and `pendingCount === 0`, `'\x7f'` returns `write: ''`.
- `wide_or_combining_unicode_and_control_keys_flush_predictions`: typing `'a'`, `'b'` then `'中'` (CJK wide char), `'\t'` (Tab), or `'\x03'` (Ctrl+C) returns a rewind sequence clearing `'ab'` and drops `pendingCount` to `0`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/utils/terminalEchoPredictor.test.ts`
Expected: FAIL because `terminalEchoPredictor.ts` does not exist yet.

- [ ] **Step 3: Implement core `TerminalEchoPredictor` in `src/renderer/src/utils/terminalEchoPredictor.ts`**

Implement:
- Exported types (`PredictorMode`, `CursorPos`, `BufferSnapshot`, `PredictorSnapshot`) and `TerminalEchoPredictor`.
- Single-width printable check (`isSingleWidthScalar(ch)`): rejects C0/C1 control chars (`\x00-\x1f`, `\x7f-\x9f`), zero-width/combining ranges (`0x0300-0x036f`, `0x1ab0-0x1aff`, `0x1dc0-0x1dff`, `0x20d0-0x20ff`, `0xfe20-0xfe2f`, `0x200b-0x200f`, `0xfe00-0xfe0f`), and East Asian Wide / Fullwidth / Emoji surrogate pairs (`>= 0x1100` wide ranges or code points `> 0xffff`).
- Cursor advance/retreat helper `advanceCursor(pos, cols)` / `retreatCursor(pos, cols)` for exact `cols`-aware coordinates.
- `buildRewindSequence(cols)`: moves from `renderedPos` to `anchor` using `\x1b[nA` / `\x1b[nB`, resets `\x1b[0m`, erases from `anchor` through `maxTouchedAbsY` (`\x1b[K` / `\x1b[2K`), restores `erasedConfirmedChars` if any, and returns cursor to `anchor`.
- `onInput(data, buf)` handling printable (`<= 128` chars), backspace (`'\x7f'` / `'\b'`), `Enter` (`'\r'` / `'\n'` sets `awaitingNewlineConfirm = true` when pending > 0 without erasing already-rendered text), and control/wide/large-paste flush.

- [ ] **Step 4: Run tests to verify Task 1 passes**

Run: `npx vitest run src/renderer/src/utils/terminalEchoPredictor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/terminalEchoPredictor.ts src/renderer/src/utils/terminalEchoPredictor.test.ts
git commit -m "feat(terminal): add core TerminalEchoPredictor state machine"
```

---

### Task 2: `TerminalEchoPredictor` — Server Buffer Reconciliation, Confirmed Backspace & Safety Gates

**Files:**
- Modify: `src/renderer/src/utils/terminalEchoPredictor.ts`
- Modify: `src/renderer/src/utils/terminalEchoPredictor.test.ts`

**Interfaces:**
- Produces (methods added to `TerminalEchoPredictor`):
  - `beforeServerWrite(cols: number): string` (returns rewind prefix if `predictionsRendered` is true, sets `predictionsRendered = false`, increments `pendingServerWrites`)
  - `afterServerWrite(buf: BufferSnapshot): { write: string; armUnderlineTimer: boolean; cancelUnderlineTimer: boolean }`
  - `reset(): void` (clears all state to `'active'` for shell restart)

- [ ] **Step 1: Write failing unit tests for reconciliation, confirmed backspace, alt-screen, password prompt, no-echo, and overlapping writes**

Append tests to `src/renderer/src/utils/terminalEchoPredictor.test.ts`:
- `reconciles_partial_and_ansi_colored_server_echoes`: user types `'git'`; server echoes `'gi'` (simulating `zsh` color via buffer cells containing `'gi'`), then `'t'`; verifies remaining tail `'t'` is re-rendered after `'gi'` and cleared cleanly after `'t'`.
- `backspace_over_confirmed_chars_losslessly_restores_on_rewind`: user types `'ls'` and server confirms (`confirmedLineChars === 2`); user presses `'\x7f'` (`erasedConfirmedChars = ['s']`, visually erases `'s'`); `beforeServerWrite(80)` restores `'s'` before server's real `'\b \b'` is applied, then `afterServerWrite` consumes `pendingBackspaces`.
- `overlapping_server_writes_do_not_double_rewind_or_prematurely_render`: calling `beforeServerWrite(80)` twice before `afterServerWrite` emits rewind only on the first call, and the first `afterServerWrite` returns `write: ''` while `pendingServerWrites > 0`.
- `enter_keeps_pending_command_visible_until_server_newline_arrives`: user types `'ls'` then `'\r'`; `onInput('\r')` returns `write: ''` (command stays on screen); `beforeServerWrite` rewinds it, server writes `'ls\r\nfile.txt\r\n$ '`, `afterServerWrite` clears `pending` and `awaitingNewlineConfirm`.
- `pauses_on_alternate_buffer_and_resumes_on_normal_buffer`: `buf.type === 'alternate'` pauses (`paused_alt`), emits no echo; returning to `'normal'` re-arms `'active'`.
- `pauses_on_password_prompt_and_multi_chunk_sudo_retry_never_leaks`: prompt `"[sudo] password for dev: "` puts predictor in `paused_password`; user types secret + `'\r'`; server sends `"Sorry, try again.\r\n"` in chunk 1 and `"[sudo] password for dev: "` in chunk 2; user types retried secret -> **zero** local echo; once normal prompt returns (`"dev@box:~$ "`) and user types `'ls'`, `'l'` waits for server echo (`silentProbe` match) and `'s'` predicts at 0ms.
- `output_only_paused_noecho_on_unrecognized_secret_prompt`: user types `'sec'` at unrecognized `"Custom key: "` then `'\r'`; server echoes `"\r\n"` without `'sec'`; `beforeServerWrite` rewinds `'sec'` and `afterServerWrite` enters `paused_noecho` (no RTT timer ever disables slow >2s responses when server hasn't responded yet).

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx vitest run src/renderer/src/utils/terminalEchoPredictor.test.ts`
Expected: FAIL (`beforeServerWrite` / `afterServerWrite` not implemented).

- [ ] **Step 3: Implement `beforeServerWrite`, `afterServerWrite`, `reset`, confirmed-backspace restoration, password regex + `silentProbe` in `src/renderer/src/utils/terminalEchoPredictor.ts`**

Follow spec Section 5.2–5.4 strictly:
- `PASSWORD_PROMPT_RE = /(?:password|passphrase|pin|passcode|otp|verification code|enter secret)\s*(?:for [^:\n]+)?:\s*$|^\[sudo\] password[^\n]*:\s*$/i` (tested against current line up to `buf.cursor.x`).
- Extract newly confirmed text from `anchor` to `buf.cursor` across wrapped lines using `buf.getLineText(absY)`.
- Reconcile `pendingBackspaces` (leftward cursor shift), `pending` prefix matches, `awaitingNewlineConfirm` newline completion, and `silentProbe` confirmation when `submittedWhilePaused` is true.
- Only enter `paused_noecho` synchronously in `afterServerWrite` on server response without matching echo (never via a timeout).

- [ ] **Step 4: Run tests to verify Task 2 passes**

Run: `npx vitest run src/renderer/src/utils/terminalEchoPredictor.test.ts`
Expected: PASS (all unit tests green).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/terminalEchoPredictor.ts src/renderer/src/utils/terminalEchoPredictor.test.ts
git commit -m "feat(terminal): add buffer reconciliation and password safety gates to TerminalEchoPredictor"
```

---

### Task 3: Add `terminalPredictiveEcho` Setting (`ui.store.ts` & `TerminalAppearanceSettings.vue`)

**Files:**
- Modify: `src/renderer/src/stores/ui.store.ts`
- Modify: `src/renderer/src/stores/ui.store.test.ts`
- Modify: `src/renderer/src/components/shell/TerminalAppearanceSettings.vue`

**Interfaces:**
- Produces on `useUiStore()`:
  - `terminalPredictiveEcho: boolean` (default `true`, persisted under `'ferry:ui:terminalPredictiveEcho'`)
  - `setTerminalPredictiveEcho(enabled: boolean): void`

- [ ] **Step 1: Write failing unit tests in `src/renderer/src/stores/ui.store.test.ts`**

Add tests inside `describe('ui store layout state', ...)`:
- `defaults terminalPredictiveEcho to true and persists setTerminalPredictiveEcho`: expects `ui.terminalPredictiveEcho === true`, calling `ui.setTerminalPredictiveEcho(false)` sets `false` and writes `'false'` to `'ferry:ui:terminalPredictiveEcho'`.
- `restores stored false terminalPredictiveEcho`: passes `{ 'ferry:ui:terminalPredictiveEcho': 'false' }` to `freshStore()`, expects `ui.terminalPredictiveEcho === false`.
- `resetTerminalAppearance leaves terminalPredictiveEcho unchanged`: sets `ui.setTerminalPredictiveEcho(false)`, calls `ui.resetTerminalAppearance()`, expects `ui.terminalPredictiveEcho === false`.

- [ ] **Step 2: Run `ui.store.test.ts` to verify it fails**

Run: `npx vitest run src/renderer/src/stores/ui.store.test.ts`
Expected: FAIL (`terminalPredictiveEcho` / `setTerminalPredictiveEcho` undefined).

- [ ] **Step 3: Implement setting in `ui.store.ts` and add `USwitch` row in `TerminalAppearanceSettings.vue`**

1. In `src/renderer/src/stores/ui.store.ts`:
   - Add `const TERM_PREDICTIVE_ECHO_KEY = 'ferry:ui:terminalPredictiveEcho'`.
   - Add `loadTerminalPredictiveEcho(): boolean` returning `readStored(TERM_PREDICTIVE_ECHO_KEY) !== 'false'`.
   - Add `terminalPredictiveEcho: boolean` to `UiState` and initialize in `state`.
   - Add `setTerminalPredictiveEcho(enabled: boolean): void` persisting `String(enabled)` to `TERM_PREDICTIVE_ECHO_KEY`.
   - Do **not** reset `terminalPredictiveEcho` inside `resetTerminalAppearance()`.
2. In `src/renderer/src/components/shell/TerminalAppearanceSettings.vue`:
   - Below the `Scrollback (lines)` `SettingsRow`, add a `SettingsRow` (`label="Predictive local echo"`, `description="Show typed characters immediately on slow SSH servers; pauses automatically in password prompts and full-screen apps."`, `for-id="terminal-predictive-echo"`) containing `<USwitch id="terminal-predictive-echo" :model-value="ui.terminalPredictiveEcho" @update:model-value="(v: boolean) => ui.setTerminalPredictiveEcho(v)" />`.

- [ ] **Step 4: Run `ui.store.test.ts` to verify it passes**

Run: `npx vitest run src/renderer/src/stores/ui.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/ui.store.ts src/renderer/src/stores/ui.store.test.ts src/renderer/src/components/shell/TerminalAppearanceSettings.vue
git commit -m "feat(terminal): add predictive local echo setting and toggle"
```

---

### Task 4: Wire `TerminalEchoPredictor` into `terminalStreams.store.ts` & `TerminalView.vue`

**Files:**
- Modify: `src/renderer/src/stores/terminalStreams.store.ts`
- Modify: `src/renderer/src/components/terminal/TerminalView.vue`
- Modify: `src/renderer/src/stores/__tests__/terminalStreams.store.test.ts`

**Interfaces:**
- Consumes: `TerminalEchoPredictor`, `BufferSnapshot` from `../utils/terminalEchoPredictor`; `useUiStore().terminalPredictiveEcho` from `./ui.store`
- Produces on `useTerminalStreamsStore()`:
  - `flushPredictions(sessionId: string): void` (rewinds and clears unconfirmed local predictions before `fit.fit()` / resize)
  - `syncPredictiveEchoSetting(): void` (clears active predictions across open instances when `ui.terminalPredictiveEcho` becomes `false`)

- [ ] **Step 1: Extend `terminalStreams.store.test.ts` with failing integration tests**

Update mock `Terminal` in `src/renderer/src/stores/__tests__/terminalStreams.store.test.ts` to include:
- `buffer: { active: { type: 'normal', baseY: 0, cursorY: 0, cursorX: 0, getLine: ... } }` backed by a simple mutable line array updated when server writes arrive, plus `onData` callback capture and `onResize` stub.
- Update `useUiStore` mock to include `terminalPredictiveEcho: true`.
- Add failing tests:
  - `predicts_keystrokes_immediately_while_sending_ssh_input_and_counts_only_server_ack_bytes`: simulates typing `'a'`, `'b'`, asserts `window.api.send(SEND_CHANNELS.terminalInput, ...)` fired immediately for `'a'` and `'b'`, asserts `term.write` received local `'a'` and `'b'`, then delivers `terminalData` `'ab'`, asserts `terminalAck` only counts `evt.data.length` (`2`), not predictive/rewind writes.
  - `flushes_predictions_before_resize_and_disables_when_setting_off`: types `'ab'`, calls `store.flushPredictions('sess-1')`, asserts rewind written; toggles `terminalPredictiveEcho = false` and calls `store.syncPredictiveEchoSetting()`, verifies subsequent keystroke sends `terminalInput` with zero local `term.write`.
  - `applies_underline_after_100ms_if_unconfirmed` (using `vi.useFakeTimers()`): types `'x'`, advances `100ms`, asserts `\x1b[4mx\x1b[24m` was written.

- [ ] **Step 2: Run `terminalStreams.store.test.ts` to verify new tests fail**

Run: `npx vitest run src/renderer/src/stores/__tests__/terminalStreams.store.test.ts`
Expected: FAIL because predictor wiring does not exist yet.

- [ ] **Step 3: Wire `TerminalEchoPredictor` into `terminalStreams.store.ts` and `TerminalView.vue`**

1. In `src/renderer/src/stores/terminalStreams.store.ts`:
   - Add `predictor: TerminalEchoPredictor` and `underlineTimer: ReturnType<typeof setTimeout> | null` to `TerminalInstance`.
   - Write helper `snapshotBuffer(term: Terminal): BufferSnapshot` reading `term.buffer.active` (`type`, `term.cols`, `baseY + cursorY`, `cursorX`, `getLine(y)?.translateToString(false)` / cell text).
   - Write helper `writeServerChunkWithAck(inst, data)` that gets `prefix = inst.predictor.beforeServerWrite(inst.term.cols)`, calls `inst.term.write(prefix + data, () => { ack(data.length); handleAfterServerWrite(inst) })`. (Only `data.length` is added to `inst.unacked`!)
   - In `term.onData`: send `SEND_CHANNELS.terminalInput` first; then if `useUiStore().terminalPredictiveEcho`, call `inst.predictor.onInput(data, snapshotBuffer(inst.term))`, write `res.write` if non-empty, and arm/cancel `inst.underlineTimer` (`100ms`).
   - Clear `inst.underlineTimer` and `inst.predictor.reset()` in `restart()` and `disposeForSession()`.
   - Add `flushPredictions(sessionId)` and `syncPredictiveEchoSetting()` actions.
2. In `src/renderer/src/components/terminal/TerminalView.vue`:
   - Watch `() => ui.terminalPredictiveEcho` to call `terminalStreams.syncPredictiveEchoSetting()`.
   - In `fitAndResize(sessionId)` and `onWindowResize()` right before `inst.fit.fit()`, call `terminalStreams.flushPredictions(sessionId)`.

- [ ] **Step 4: Run `terminalStreams.store.test.ts`, typecheck, and full unit test suite**

Run:
```bash
npx vitest run src/renderer/src/stores/__tests__/terminalStreams.store.test.ts
npm run typecheck
npm test
```
Expected: All unit tests and `vue-tsc` / `tsc` typecheck pass with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/terminalStreams.store.ts src/renderer/src/components/terminal/TerminalView.vue src/renderer/src/stores/__tests__/terminalStreams.store.test.ts
git commit -m "feat(terminal): integrate Mosh-style predictive local echo into terminal stream"
```

---

## Self-Review Check (Completed)

- **Spec coverage:** Pure TS predictor (`5.1`), state fields + `silentProbe` (`5.2`), input handling + wide-char exclusion + `Enter` preservation (`5.3`), rewind + buffer reconciliation + output-only `paused_noecho` + `FlowControl` real-byte ACK (`5.4`), `100ms` underline timer (`5.5`), settings toggle + resize flush + restart/dispose cleanup (`5.6`), and testing plan (`6`) are all mapped to Tasks 1–4.
- **Review Focus coverage:** All 5 failure modes have explicit tests pinned to Tasks 1, 2, and 4.
- **Consistency:** Exact method names (`onInput`, `beforeServerWrite`, `afterServerWrite`, `applyUnderlineTimeout`, `resetForFlush`, `reset`, `flushPredictions`, `syncPredictiveEchoSetting`, `setTerminalPredictiveEcho`) match across every `Interfaces` block and step.

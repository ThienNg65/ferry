# Terminal Predictive Local Echo — Design Document

**Date:** 2026-11-17  
**Status:** Ready for approval  
**Area:** SSH Terminal (`src/renderer` — `terminalStreams.store.ts`, `TerminalAppearanceSettings.vue`, `ui.store.ts`)

---

## 1. Intent & Why

On high-RTT, jump-host, or CPU-overloaded remote servers, typing in Ferry's SSH terminal feels sluggish because `@xterm/xterm` performs zero local echo: every keystroke travels `xterm -> WebSocket -> ssh2 ClientChannel -> remote PTY` and waits for the remote shell to echo it back before appearing on screen.

The goal is **Mosh-style zero-latency typing over plain SSH** with **zero server-side setup**:
- Typed characters and basic backspaces appear in `xterm.js` at 0ms.
- On fast servers (< 100ms RTT), the behavior is completely invisible.
- On slow servers (>= 100ms), unconfirmed characters appear with a subtle underline until the server confirms them.
- Full-screen TUIs (`vim`, `htop`, `less`), navigation/control keys, and password prompts automatically fall back to raw SSH passthrough so terminal state is never corrupted and passwords are never echoed.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- Instant (0ms) local rendering for printable characters and safe `Backspace` edits at a normal shell prompt.
- Pure client-side implementation over existing SSH PTY channels (`terminal:input` / `terminal:data`), requiring zero binaries or hooks on the remote host.
- **100ms Mosh-style underline threshold:** Only underline unconfirmed text if confirmation takes >= 100ms, avoiding flicker on fast links.
- **Buffer-reconciled rewind & replay:** Never break `zsh-syntax-highlighting`, `fish`, colored prompts, or async background output.
- **Automatic safety gates:** Suspend prediction immediately in alternate screen buffers, on password/passphrase prompts, on non-trivial control/navigation keys, and when the server stops echoing.
- **User toggle:** Add a **Predictive local echo** switch (default `true`) in Terminal Settings (`ui.store.ts` + `TerminalAppearanceSettings.vue`).

### Non-Goals (Out of Scope)
- Installing `mosh-server`, `tmux`, or shell-integration scripts on remote servers.
- Predicting remote command output, `Tab` completions, arrow-key history, or full-screen TUI movement (`vim`, `nano`, `htop`).
- Multi-line command composer bar / background command queue (explicitly not chosen for this iteration).
- Changes to `src/shared/contract.ts`, `TerminalManager.ts`, or `OutputBatcher.ts`.

### Anti-Goals
- Never buffer or delay outgoing keystrokes — `SEND_CHANNELS.terminalInput` must still fire immediately on `term.onData`.
- Never echo characters onto the screen when a password/secret prompt is active.
- Never corrupt `xterm.js` scrollback or ANSI color state when server output differs from prediction.

---

## 3. Constraints

- **Stack:** `@xterm/xterm` `^5.5.0` with `@xterm/addon-webgl` `^0.18.0`, Vue 3, Pinia, TypeScript, Nuxt UI.
- **Zero IPC / backend changes:** All prediction and reconciliation live in `src/renderer/src/`.
- **Renderer compatibility:** Must work identically under both the WebGL addon and xterm's fallback DOM renderer (achieved by using standard SGR underline `\x1b[4m` / `\x1b[24m` inside `xterm.js` rather than an external DOM overlay).
- **Testability:** Prediction state machine and rewind/reconciliation logic must be pure TypeScript (`src/renderer/src/utils/terminalEchoPredictor.ts`) unit-tested in Vitest without requiring a DOM or WebGL context.

---

## 4. Approaches Considered

| Approach | Summary | Trade-offs | Decision |
|---|---|---|---|
| **1 — In-buffer prediction with rewind & `xterm` buffer reconciliation** | Pure TS predictor writes speculative chars into `xterm`; before each `terminalData` write, rewinds unconfirmed suffix, lets `xterm` parse true server bytes, then inspects `term.buffer.active` to drop confirmed chars and re-draw remaining tail. | Exact font, WebGL, cursor, and line-wrap alignment for free; handles `zsh`/`fish` coloring via buffer reconciliation; requires careful async `term.write` queue serialization. | **Selected** |
| **2 — Non-mutating floating DOM overlay** | Keep `xterm` buffer purely server-driven; draw speculative chars and backspace masks in a positioned HTML overlay aligned to `cursorX/cursorY`. | Never touches `xterm` buffer/scrollback, but pixel alignment with `@xterm/addon-webgl`, custom fonts, line-height, and line-wrapping is fragile. | Rejected |

---

## 5. Architecture & Detailed Design

### 5.1 Module Split

1. **`src/renderer/src/utils/terminalEchoPredictor.ts`** (pure, xterm-agnostic state machine + helpers)
   - Defines `TerminalBufferSnapshot` / `CursorPos` minimal interfaces (read from `term.buffer.active` in `terminalStreams.store.ts` and easily mocked in unit tests).
   - Tracks prediction state, pending operations, confirmed-line character budget, mode/gates, and builds rewind / render ANSI sequences.
2. **`src/renderer/src/stores/terminalStreams.store.ts`**
   - Attaches one `TerminalEchoPredictor` instance per `TerminalInstance` (reset on `restart()` and disposed on `disposeForSession()`).
   - Intercepts `term.onData` (always sends `terminalInput` first, then asks predictor for optional immediate `term.write` echo).
   - Intercepts `terminalData` events via `writeServerChunkWithPrediction(inst, data)`.
   - Manages the 100ms underline timer per `TerminalInstance`.
3. **`src/renderer/src/stores/ui.store.ts` & `TerminalAppearanceSettings.vue`**
   - Adds `terminalPredictiveEcho: boolean` (default `true`, persisted under `'ferry:ui:terminalPredictiveEcho'`, `setTerminalPredictiveEcho(enabled)`).
   - Exposes a `USwitch` row **"Predictive local echo"** under the Terminal settings panel.

---

### 5.2 Prediction State & Data Structures

```ts
export type PredictorMode = 'active' | 'paused_alt' | 'paused_password' | 'paused_noecho'

export interface CursorPos {
  absY: number // term.buffer.active.baseY + term.buffer.active.cursorY
  x: number    // term.buffer.active.cursorX (0-based)
}

export interface PendingChar {
  ch: string      // single Unicode scalar (width 1)
  sentAt: number  // performance.now() / Date.now()
}
```

Per terminal, `TerminalEchoPredictor` maintains:
- `mode: PredictorMode` (starts `'active'`).
- `pending: PendingChar[]` — unconfirmed characters in FIFO order.
- `pendingBackspaces: number` — count of speculative backspaces over previously confirmed characters (only allowed when `confirmedLineChars > 0`).
- `confirmedLineChars: number` — number of characters confirmed on the current prompt line since the last `Enter` / line reset. Prevents speculative `Backspace` from erasing the shell prompt (`user@host:~$ `).
- `anchor: CursorPos | null` — the confirmed cursor position in `term.buffer.normal` right before the first speculative edit (`pending` or `pendingBackspaces`) was drawn.
- `renderedPos: CursorPos | null` — the visual cursor position where our last speculative render left off (needed to compute exact rewind lines/columns across wraps).
- `underlined: boolean` — becomes `true` when the oldest pending item hits `>= 100ms` without confirmation; resets to `false` when `pending` empties.
- `predictionsRendered: boolean` — whether unconfirmed speculative characters are currently visible in `xterm`'s buffer.
- `pendingServerWrites: number` — count of in-flight `term.write(...)` calls carrying real SSH data.
- `awaitingNewlineConfirm: boolean` — set when `Enter` (`\r`/`\n`) is pressed while `pending.length > 0`, so previously predicted command text stays visible on screen until the server responds instead of vanishing immediately.
- `submittedWhilePaused: boolean` — set when `Enter` (`\r`/`\n`) is pressed while in `'paused_password'` or `'paused_noecho'`.
- `silentProbe: string[]` — unrendered printable characters typed after `submittedWhilePaused = true` while paused, used to confirm the remote PTY has `ECHO` back on before re-arming `'active'` (never drawn to `xterm.js`).

---

### 5.3 Input Handling (`term.onData(data)`)

`SEND_CHANNELS.terminalInput` is **always** sent immediately, unconditionally. Prediction runs alongside it:

1. **Pre-checks:**
   - If `!ui.terminalPredictiveEcho`: do nothing (pure passthrough).
   - If `term.buffer.active.type === 'alternate'`: set `mode = 'paused_alt'`, clear any pending state, return.
   - If `mode === 'paused_password'` or `mode === 'paused_noecho'`:
     - Never write any speculative characters to `xterm.js`.
     - If `data` contains `\r` or `\n`: set `submittedWhilePaused = true`, clear `silentProbe = []`, return.
     - If `submittedWhilePaused` is true and `data` is single-width printable input (`<= 128` chars, no control chars): record `anchor` if `silentProbe.length === 0` and append chars to `silentProbe` (silently, without drawing) so reconciliation can verify when `ECHO` resumes.
     - Otherwise (control keys, `Backspace`, or pre-`Enter` password typing): clear `silentProbe = []` and return.

2. **Printable input** (`data.length <= 128`, contains no C0/C1 control chars `[\x00-\x1f\x7f]` and no surrogate-broken/wide-width ambiguity — specifically single-width printable scalars):
   - Note on wide/combining chars: characters outside single-cell width (CJK wide chars, combining diacritics, emoji) are **not** predicted to avoid column-math drift; if encountered, flush pending predictions and let the server render them.
   - Record `anchor` from `term.buffer.active` if `pending.length === 0 && pendingBackspaces === 0`.
   - Push each char into `pending` with `sentAt = now`.
   - If `pendingServerWrites === 0`, immediately render the newly typed char(s) to `term.write(...)` (plain if `!underlined`, wrapped in `\x1b[4m...\x1b[24m` if `underlined`), update `renderedPos`, and arm the `100ms` underline timer if not already armed.

3. **Backspace (`'\x7f'` or `'\b'`):**
   - Case A (`pending.length > 0`): pop last `PendingChar` from `pending`. If `pendingServerWrites === 0`, move cursor back 1 cell (handling wrap back to previous row's `cols - 1` if `renderedPos.x === 0`) and erase cell (`' '`, then move cursor back 1).
   - Case B (`pending.length === 0 && confirmedLineChars > 0`): decrement `confirmedLineChars`, increment `pendingBackspaces`, set `anchor` if null, and if `pendingServerWrites === 0`, visually erase 1 cell left.
   - Case C (`confirmedLineChars === 0`): do nothing locally (never erase past the prompt).

4. **Enter (`'\r'` or `'\n'`):**
   - Reset `confirmedLineChars = 0`.
   - If `pending.length > 0 || pendingBackspaces > 0`: set `awaitingNewlineConfirm = true` and stop predicting further keystrokes until the server responds. Leave the already-rendered command visible in `xterm` so it doesn't flash away while waiting for the server; the next `terminalData` arrival will rewind and replace it with the server's real echo + newline.
   - If `mode === 'paused_password'` or `'paused_noecho'`: remember `submittedWhilePaused = true` so the next prompt output can re-arm `'active'`.

5. **Other control/navigation keys** (`Tab`, arrows `\x1b[...`, `Ctrl+C` `\x03`, `Ctrl+R`, `Ctrl+U`, `Ctrl+W`, large pastes `> 128` chars):
   - If `predictionsRendered`, emit the rewind sequence to restore `xterm` cleanly to `anchor`.
   - Clear `pending`, `pendingBackspaces = 0`, `confirmedLineChars = 0`, `awaitingNewlineConfirm = false`, `underlined = false`.

---

### 5.4 Server Output Handling & `xterm` Buffer Reconciliation (`terminalData`)

To avoid race conditions across `xterm.js`'s asynchronous `WriteBuffer`, every `terminalData` chunk flows through `writeServerChunkWithPrediction(inst, data)`:

1. **Before `term.write`:**
   - Capture `hadRendered = predictor.predictionsRendered`.
   - Compute `prefix = hadRendered ? predictor.buildRewindSequence(cols) : ''` and set `predictor.predictionsRendered = false`.
   - Increment `predictor.pendingServerWrites++`.
   - Call `inst.term.write(prefix + data, () => { ... })`.

2. **Rewind sequence (`buildRewindSequence(cols)`):**
   - Moves cursor from `renderedPos` back to `anchor` using explicit relative vertical moves (`\x1b[nA` if `renderedPos.absY > anchor.absY`, or `\x1b[nB` if `pendingBackspaces` wrapped upward), resets attributes (`\x1b[0m`), and clears from `anchor` through the end of the furthest touched row without touching scrollback or rows below `maxTouchedAbsY`:
     - Row `anchor.absY`: `\x1b[${anchor.x + 1}G\x1b[K`
     - Each subsequent row up to `maxTouchedAbsY`: `\x1b[B\x1b[1G\x1b[2K`
     - Then return cursor to `anchor` (`\x1b[${dy}A\x1b[${anchor.x + 1}G`).
   - Note: If `pendingBackspaces > 0`, `anchor` was at `(startAbsY, startX)` *before* backspacing; erasing from `minPos` forward ensures clean restoration when `data` arrives. (Even simpler: when `pendingBackspaces > 0`, `anchor` tracks the **pre-backspace** position so rewind restores cursor there and lets server's real `\b \b` apply cleanly—Wait: if we erased 1 confirmed char visually before rewind, rewinding without the erased char would leave that char blank until server redraws unless we save the erased char(s)! **Decision:** store `erasedConfirmedChars: string[]` read from `term.buffer.active` right before erasing a confirmed char on `Backspace`, and include those saved characters in `buildRewindSequence()` before repositioning to `anchor`! That guarantees 100% lossless rewind even for `Backspace` over confirmed text!)

3. **Inside `term.write` callback (after `xterm` has parsed `data`):**
   - Decrement `predictor.pendingServerWrites--`.
   - Check buffer type: if `term.buffer.active.type === 'alternate'`, set `mode = 'paused_alt'`, reset pending state, cancel underline timer, and return. If previously `'paused_alt'` and now `'normal'`, transition back to `'active'`.
   - **If `pendingServerWrites > 0`**: more server chunks are already queued in `xterm`'s WriteBuffer — skip re-rendering predictions yet so we don't draw and immediately rewind on the next microtask.
   - **If `pendingServerWrites === 0`**: reconcile against `term.buffer.active`:
     - Read current cursor `nowPos` (`baseY + cursorY`, `cursorX`) and the current line text around `anchor` -> `nowPos`.
     - **Case 1 — Alternate screen / cursor jumped unexpectedly / `awaitingNewlineConfirm` and newline arrived:**
       - If server advanced onto a new line (`nowPos.absY > anchor.absY` when `awaitingNewlineConfirm`, or non-matching cursor jump backwards/away): clear `pending`, `pendingBackspaces`, `awaitingNewlineConfirm = false`, `underlined = false`.
     - **Case 2 — Reconcile `pendingBackspaces`:**
       - Check if `nowPos` moved left by `k` cells compared to `anchor` (handling wrap): consume `min(k, pendingBackspaces)` backspaces and advance `anchor` to `nowPos`.
     - **Case 3 — Reconcile `pending` characters:**
       - Extract the newly rendered text in `term.buffer.active` between `anchor` and `nowPos` (walking across wrapped lines if `nowPos.absY >= anchor.absY`).
       - Match prefix of `pending` against those newly rendered characters (ignoring SGR styling—`xterm` already stripped ANSI escapes into plain cells!).
       - Pop matched characters from `pending`, increment `confirmedLineChars += matchedCount`, update `anchor = nowPos`.
       - If server echoed *different* characters than `pending` (e.g., `zsh` completion, `sudo` rejected, background log printed): clear remaining mismatched `pending`, reset `underlined = false`, and check password/no-echo heuristics!
     - **Password & No-Echo Detection (Output-Only, No Timeout):**
       - Inspect the current line (up to `nowPos.x`) for password prompt patterns:
         `/(?:password|passphrase|pin|passcode|otp|verification code|enter secret)\s*(?:for [^:\n]+)?:\s*$/i` or `/\[sudo\] password/i`.
         If matched → set `mode = 'paused_password'`, `submittedWhilePaused = false`, `silentProbe = []`, and clear any pending predictions immediately.
       - **Output-only `paused_noecho` (no RTT timer):** Never drop prediction purely because a slow server takes >1.5s to respond. Only enter `paused_noecho` (`submittedWhilePaused = false`, `silentProbe = []`) when the server *does* respond without echoing pending characters—specifically, when `awaitingNewlineConfirm` sees a server newline (`nowPos.absY > anchor.absY`) with zero pending chars confirmed, or when `pending.length > 0` receives non-matching cursor/text output that isn't a control reset.
       - **Safe Re-arming via Silent Echo-Probe Confirmation:** When `mode` is `'paused_password'` or `'paused_noecho'` and `submittedWhilePaused === true`, do **not** re-arm on a bare newline (which would leak retried passwords between multi-chunk `sudo` retry messages like `"Sorry, try again.\r\n"` and `"[sudo] password:"`). Instead, re-arm `mode = 'active'` only when incoming `terminalData` echoes a matching character from `silentProbe` into `term.buffer.active` **and** the current line does not match a password prompt (after which characters `2..N` resume 0ms prediction).
     - **Re-render remaining tail:**
       - If `mode === 'active'` and (`pending.length > 0` or `pendingBackspaces > 0`):
         - Render remaining `pending` tail (with `\x1b[4m...\x1b[24m` if `underlined` or oldest item age >= 100ms), or backspace erasures, and set `predictionsRendered = true`, updating `renderedPos`.
       - Else: `underlined = false`, cancel underline timer.

4. **FlowControl ACK accounting (`ACK_BATCH_BYTES`):**
   - `writeChunkWithAck` continues to count **only** `evt.data.length` (the real SSH bytes), never speculative local writes or rewind sequences, keeping `FlowControl` in `TerminalManager.ts` 100% accurate.

---

### 5.5 100ms Underline Timer Lifecycle

- Whenever `pending` transitions from empty to non-empty and `!underlined`:
  - Arm a `100ms` timer (`setTimeout`).
  - If `pending` empties before `100ms`, clear the timer (so fast connections < 100ms RTT never show any underline).
  - When the `100ms` timer fires and `pending.length > 0 && pendingServerWrites === 0 && predictionsRendered`:
    - Set `underlined = true`.
    - Emit `buildRewindSequence() + buildRenderSequence(underlined = true)` to `inst.term.write(...)` so the currently unconfirmed tail flips cleanly to underlined.
  - All timers for an instance are cleared on `disposeForSession()` and `restart()`.

---

### 5.6 Settings & Edge Cases

- **Setting in `ui.store.ts`:**
  - `terminalPredictiveEcho: boolean` (default `true`, stored in `localStorage` under `'ferry:ui:terminalPredictiveEcho'`).
  - Toggle action `setTerminalPredictiveEcho(enabled: boolean)` resets any active predictor state across open instances immediately when toggled off.
- **Resize (`fitAndResize`):**
  - If `resize()` changes `cols`/`rows` while predictions are rendered, flush/rewind predictions before calling `term.resize` / `fit.fit()` (or clear predictions on `term.onResize`) so column-wrap coordinates (`anchor`, `renderedPos`) never go stale.
- **Shell Restart (`restart()`):**
  - Resets predictor state to clean `'active'`, clears timers.
- **Multi-session isolation:**
  - Each `TerminalInstance` in `terminalStreams.store.ts`'s `instances` Map owns its own `TerminalEchoPredictor` and timer, so background tabs never interfere with the active tab.

---

## 6. Testing Plan

1. **Unit tests (`src/renderer/src/utils/terminalEchoPredictor.test.ts`):**
   - Printable chars: fast confirmation before 100ms (never underlined) vs. slow confirmation >= 100ms (switches to underlined and clears on confirmation).
   - Partial/chunked server echoes (`git sta` typed -> `gi` arrives -> `t ` arrives -> `sta` arrives).
   - `zsh`-style colored echo reconciliation (buffer contains matched text regardless of ANSI color escapes).
   - `Backspace` on unconfirmed chars vs. confirmed chars (`erasedConfirmedChars` restoration on rewind) vs. refusal to erase past prompt (`confirmedLineChars === 0`).
   - `Enter` with pending tail (keeps text visible until newline arrives, then reconciles cleanly).
   - Line wrapping across `cols` boundary (rewind moves up rows and restores exact column).
   - Safety gates: alternate buffer pauses prediction; password regex pauses prediction; `Enter` without echo triggers `paused_noecho` and rewinds; multi-chunk `sudo` retry (`"Sorry, try again.\r\n"` then `"[sudo] password:"`) stays paused without leaking retried password chars, and only re-arms `'active'` after `silentProbe` confirms echo resumed; `Tab` / `Ctrl+C` / arrows flush predictions.
2. **Store integration tests (`src/renderer/src/stores/__tests__/terminalStreams.store.test.ts`):**
   - Verify `onData` still sends `terminalInput` immediately while writing local prediction to `term.write`.
   - Verify `FlowControl` `ack` counts only real server `evt.data.length`, not local echo or rewind bytes.
   - Verify disabling `ui.terminalPredictiveEcho` disables local echo immediately.
3. **UI Settings tests:**
   - Verify `ui.store.test.ts` persists and toggles `terminalPredictiveEcho` (default `true`).

---

## 7. Open Calls Left to Builder

- Exact cell-reading helper details against `@xterm/xterm`'s `IBufferLine.getCell()` / `translateToString()` and `getWidth()` for skipping wide/combining characters.
- Whether `TerminalAppearanceSettings.vue` reset button leaves `terminalPredictiveEcho` untouched (recommended: keep `resetTerminalAppearance()` purely visual, matching `terminalScrollback` which is also not reset by `resetTerminalAppearance()`).

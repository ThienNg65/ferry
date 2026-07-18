/**
 * Pure decision logic for the Terminal's custom key handling — what a given
 * keyboard event should do given whether the terminal currently has a text
 * selection. Kept as a standalone pure function (like fileSort/fileSelection)
 * so the copy/paste conventions are unit-testable without xterm.js or a DOM.
 *
 * Conventions (matching PuTTY/WinSCP/modern terminal emulators):
 * - Ctrl/Cmd+C with a selection copies it; without one it falls through to
 *   xterm, which sends `\x03` (SIGINT) to the shell — both behaviors users expect
 *   from the same key.
 * - Ctrl+Shift+C is an explicit copy, Ctrl/Cmd+V, Ctrl+Shift+V and Shift+Insert
 *   all paste.
 * - Everything else (Ctrl+A, Ctrl+K, Ctrl+R, arrows, ...) passes through to the
 *   shell untouched — readline owns those, not the app.
 */

export type TerminalKeyAction = 'copy' | 'paste' | 'default'

/** Minimal slice of KeyboardEvent this decision needs (keeps tests dependency-free). */
export type TerminalKeyEventLike = Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>

/** Decides whether a key event should copy, paste, or pass through to xterm/the shell. */
export function terminalKeyAction(ev: TerminalKeyEventLike, hasSelection: boolean): TerminalKeyAction {
  // xterm's custom key handler receives keydown/keypress/keyup — only ever act
  // on keydown, or a single Ctrl+V would paste twice.
  if (ev.type !== 'keydown') {
    return 'default'
  }
  const key = ev.key.toLowerCase()
  const ctrlOrCmd = ev.ctrlKey || ev.metaKey

  if (ctrlOrCmd && key === 'c') {
    if (ev.shiftKey) {
      return 'copy'
    }
    // Plain Ctrl+C: copy only when there's something selected; otherwise let
    // xterm deliver the interrupt character to the shell.
    if (hasSelection) {
      return 'copy'
    }
    return 'default'
  }

  if (ctrlOrCmd && key === 'v') {
    return 'paste'
  }

  if (ev.shiftKey && !ctrlOrCmd && key === 'insert') {
    return 'paste'
  }

  return 'default'
}

import { describe, expect, it } from 'vitest'
import { terminalKeyAction, type TerminalKeyEventLike } from './terminalKeys'

function ev(overrides: Partial<TerminalKeyEventLike>): TerminalKeyEventLike {
  return { type: 'keydown', key: '', ctrlKey: false, metaKey: false, shiftKey: false, ...overrides }
}

describe('terminalKeyAction', () => {
  it('copies on Ctrl+C when a selection exists', () => {
    expect(terminalKeyAction(ev({ key: 'c', ctrlKey: true }), true)).toBe('copy')
  })

  it('passes Ctrl+C through (SIGINT) when nothing is selected', () => {
    expect(terminalKeyAction(ev({ key: 'c', ctrlKey: true }), false)).toBe('default')
  })

  it('copies on Cmd+C with a selection (macOS)', () => {
    expect(terminalKeyAction(ev({ key: 'c', metaKey: true }), true)).toBe('copy')
  })

  it('copies on Ctrl+Shift+C regardless of selection', () => {
    expect(terminalKeyAction(ev({ key: 'C', ctrlKey: true, shiftKey: true }), true)).toBe('copy')
    expect(terminalKeyAction(ev({ key: 'C', ctrlKey: true, shiftKey: true }), false)).toBe('copy')
  })

  it('pastes on Ctrl+V and Cmd+V', () => {
    expect(terminalKeyAction(ev({ key: 'v', ctrlKey: true }), false)).toBe('paste')
    expect(terminalKeyAction(ev({ key: 'v', metaKey: true }), false)).toBe('paste')
  })

  it('pastes on Ctrl+Shift+V (uppercase key from the Shift)', () => {
    expect(terminalKeyAction(ev({ key: 'V', ctrlKey: true, shiftKey: true }), false)).toBe('paste')
  })

  it('pastes on Shift+Insert', () => {
    expect(terminalKeyAction(ev({ key: 'Insert', shiftKey: true }), false)).toBe('paste')
  })

  it('does not paste on plain Insert or Ctrl+Insert', () => {
    expect(terminalKeyAction(ev({ key: 'Insert' }), false)).toBe('default')
    expect(terminalKeyAction(ev({ key: 'Insert', ctrlKey: true }), false)).toBe('default')
  })

  it('passes readline keys through to the shell (Ctrl+A/K/R)', () => {
    expect(terminalKeyAction(ev({ key: 'a', ctrlKey: true }), true)).toBe('default')
    expect(terminalKeyAction(ev({ key: 'k', ctrlKey: true }), false)).toBe('default')
    expect(terminalKeyAction(ev({ key: 'r', ctrlKey: true }), false)).toBe('default')
  })

  it('ignores non-keydown events entirely', () => {
    expect(terminalKeyAction(ev({ type: 'keyup', key: 'v', ctrlKey: true }), false)).toBe('default')
    expect(terminalKeyAction(ev({ type: 'keypress', key: 'c', ctrlKey: true }), true)).toBe('default')
  })

  it('leaves plain typing untouched', () => {
    expect(terminalKeyAction(ev({ key: 'c' }), true)).toBe('default')
    expect(terminalKeyAction(ev({ key: 'Enter' }), false)).toBe('default')
  })
})

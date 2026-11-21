// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { onDialogTabKeydown } from './useDialogFocusTrap'

function makeVisible(el: HTMLElement, parent: HTMLElement): void {
  Object.defineProperty(el, 'offsetParent', { value: parent, configurable: true })
}

describe('onDialogTabKeydown', () => {
  it('wraps Tab from last focusable element to first and Shift+Tab from first to last', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const first = document.createElement('button')
    const middle = document.createElement('button')
    const hidden = document.createElement('button')
    hidden.style.display = 'none'
    const last = document.createElement('button')
    dialog.append(first, middle, hidden, last)
    makeVisible(first, dialog)
    makeVisible(middle, dialog)
    makeVisible(last, dialog)
    document.body.appendChild(dialog)

    last.focus()
    const fwd = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    Object.defineProperty(fwd, 'currentTarget', { value: dialog })
    onDialogTabKeydown(fwd)
    expect(fwd.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)

    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    Object.defineProperty(back, 'currentTarget', { value: dialog })
    onDialogTabKeydown(back)
    expect(back.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)

    dialog.remove()
  })
})

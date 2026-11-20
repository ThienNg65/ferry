// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { onTablistKeydown, onTabStripWheel } from '../tablistKeys'

describe('onTablistKeydown selector', () => {
  it('ArrowDown with a custom selector focuses and clicks the next row', () => {
    document.body.innerHTML = '<div id="l"><button data-site-row></button><button data-site-row></button></div>'
    const list = document.getElementById('l')!
    const [a, b] = [...list.querySelectorAll<HTMLElement>('[data-site-row]')]
    const click = vi.fn()
    b.addEventListener('click', click)
    a.focus()
    const event = { key: 'ArrowDown', currentTarget: list, preventDefault: () => {} } as unknown as KeyboardEvent
    onTablistKeydown(event, true, true, '[data-site-row]')
    expect(document.activeElement).toBe(b)
    expect(click).toHaveBeenCalledOnce()
  })

  it('Home and End jump to the first and last matching element', () => {
    document.body.innerHTML = '<div id="l"><button data-site-row></button><button data-site-row></button><button data-site-row></button></div>'
    const list = document.getElementById('l')!
    const [a, b, c] = [...list.querySelectorAll<HTMLElement>('[data-site-row]')]
    b.focus()
    onTablistKeydown({ key: 'End', currentTarget: list, preventDefault: () => {} } as unknown as KeyboardEvent, false, true, '[data-site-row]')
    expect(document.activeElement).toBe(c)
    onTablistKeydown({ key: 'Home', currentTarget: list, preventDefault: () => {} } as unknown as KeyboardEvent, false, true, '[data-site-row]')
    expect(document.activeElement).toBe(a)
  })
})

describe('onTabStripWheel', () => {
  function makeStrip(scrollWidth: number, clientWidth: number): HTMLElement {
    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
    Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
    el.scrollLeft = 10
    return el
  }

  it('translates vertical-dominant wheel events into horizontal scrolling', () => {
    const strip = makeStrip(600, 300)
    const preventDefault = vi.fn()
    onTabStripWheel({ currentTarget: strip, deltaX: 4, deltaY: 48, preventDefault } as unknown as WheelEvent)
    expect(strip.scrollLeft).toBe(58)
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('leaves horizontal-dominant trackpad gestures to native scrolling even with small deltaY', () => {
    const strip = makeStrip(600, 300)
    const preventDefault = vi.fn()
    onTabStripWheel({ currentTarget: strip, deltaX: 100, deltaY: 2, preventDefault } as unknown as WheelEvent)
    expect(strip.scrollLeft).toBe(10)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('ignores non-overflowing tab strips', () => {
    const strip = makeStrip(300, 300)
    const preventDefault = vi.fn()
    onTabStripWheel({ currentTarget: strip, deltaX: 0, deltaY: 48, preventDefault } as unknown as WheelEvent)
    expect(strip.scrollLeft).toBe(10)
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

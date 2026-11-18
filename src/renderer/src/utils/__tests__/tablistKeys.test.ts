// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { onTablistKeydown } from '../tablistKeys'

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

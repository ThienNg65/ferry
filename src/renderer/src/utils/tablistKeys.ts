export function onTablistKeydown(
  event: KeyboardEvent,
  activate = false,
  vertical = false,
  selector = '[role="tab"]'
): void {
  const list = event.currentTarget as HTMLElement
  const isVertical = vertical || list.getAttribute('aria-orientation') === 'vertical'
  const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft'
  const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight'
  const isHome = event.key === 'Home'
  const isEnd = event.key === 'End'
  if (event.key !== prevKey && event.key !== nextKey && !isHome && !isEnd) {
    return
  }
  const tabs = [...list.querySelectorAll<HTMLElement>(selector)]
  if (tabs.length === 0) {
    return
  }
  const current = tabs.findIndex((tab) => tab === document.activeElement || tab.contains(document.activeElement))
  if (current === -1) {
    return
  }
  event.preventDefault()
  const next = isHome
    ? tabs[0]
    : isEnd
      ? tabs[tabs.length - 1]
      : tabs[(current + (event.key === nextKey ? 1 : -1) + tabs.length) % tabs.length]
  next.focus()
  if (activate) {
    next.click()
  }
}

export function onTabStripWheel(e: WheelEvent): void {
  const el = e.currentTarget as HTMLElement | null
  if (!el || el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
  el.scrollLeft += e.deltaY
  e.preventDefault()
}

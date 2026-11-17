export function onTablistKeydown(
  event: KeyboardEvent,
  activate = false,
  vertical = false,
  selector = '[role="tab"]'
): void {
  const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft'
  const nextKey = vertical ? 'ArrowDown' : 'ArrowRight'
  if (event.key !== prevKey && event.key !== nextKey) {
    return
  }
  const list = event.currentTarget as HTMLElement
  const tabs = [...list.querySelectorAll<HTMLElement>(selector)]
  const current = tabs.findIndex((tab) => tab === document.activeElement || tab.contains(document.activeElement))
  if (current === -1) {
    return
  }
  event.preventDefault()
  const step = event.key === nextKey ? 1 : -1
  const next = tabs[(current + step + tabs.length) % tabs.length]
  next.focus()
  if (activate) {
    next.click()
  }
}

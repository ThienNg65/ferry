const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function isElementVisible(el: HTMLElement, root: HTMLElement): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return false
  let cur: HTMLElement | null = el
  while (cur && cur !== root) {
    const style = getComputedStyle(cur)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    cur = cur.parentElement
  }
  return el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
}

export function onDialogTabKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
  const dialog = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('[role="dialog"]')
  if (!dialog) return

  const candidates = [...dialog.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)].filter(
    (el) => el.tabIndex >= 0 && isElementVisible(el, dialog)
  )
  if (candidates.length === 0) {
    event.preventDefault()
    return
  }

  const first = candidates[0]
  const last = candidates[candidates.length - 1]
  const active = document.activeElement as HTMLElement | null

  if (!active || !dialog.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
    return
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  } else if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault()
    last.focus()
  }
}

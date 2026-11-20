export const MIN_PANE_PX = 320

export function clampLocalPaneWidth(percent: number, viewportPx: number): number {
  const min = Math.min(50, (MIN_PANE_PX / viewportPx) * 100)
  return Math.max(min, Math.min(percent, 100 - min))
}

export const COLUMN_HIDE = {
  local: { size: '@max-[340px]:hidden', modified: '@max-[460px]:hidden', permissions: 'hidden' },
  remote: { size: '@max-[440px]:hidden', modified: '@max-[560px]:hidden', permissions: '@max-[360px]:hidden' }
} as const

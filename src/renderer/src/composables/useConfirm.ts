import ConfirmDialog from '../components/shell/ConfirmDialog.vue'

export interface ConfirmOptions {
  title: string
  body?: string
  prodWarning?: string
  items?: string[]
  confirmLabel?: string
  confirmColor?: 'primary' | 'error' | 'warning'
  destructive?: boolean
  action?: () => Promise<void>
  secondaryLabel?: string
  secondaryAction?: () => void | Promise<void>
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const overlay = useOverlay()
  return async (options) => {
    const modal = overlay.create(ConfirmDialog, { destroyOnClose: true })
    const confirmed = await modal.open(options)
    return Boolean(confirmed)
  }
}

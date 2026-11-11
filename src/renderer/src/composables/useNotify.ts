/** Thin wrapper over @nuxt/ui's useToast() so every call site shares consistent styling. */
export function useNotify() {
  const toast = useToast()
  return {
    success(title: string, description?: string): void {
      toast.add({ title, description, color: 'success', icon: 'i-lucide-check-circle' })
    },
    error(title: string, description?: string): void {
      toast.add({
        title,
        description,
        color: 'error',
        icon: 'i-lucide-alert-circle',
        duration: 0,
        actions: [
          {
            label: 'Copy',
            color: 'neutral' as const,
            variant: 'outline' as const,
            onClick: (e) => {
              e?.stopPropagation()
              void navigator.clipboard.writeText(description ? `${title}: ${description}` : title)
            }
          }
        ]
      })
    },
    prompt(title: string, description: string, actions: Array<{ label: string; onClick: () => void }>): void {
      const { id } = toast.add({
        title,
        description,
        color: 'warning',
        icon: 'i-lucide-triangle-alert',
        duration: 0,
        actions: actions.map((a) => ({
          label: a.label,
          color: 'neutral' as const,
          variant: 'outline' as const,
          onClick: () => {
            toast.remove(id)
            a.onClick()
          }
        }))
      })
    }
  }
}

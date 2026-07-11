/** Thin wrapper over @nuxt/ui's useToast() so every call site shares consistent styling. */
export function useNotify() {
  const toast = useToast()
  return {
    success(title: string, description?: string): void {
      toast.add({ title, description, color: 'success', icon: 'i-lucide-check-circle' })
    },
    error(title: string, description?: string): void {
      toast.add({ title, description, color: 'error', icon: 'i-lucide-alert-circle' })
    }
  }
}

export interface PaneActions {
  selectedCount: () => number
  rename: () => void
  remove: () => void
  transfer: () => void
  edit: () => void
}

const registry = new Map<'local' | 'remote', PaneActions>()

export function registerPaneActions(side: 'local' | 'remote', actions: PaneActions): () => void {
  registry.set(side, actions)
  return () => {
    if (registry.get(side) === actions) {
      registry.delete(side)
    }
  }
}

export function getPaneActions(side: 'local' | 'remote'): PaneActions | undefined {
  return registry.get(side)
}

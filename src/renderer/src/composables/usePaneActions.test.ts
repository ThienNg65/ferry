import { describe, expect, it, vi } from 'vitest'
import { getPaneActions, registerPaneActions } from './usePaneActions'

describe('usePaneActions', () => {
  it('exposes visible selectedCount alongside pane action callbacks and unregisters cleanly', () => {
    let visibleCount = 0
    const unregister = registerPaneActions('remote', {
      selectedCount: () => visibleCount,
      rename: vi.fn(),
      remove: vi.fn(),
      transfer: vi.fn(),
      edit: vi.fn()
    })

    expect(getPaneActions('remote')?.selectedCount()).toBe(0)
    visibleCount = 2
    expect(getPaneActions('remote')?.selectedCount()).toBe(2)

    unregister()
    expect(getPaneActions('remote')).toBeUndefined()
  })
})
